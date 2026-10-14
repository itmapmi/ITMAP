import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { eq } from "drizzle-orm";

vi.mock("../db", async () => {
  const [{ Pool, neonConfig }, { drizzle }, ws, schema] = await Promise.all([
    import("@neondatabase/serverless"), import("drizzle-orm/neon-serverless"),
    import("ws"), import("@shared/schema"),
  ]);
  neonConfig.webSocketConstructor = ws.default;
  const name = `lead_profile_test_${randomUUID().replaceAll("-", "")}`;
  const admin = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await admin.query(`create schema "${name}"`);
    await admin.query(`create table "${name}".users (like public.users including all)`);
  } finally { await admin.end(); }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, options: `-c search_path=${name}` });
  return { db: drizzle({ client: pool, schema }), pool, __testSchemaName: name };
});

import { db, pool } from "../db";
import { users } from "@shared/schema";
import { registerAdminLeadProfileRoutes } from "./adminLeadProfile";
import { adminLeadProfileSchema } from "@shared/admin-lead-profile";

const app = express();
app.use(express.json());
// Test-only identity injection in this isolated Express instance, never the app.
app.use((req: any, _res, next) => {
  const role = req.get("x-test-role");
  req.isAuthenticated = () => !!role;
  req.user = role ? { id: "synthetic-actor", role } : undefined;
  next();
});
registerAdminLeadProfileRoutes(app);
const id = randomUUID();
const holderId = randomUUID();
const patch = (body: object) => request(app).patch(`/api/lead-gen/leads/${id}/profile`)
  .set("x-test-role", "admin").send(body);

beforeAll(async () => {
  await db.insert(users).values([
    {
      id, email: "primary@example.org", emailVerified: true, firstName: "Original",
      role: "user", persona: "buyer", companyEmail: "original@work.example",
      companyEmailVerified: true, companyEmailVerificationToken: "synthetic-old-token",
      companyEmailVerificationSentAt: new Date(), linkedInCampaignAccessGrantedAt: new Date(),
    },
    { id: holderId, email: "holder@example.org", companyEmail: "taken@work.example", companyEmailVerified: true },
  ]);
});
afterAll(async () => {
  const module = await import("../db") as typeof import("../db") & { __testSchemaName: string };
  await pool.query(`drop schema "${module.__testSchemaName}" cascade`);
  await pool.end();
});

describe("admin Leadgen profile editing", () => {
  it("denies anonymous, buyer and vendor mutations", async () => {
    for (const role of ["", "user", "vendor"]) {
      const res = await request(app).patch(`/api/lead-gen/leads/${id}/profile`)
        .set("x-test-role", role).send({ firstName: "Forbidden" });
      expect(res.status).toBe(403);
    }
    const [user] = await db.select().from(users).where(eq(users.id, id));
    expect(user.firstName).toBe("Original");
  });
  it("rejects auth/access fields, malformed input and unknown accounts", async () => {
    for (const body of [
      {}, { email: "replacement@example.org" }, { role: "admin" },
      { companyEmailVerified: true }, { linkedInCampaignAccessGrantedAt: null },
      { firstName: "x".repeat(121) }, { companyEmail: "not-an-email" },
    ]) expect((await patch(body)).status).toBe(400);
    expect((await request(app).patch(`/api/lead-gen/leads/${randomUUID()}/profile`)
      .set("x-test-role", "admin").send({ firstName: "Missing" })).status).toBe(404);
    expect(adminLeadProfileSchema.parse({ companyEmail: "  " }).companyEmail).toBeNull();
  });
  it("saves profile fields while preserving login, access and same-email verification", async () => {
    const res = await patch({
      firstName: " Updated ", lastName: "Buyer", companyName: "Example Company",
      designation: "Director", industry: " Healthcare ", companyEmail: "ORIGINAL@WORK.EXAMPLE",
    });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({
      firstName: "Updated", lastName: "Buyer", industry: "Healthcare",
      companyEmail: "original@work.example", companyEmailVerified: true, email: "primary@example.org",
    });
    expect(Object.keys(res.body.user).sort()).toEqual([
      "companyEmail", "companyEmailVerified", "companyName", "designation",
      "email", "firstName", "id", "industry", "lastName",
    ]);
    const [user] = await db.select().from(users).where(eq(users.id, id));
    expect(user.role).toBe("user");
    expect(user.emailVerified).toBe(true);
    expect(user.linkedInCampaignAccessGrantedAt).toBeTruthy();
    expect(user.companyEmailVerificationToken).toBe("synthetic-old-token");
  });
  it("refuses an email verified on another account without partially saving", async () => {
    const res = await patch({ companyEmail: "taken@work.example", firstName: "Wrong" });
    expect(res.status).toBe(409);
    const [user] = await db.select().from(users).where(eq(users.id, id));
    expect(user.firstName).toBe("Updated");
    expect(user.companyEmailVerified).toBe(true);
  });
  it("clears stale verification when changing or removing work email, not login email", async () => {
    const changed = await patch({ companyEmail: "new@work.example" });
    expect(changed.status).toBe(200);
    expect(changed.body.user.companyEmailVerified).toBe(false);
    const [user] = await db.select().from(users).where(eq(users.id, id));
    expect(user.companyEmailVerificationToken).toBeNull();
    expect(user.companyEmailVerificationSentAt).toBeNull();
    expect(user.email).toBe("primary@example.org");
    const cleared = await patch({ companyEmail: "", industry: "" });
    expect(cleared.body.user).toMatchObject({ companyEmail: null, industry: null, companyEmailVerified: false });
    expect(cleared.body.user.firstName).toBe("Updated");
  });
});
