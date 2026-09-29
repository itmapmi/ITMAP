import { useRoute } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { LockedFeaturePanel } from "@/components/locked-feature-tooltip";
import LeadDetailView from "./lead-detail-view";

// Vendor-facing counterpart of `detail.tsx`. Same visual/detail experience
// an admin gets from the Leadgen panel, scoped server-side to visitors in
// the signed-in seat's assigned market(s) (see requireVendorScope AND
// requireFeature("lead_gen") in server/routes/leadGen.ts). No vendorLinkBase:
// vendors don't have a cross-vendor admin page to drill into from here.
export default function LeadGenMyLeadDetailPage() {
  const [, params] = useRoute("/lead-gen/me/:userId");
  const { hasFeature, isLoading: authLoading } = useAuth();

  if (!authLoading && !hasFeature("lead_gen")) {
    return <LockedFeaturePanel featureKey="lead_gen" variant="dark" />;
  }

  return (
    <LeadDetailView
      userId={params?.userId}
      apiBase="/api/lead-gen/me/leads"
      backHref="/lead-gen/me"
      backLabel="Market visitors"
    />
  );
}
