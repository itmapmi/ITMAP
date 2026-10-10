import { z } from "zod";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { linkedInCampaignIdentities, linkedInCampaignLeads, users } from "@shared/schema";
import { hasCampaignBuyerAccess } from "@shared/campaign-access";
import { isConsumerEmailDomain } from "@shared/company-email";
import { assertCampaignBuyer } from "./accounts";
import { issueAndSendCompanyVerification, issueAndSendVerification } from "../routes/auth";

const profileSchema = z.object({
  firstName: z.string().trim().min(1).max(120),
  lastName: z.string().trim().min(1).max(120),
  companyEmail: z.string().trim().toLowerCase().email().max(254),
  companyName: z.string().trim().min(2).max(120),
  designation: z.string().trim().min(2).max(120),
});

// Access no longer waits for this function. Name/email/time guesses are never
// used; the subject->person-URN relationship must first be verified live and
// explicitly enabled by the owner. Missing leads stay pending, not fabricated.
export async function completeCampaignProfile(
  clientId: string, subject: string, campaignSlug: string, database = db,
) {
  if (process.env.LINKEDIN_LEAD_SUBJECT_MATCHING_VERIFIED !== "true" ||
      clientId !== process.env.LINKEDIN_CLIENT_ID) return { status: "awaiting_verified_match" };
  const result = await database.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`linkedin:${clientId}:${subject}`}, 0))`);
    const [identity] = await tx.select().from(linkedInCampaignIdentities).where(and(
      eq(linkedInCampaignIdentities.clientId, clientId),
      eq(linkedInCampaignIdentities.subject, subject),
      eq(linkedInCampaignIdentities.campaignSlug, campaignSlug),
    )).limit(1).for("update");
    if (!identity || identity.profileStatus !== "awaiting_verified_match") return null;
    const [lead] = await tx.select().from(linkedInCampaignLeads).where(and(
      eq(linkedInCampaignLeads.sourceClientId, clientId),
      eq(linkedInCampaignLeads.campaignSlug, campaignSlug),
      eq(linkedInCampaignLeads.submitterUrn, `urn:li:person:${subject}`),
      eq(linkedInCampaignLeads.testLead, false),
    )).orderBy(desc(linkedInCampaignLeads.submittedAt)).limit(1);
    if (!lead) return null;
    const profile = profileSchema.parse(lead.profile);
    if (isConsumerEmailDomain(profile.companyEmail)) throw new Error("Invalid company profile");
    const [user] = await tx.select().from(users).where(eq(users.id, identity.userId)).limit(1).for("update");
    if (!user || !hasCampaignBuyerAccess(user)) return null;
    assertCampaignBuyer(user);
    // Keep existing profiles and verification intact. An arriving campaign
    // lead is not permission to overwrite a buyer's already-edited profile.
    const companyEmail = user.companyEmail || profile.companyEmail;
    const setCompanyEmail = !user.companyEmail;
    let email = user.email;
    let assignedLoginEmail = false;
    if (!email) {
      const holders = await tx.select({ id: users.id }).from(users)
        .where(sql`lower(${users.email}) = ${profile.companyEmail}`).limit(1);
      if (!holders.length) {
        email = profile.companyEmail;
        assignedLoginEmail = true;
      }
      // Never merge with a holder of an unverified, form-supplied work email.
    }
    const [updated] = await tx.update(users).set({
      firstName: identity.createdByCampaign && !user.companyEmail ? profile.firstName : user.firstName || profile.firstName,
      lastName: identity.createdByCampaign && !user.companyEmail ? profile.lastName : user.lastName || profile.lastName,
      companyName: user.companyName || profile.companyName,
      designation: user.designation || profile.designation,
      companyEmail,
      ...(setCompanyEmail && {
        companyEmailVerified: !!user.emailVerified && user.email?.toLowerCase() === companyEmail,
      }),
      ...(assignedLoginEmail && { email, emailVerified: false }),
      updatedAt: new Date(),
    }).where(eq(users.id, user.id)).returning();
    await tx.update(linkedInCampaignIdentities).set({ profileStatus: "completed" })
      .where(eq(linkedInCampaignIdentities.id, identity.id));
    await tx.update(linkedInCampaignLeads).set({ matchedUserId: user.id, matchedAt: new Date() })
      .where(eq(linkedInCampaignLeads.id, lead.id));
    return { updated, assignedLoginEmail, setCompanyEmail };
  });
  if (!result) return { status: "awaiting_lead" };
  // Background delivery failures must not undo the committed profile or login.
  if (result.assignedLoginEmail && result.updated.email) {
    void issueAndSendVerification(result.updated.id, result.updated.email)
      .catch(() => console.warn("[LinkedIn] Background email verification could not be sent"));
  }
  if (result.setCompanyEmail && !result.updated.companyEmailVerified && result.updated.companyEmail) {
    void issueAndSendCompanyVerification(result.updated.id, result.updated.companyEmail, result.updated.companyName)
      .catch(() => console.warn("[LinkedIn] Background work-email verification could not be sent"));
  }
  return { status: "completed" };
}

export function scheduleCampaignProfile(clientId: string, subject: string, campaignSlug: string) {
  setImmediate(() => {
    void completeCampaignProfile(clientId, subject, campaignSlug)
      .catch(() => console.warn("[LinkedIn] Campaign profile remains pending; no account access was changed"));
  });
}

export function startPendingCampaignProfiles() {
  let working = false;
  const timer = setInterval(async () => {
    if (working || process.env.LINKEDIN_LEAD_SUBJECT_MATCHING_VERIFIED !== "true" ||
        !process.env.LINKEDIN_CLIENT_ID) return;
    working = true;
    try {
      const pending = await db.select().from(linkedInCampaignIdentities).where(and(
        eq(linkedInCampaignIdentities.clientId, process.env.LINKEDIN_CLIENT_ID),
        eq(linkedInCampaignIdentities.profileStatus, "awaiting_verified_match"),
      )).orderBy(linkedInCampaignIdentities.authenticatedAt).limit(20);
      for (const identity of pending) {
        try {
          await completeCampaignProfile(identity.clientId, identity.subject, identity.campaignSlug);
        } catch {
          // Keep the durable pending state for a later retry; never undo access.
        }
      }
    } catch {
      console.warn("[LinkedIn] Pending profile worker unavailable; profiles remain pending");
    } finally {
      working = false;
    }
  }, 60_000);
  timer.unref();
}
