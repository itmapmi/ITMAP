// Shared query-param parsing for analytics-style endpoints (admin analytics
// panel + vendor-facing analytics surfaces such as Market Trends). Kept in
// one place so date/country validation never drifts between the two.

/** Parses & validates the `from`/`to` (YYYY-MM-DD) query params shared by
 * every analytics endpoint. Writes a 400 response and returns null on any
 * validation failure — callers should `return` immediately when that happens. */
export function parseDateRangeQuery(
  req: any,
  res: any,
): { since: Date; until: Date; fromRaw: string; toRaw: string } | null {
  const dateShape = /^\d{4}-\d{2}-\d{2}$/;
  const fromRaw = String(req.query.from ?? "");
  if (!dateShape.test(fromRaw)) {
    res.status(400).json({ error: "from must be a date in YYYY-MM-DD format" });
    return null;
  }
  const toRaw = String(req.query.to ?? fromRaw);
  if (!dateShape.test(toRaw)) {
    res.status(400).json({ error: "to must be a date in YYYY-MM-DD format" });
    return null;
  }
  const since = new Date(`${fromRaw}T00:00:00.000Z`);
  const until = new Date(`${toRaw}T23:59:59.999Z`);
  if (Number.isNaN(since.getTime()) || Number.isNaN(until.getTime())) {
    res.status(400).json({ error: "from/to must be valid calendar dates" });
    return null;
  }
  if (until < since) {
    res.status(400).json({ error: "to must not be before from" });
    return null;
  }
  return { since, until, fromRaw, toRaw };
}

// Shared optional `country` query param (ISO alpha code, max 10 chars).
export function parseOptionalCountryQuery(req: any, res: any): { country?: string } | null {
  const countryRaw = req.query.country;
  if (countryRaw === undefined || countryRaw === "") return { country: undefined };
  const s = String(countryRaw);
  if (s.length > 10 || !/^[A-Za-z]+$/.test(s)) {
    res.status(400).json({ error: "country must be a short alphabetic country code" });
    return null;
  }
  return { country: s.toUpperCase() };
}
