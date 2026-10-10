export type CampaignBuyerState = {
  role?: string | null;
  persona?: string | null;
  vendorScopeId?: string | null;
  vendorScopeIds?: string[] | null;
  linkedInCampaignAccessGrantedAt?: Date | string | null;
};

// This timestamp is written only by the validated server-side campaign OIDC
// callback. A URL, submitted lead or client-side flag can never grant access.
export function hasCampaignBuyerAccess(user: CampaignBuyerState | null | undefined): boolean {
  return !!user && user.role === "user" && user.persona !== "vendor" &&
    !user.vendorScopeId && !user.vendorScopeIds?.length &&
    !!user.linkedInCampaignAccessGrantedAt;
}
