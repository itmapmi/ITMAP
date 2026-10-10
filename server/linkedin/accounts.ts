import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { linkedInCampaignIdentities, users, type User } from "@shared/schema";
import type { validatedLinkedInIdentity } from "./oidc";

export class CampaignAccountDenied extends Error {}

export function assertCampaignBuyer(user: User) {
  if (user.role !== "user" || user.persona === "vendor" ||
      user.vendorScopeId || user.vendorScopeIds?.length ||
      user.isBlocked || (user.accessExpiresAt && new Date(user.accessExpiresAt).getTime() <= Date.now())) {
    throw new CampaignAccountDenied("This account cannot use campaign buyer sign-in. Use its usual sign-in method.");
  }
}

// Identity linking uses only a validated provider subject or strictly verified
// primary email. Submitted work emails/names are never login credentials.
export async function grantCampaignAccount(
  clientId: string, campaignSlug: string,
  identity: ReturnType<typeof validatedLinkedInIdentity>, database = db,
) {
  if (!clientId || !identity.subject) throw new CampaignAccountDenied("Campaign identity is missing.");
  return database.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`linkedin:${clientId}:${identity.subject}`}, 0))`);
    const [linked] = await tx.select().from(linkedInCampaignIdentities).where(and(
      eq(linkedInCampaignIdentities.clientId, clientId),
      eq(linkedInCampaignIdentities.subject, identity.subject),
    )).limit(1).for("update");
    let user: User | undefined;
    let created = false;
    if (linked) {
      [user] = await tx.select().from(users).where(eq(users.id, linked.userId)).limit(1).for("update");
      if (!user) throw new CampaignAccountDenied("Linked account is unavailable.");
    } else {
      if (identity.verifiedPrimaryEmail) {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`linkedin-email:${identity.verifiedPrimaryEmail}`}, 0))`);
        const candidates = await tx.select().from(users)
          .where(sql`lower(${users.email}) = ${identity.verifiedPrimaryEmail}`).limit(2).for("update");
        if (candidates.length > 1) throw new CampaignAccountDenied("This email needs account reconciliation.");
        user = candidates[0];
      }
      if (user) assertCampaignBuyer(user);
      if (!user) {
        const [inserted] = await tx.insert(users).values({
          email: identity.verifiedPrimaryEmail,
          emailVerified: !!identity.verifiedPrimaryEmail,
          firstName: identity.firstName, lastName: identity.lastName,
          role: "user", persona: "buyer",
          linkedInCampaignAccessGrantedAt: new Date(),
        }).onConflictDoNothing({ target: users.email }).returning();
        user = inserted;
        created = !!inserted;
        if (!user && identity.verifiedPrimaryEmail) {
          const candidates = await tx.select().from(users)
            .where(sql`lower(${users.email}) = ${identity.verifiedPrimaryEmail}`).limit(2).for("update");
          if (candidates.length === 1) user = candidates[0];
        }
        if (!user) throw new CampaignAccountDenied("Account could not be established safely.");
      }
      assertCampaignBuyer(user);
      await tx.insert(linkedInCampaignIdentities).values({
        clientId, subject: identity.subject, userId: user.id, campaignSlug, createdByCampaign: created,
      });
    }
    assertCampaignBuyer(user);
    const [granted] = await tx.update(users).set({
      linkedInCampaignAccessGrantedAt: user.linkedInCampaignAccessGrantedAt ?? new Date(),
      // Do not manufacture email verification or replace an existing profile.
      updatedAt: new Date(),
    }).where(eq(users.id, user.id)).returning();
    assertCampaignBuyer(granted);
    await tx.update(linkedInCampaignIdentities).set({
      campaignSlug, authenticatedAt: new Date(),
    }).where(and(eq(linkedInCampaignIdentities.clientId, clientId),
      eq(linkedInCampaignIdentities.subject, identity.subject)));
    return { user: granted, created };
  });
}
