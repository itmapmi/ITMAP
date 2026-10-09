/**
 * The listing search is for market names and actual vendor roster names,
 * not incidental mentions in market definitions or summaries.
 */
export function matchesMarketSearch(
  query: string,
  marketNames: readonly string[],
  vendorNames: readonly string[],
): boolean {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return true;

  return [...marketNames, ...vendorNames].some(name =>
    name.toLowerCase().includes(normalizedQuery),
  );
}
