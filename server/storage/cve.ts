import { db } from "../db";
import { cve, cveCpe, vendorCpeCrosswalk, kev, epss, syncRun, vendors } from "@shared/schema";
import { eq, and, inArray, sql, desc, gte, lte, asc } from "drizzle-orm";

export async function getCveDataAsOf(): Promise<Date | null> {
  const row = await db
    .select({ finishedAt: syncRun.finishedAt })
    .from(syncRun)
    .where(and(eq(syncRun.job, "nvd"), eq(syncRun.status, "success")))
    .orderBy(desc(syncRun.finishedAt))
    .limit(1);
  return row[0]?.finishedAt ?? null;
}

async function getConfirmedCpeTokens(vendorId: string): Promise<string[]> {
  const rows = await db
    .select({ cpeVendor: vendorCpeCrosswalk.cpeVendor })
    .from(vendorCpeCrosswalk)
    .where(
      and(
        eq(vendorCpeCrosswalk.vendorId, vendorId),
        eq(vendorCpeCrosswalk.confidence, "confirmed"),
      ),
    );
  return rows.map((r) => r.cpeVendor);
}

export interface CveSummary {
  vendorId: string;
  vendorName: string;
  dataAsOf: Date | null;
  total: number;
  bySeverity: Record<string, number>;
  kevCount: number;
  epssHighCount: number;
  products: string[];
  cpeTokens: string[];
}

export async function getCveSummary(vendorId: string): Promise<CveSummary | null> {
  const vendorRow = await db
    .select({ id: vendors.id, name: vendors.name })
    .from(vendors)
    .where(eq(vendors.id, vendorId))
    .limit(1);
  if (!vendorRow.length) return null;
  const vendor = vendorRow[0];

  const [cpeTokens, dataAsOf] = await Promise.all([
    getConfirmedCpeTokens(vendorId),
    getCveDataAsOf(),
  ]);

  if (!cpeTokens.length) {
    return {
      vendorId,
      vendorName: vendor.name,
      dataAsOf,
      total: 0,
      bySeverity: {},
      kevCount: 0,
      epssHighCount: 0,
      products: [],
      cpeTokens: [],
    };
  }

  const cveIdRows = await db
    .selectDistinct({ cveId: cveCpe.cveId })
    .from(cveCpe)
    .where(inArray(cveCpe.cpeVendor, cpeTokens));
  const cveIdList = cveIdRows.map((r) => r.cveId);

  if (!cveIdList.length) {
    return {
      vendorId,
      vendorName: vendor.name,
      dataAsOf,
      total: 0,
      bySeverity: {},
      kevCount: 0,
      epssHighCount: 0,
      products: [],
      cpeTokens,
    };
  }

  const [severityRows, kevRows, epssRows, productRows] = await Promise.all([
    db
      .select({
        severity: cve.cvssSeverity,
        count: sql<number>`count(*)::int`,
      })
      .from(cve)
      .where(inArray(cve.cveId, cveIdList))
      .groupBy(cve.cvssSeverity),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(kev)
      .where(inArray(kev.cveId, cveIdList)),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(epss)
      .where(
        and(
          inArray(epss.cveId, cveIdList),
          sql`${epss.epssScore}::numeric >= 0.5`,
        ),
      ),
    db
      .selectDistinct({ product: cveCpe.cpeProduct })
      .from(cveCpe)
      .where(inArray(cveCpe.cpeVendor, cpeTokens)),
  ]);

  const bySeverity: Record<string, number> = {};
  let total = 0;
  for (const r of severityRows) {
    const sev = r.severity ?? "UNSCORED";
    bySeverity[sev] = r.count;
    total += r.count;
  }

  const products = productRows
    .map((r) => r.product)
    .filter(Boolean) as string[];

  return {
    vendorId,
    vendorName: vendor.name,
    dataAsOf,
    total,
    bySeverity,
    kevCount: kevRows[0]?.count ?? 0,
    epssHighCount: epssRows[0]?.count ?? 0,
    products,
    cpeTokens,
  };
}

export interface CveListItem {
  cveId: string;
  published: Date | null;
  lastModified: Date | null;
  description: string | null;
  cvssBaseScore: string | null;
  cvssSeverity: string | null;
  cvssVector: string | null;
  cvssVersion: string | null;
  cweIds: string[] | null;
  referenceUrls: string[] | null;
  vulnStatus: string | null;
  isKev: boolean;
  epssScore: string | null;
  epssPercentile: string | null;
  products: string[];
}

export interface CveListResult {
  data: CveListItem[];
  total: number;
  page: number;
  limit: number;
  dataAsOf: Date | null;
}

export async function getCvesByVendor(
  vendorId: string,
  opts: {
    severity?: string;
    kevOnly?: boolean;
    dateFrom?: string;
    dateTo?: string;
    product?: string;
    page?: number;
    limit?: number;
    sort?: "published" | "severity" | "epss";
    order?: "asc" | "desc";
  },
): Promise<CveListResult> {
  const page = Math.max(1, opts.page ?? 1);
  const limit = Math.min(100, Math.max(1, opts.limit ?? 25));
  const offset = (page - 1) * limit;
  const dataAsOf = await getCveDataAsOf();

  const cpeTokens = await getConfirmedCpeTokens(vendorId);
  if (!cpeTokens.length) return { data: [], total: 0, page, limit, dataAsOf };

  const cpeWhere = opts.product
    ? and(inArray(cveCpe.cpeVendor, cpeTokens), eq(cveCpe.cpeProduct, opts.product))
    : inArray(cveCpe.cpeVendor, cpeTokens);

  const cveIdRows = await db
    .selectDistinct({ cveId: cveCpe.cveId })
    .from(cveCpe)
    .where(cpeWhere);
  let cveIdList = cveIdRows.map((r) => r.cveId);
  if (!cveIdList.length) return { data: [], total: 0, page, limit, dataAsOf };

  if (opts.kevOnly) {
    const kevRows = await db
      .select({ cveId: kev.cveId })
      .from(kev)
      .where(inArray(kev.cveId, cveIdList));
    cveIdList = kevRows.map((r) => r.cveId);
    if (!cveIdList.length) return { data: [], total: 0, page, limit, dataAsOf };
  }

  const conditions: any[] = [inArray(cve.cveId, cveIdList)];
  if (opts.severity)
    conditions.push(eq(cve.cvssSeverity, opts.severity.toUpperCase()));
  if (opts.dateFrom)
    conditions.push(gte(cve.published, new Date(opts.dateFrom)));
  if (opts.dateTo)
    conditions.push(lte(cve.published, new Date(opts.dateTo)));

  const whereClause = and(...conditions);

  const [countRows, cveRows] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(cve)
      .where(whereClause),
    db
      .select()
      .from(cve)
      .where(whereClause)
      .orderBy(
        opts.sort === "severity"
          ? opts.order === "asc"
            ? asc(
                sql`CASE ${cve.cvssSeverity} WHEN 'CRITICAL' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3 WHEN 'LOW' THEN 4 ELSE 5 END`,
              )
            : desc(
                sql`CASE ${cve.cvssSeverity} WHEN 'CRITICAL' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3 WHEN 'LOW' THEN 4 ELSE 5 END`,
              )
          : opts.order === "asc"
            ? asc(cve.published)
            : desc(cve.published),
      )
      .limit(limit)
      .offset(offset),
  ]);

  const total = countRows[0]?.count ?? 0;
  if (!cveRows.length) return { data: [], total, page, limit, dataAsOf };

  const resultIds = cveRows.map((r) => r.cveId);

  const [kevSet2, epssMap, productMap] = await Promise.all([
    db
      .select({ cveId: kev.cveId })
      .from(kev)
      .where(inArray(kev.cveId, resultIds))
      .then((rows) => new Set(rows.map((r) => r.cveId))),
    db
      .select()
      .from(epss)
      .where(inArray(epss.cveId, resultIds))
      .then((rows) => new Map(rows.map((r) => [r.cveId, r]))),
    db
      .select({ cveId: cveCpe.cveId, product: cveCpe.cpeProduct })
      .from(cveCpe)
      .where(
        and(
          inArray(cveCpe.cpeVendor, cpeTokens),
          inArray(cveCpe.cveId, resultIds),
        ),
      )
      .then((rows) => {
        const m = new Map<string, Set<string>>();
        for (const r of rows) {
          if (!m.has(r.cveId)) m.set(r.cveId, new Set());
          if (r.product) m.get(r.cveId)!.add(r.product);
        }
        return m;
      }),
  ]);

  const data: CveListItem[] = cveRows.map((c) => {
    const e = epssMap.get(c.cveId);
    return {
      cveId: c.cveId,
      published: c.published,
      lastModified: c.lastModified,
      description: c.description,
      cvssBaseScore: c.cvssBaseScore,
      cvssSeverity: c.cvssSeverity,
      cvssVector: c.cvssVector,
      cvssVersion: c.cvssVersion,
      cweIds: c.cweIds,
      referenceUrls: c.referenceUrls,
      vulnStatus: c.vulnStatus,
      isKev: kevSet2.has(c.cveId),
      epssScore: e?.epssScore ?? null,
      epssPercentile: e?.percentile ?? null,
      products: [...(productMap.get(c.cveId) ?? [])],
    };
  });

  return { data, total, page, limit, dataAsOf };
}

export async function getCveById(cveId: string): Promise<CveListItem | null> {
  const rows = await db
    .select()
    .from(cve)
    .where(eq(cve.cveId, cveId))
    .limit(1);
  if (!rows.length) return null;
  const c = rows[0];

  const [kevRow, epssRow, cpeRows] = await Promise.all([
    db
      .select({ cveId: kev.cveId })
      .from(kev)
      .where(eq(kev.cveId, cveId))
      .limit(1),
    db.select().from(epss).where(eq(epss.cveId, cveId)).limit(1),
    db
      .select({ product: cveCpe.cpeProduct })
      .from(cveCpe)
      .where(eq(cveCpe.cveId, cveId)),
  ]);

  const products = [
    ...new Set(cpeRows.map((r) => r.product).filter(Boolean)),
  ] as string[];

  return {
    cveId: c.cveId,
    published: c.published,
    lastModified: c.lastModified,
    description: c.description,
    cvssBaseScore: c.cvssBaseScore,
    cvssSeverity: c.cvssSeverity,
    cvssVector: c.cvssVector,
    cvssVersion: c.cvssVersion,
    cweIds: c.cweIds,
    referenceUrls: c.referenceUrls,
    vulnStatus: c.vulnStatus,
    isKev: !!kevRow.length,
    epssScore: epssRow[0]?.epssScore ?? null,
    epssPercentile: epssRow[0]?.percentile ?? null,
    products,
  };
}

export async function getCveComparison(vendorIds: string[]): Promise<{
  vendors: (CveSummary | null)[];
  dataAsOf: Date | null;
}> {
  const [summaries, dataAsOf] = await Promise.all([
    Promise.all(vendorIds.map((id) => getCveSummary(id))),
    getCveDataAsOf(),
  ]);
  return { vendors: summaries, dataAsOf };
}

export async function getVendorsWithCveData(): Promise<
  { id: string; name: string; marketId: string; cpeTokens: string[] }[]
> {
  const crosswalkRows = await db
    .select({
      cpeVendor: vendorCpeCrosswalk.cpeVendor,
      vendorId: vendorCpeCrosswalk.vendorId,
    })
    .from(vendorCpeCrosswalk)
    .where(eq(vendorCpeCrosswalk.confidence, "confirmed"));

  const vendorIds = [
    ...new Set(crosswalkRows.map((r) => r.vendorId).filter(Boolean)),
  ] as string[];
  if (!vendorIds.length) return [];

  const vendorRows = await db
    .select({ id: vendors.id, name: vendors.name, marketId: vendors.marketId })
    .from(vendors)
    .where(inArray(vendors.id, vendorIds));

  const tokensByVendor = new Map<string, string[]>();
  for (const r of crosswalkRows) {
    if (!r.vendorId) continue;
    if (!tokensByVendor.has(r.vendorId)) tokensByVendor.set(r.vendorId, []);
    tokensByVendor.get(r.vendorId)!.push(r.cpeVendor);
  }

  return vendorRows.map((v) => ({
    id: v.id,
    name: v.name,
    marketId: v.marketId,
    cpeTokens: tokensByVendor.get(v.id) ?? [],
  }));
}
