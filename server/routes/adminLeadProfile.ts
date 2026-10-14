import type { Express } from "express";
import { requireAdmin } from "../auth";
import { adminLeadProfileSchema } from "@shared/admin-lead-profile";
import { CompanyProfileConflict, updateLeadProfileByAdmin } from "../storage/users";

export function registerAdminLeadProfileRoutes(app: Express) {
  app.patch("/api/lead-gen/leads/:userId/profile", requireAdmin, async (req, res) => {
    const parsed = adminLeadProfileSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid profile" });
    }
    try {
      const updated = await updateLeadProfileByAdmin(req.params.userId, parsed.data);
      if (!updated) return res.status(404).json({ error: "User not found" });
      // Never serialize the account row (tokens and private auth fields).
      return res.json({ user: {
        id: updated.id, firstName: updated.firstName, lastName: updated.lastName,
        email: updated.email, companyName: updated.companyName,
        designation: updated.designation, industry: updated.industry,
        companyEmail: updated.companyEmail, companyEmailVerified: updated.companyEmailVerified,
      } });
    } catch (error) {
      if (error instanceof CompanyProfileConflict) return res.status(409).json({ error: error.message });
      console.warn("[lead-gen] Admin profile update failed");
      return res.status(500).json({ error: "Could not save profile" });
    }
  });
}
