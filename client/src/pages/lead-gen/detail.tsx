import { useRoute } from "wouter";
import LeadDetailView from "./lead-detail-view";

export default function LeadGenDetailPage() {
  const [, params] = useRoute("/lead-gen/:userId");
  return (
    <LeadDetailView
      userId={params?.userId}
      apiBase="/api/lead-gen/leads"
      backHref="/lead-gen"
      backLabel="All leads"
      vendorLinkBase="/lead-gen/vendors"
      canEditProfile
    />
  );
}
