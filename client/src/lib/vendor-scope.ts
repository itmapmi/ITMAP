export interface VendorScopeResponse {
  markets: Array<{ id: string; name: string }>;
  vendors?: Array<{ id: string; name: string; marketId?: string | null }>;
}

export function vendorScopePresentation(
  scope: VendorScopeResponse | undefined,
  fallbackLabel: string,
): { isLinked: boolean; label: string } {
  const isLinked = Boolean(scope?.markets?.length);
  const names = Array.from(
    new Set((scope?.vendors ?? []).map((vendor) => vendor.name.trim()).filter(Boolean)),
  );

  if (names.length === 1) return { isLinked, label: names[0] };
  if (names.length === 2) return { isLinked, label: `${names[0]} & ${names[1]}` };
  if (names.length > 2) return { isLinked, label: `${names[0]} + ${names.length - 1} vendors` };
  return { isLinked, label: fallbackLabel };
}