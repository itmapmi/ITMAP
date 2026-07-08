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

export interface MonthlyTrendPoint {
  month: string;
  count: number;
  critical: number;
  high: number;
}

export interface ProductBreakdown {
  product: string;
  count: number;
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
  byProduct: ProductBreakdown[];
  monthlyTrend: MonthlyTrendPoint[];
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

  const empty: CveSummary = {
    vendorId,
    vendorName: vendor.name,
    dataAsOf,
    total: 0,
    bySeverity: {},
    kevCount: 0,
    epssHighCount: 0,
    products: [],
    byProduct: [],
    monthlyTrend: [],
    cpeTokens,
  };

  if (!cpeTokens.length) return empty;

  const cveIdRows = await db
    .selectDistinct({ cveId: cveCpe.cveId })
    .from(cveCpe)
    .where(inArray(cveCpe.cpeVendor, cpeTokens));
  const cveIdList = cveIdRows.map((r) => r.cveId);

  if (!cveIdList.length) return empty;

  const [severityRows, kevRows, epssRows, productRows, trendRows] = await Promise.all([
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
          sql`${epss.epssScore}::numeric >= 0.90`,
        ),
      ),

    db
      .select({
        product: cveCpe.cpeProduct,
        count: sql<number>`count(distinct ${cveCpe.cveId})::int`,
      })
      .from(cveCpe)
      .where(inArray(cveCpe.cpeVendor, cpeTokens))
      .groupBy(cveCpe.cpeProduct)
      .orderBy(desc(sql`count(distinct ${cveCpe.cveId})`))
      .limit(30),

    // 12-month monthly trend — join through cve_cpe to avoid serialising a
    // large JS array into a raw SQL ANY() parameter (triggers PG type error).
    db.execute(sql`
      SELECT
        to_char(date_trunc('month', c.published AT TIME ZONE 'UTC'), 'YYYY-MM') AS month,
        count(*)::int AS count,
        count(*) FILTER (WHERE c.cvss_severity = 'CRITICAL')::int AS critical,
        count(*) FILTER (WHERE c.cvss_severity = 'HIGH')::int AS high
      FROM cve c
      INNER JOIN cve_cpe cc ON cc.cve_id = c.cve_id
      WHERE cc.cpe_vendor IN (${sql.join(cpeTokens.map((t) => sql`${t}`), sql`, `)})
        AND c.published >= now() - interval '12 months'
        AND c.published IS NOT NULL
      GROUP BY month
      ORDER BY month
    `),
  ]);

  const bySeverity: Record<string, number> = {};
  let total = 0;
  for (const r of severityRows) {
    const sev = r.severity ?? "UNSCORED";
    bySeverity[sev] = r.count;
    total += r.count;
  }

  const byProduct: ProductBreakdown[] = productRows
    .filter((r) => r.product)
    .map((r) => ({ product: r.product as string, count: r.count }));

  const products = byProduct.map((r) => r.product);

  const monthlyTrend: MonthlyTrendPoint[] = (trendRows.rows as any[]).map((r) => ({
    month: String(r.month),
    count: Number(r.count),
    critical: Number(r.critical),
    high: Number(r.high),
  }));

  return {
    vendorId,
    vendorName: vendor.name,
    dataAsOf,
    total,
    bySeverity,
    kevCount: kevRows[0]?.count ?? 0,
    epssHighCount: epssRows[0]?.count ?? 0,
    products,
    byProduct,
    monthlyTrend,
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
  kevInfo?: {
    vendorProject: string | null;
    product: string | null;
    dateAdded: string | null;
    dueDate: string | null;
    requiredAction: string | null;
    ransomwareUse: string | null;
  };
  epssScore: string | null;
  epssPercentile: string | null;
  products: string[];
}

export interface CveListResult {
  data: CveListItem[];
  total: number;
  page: number;
  pageSize: number;
  dataAsOf: Date | null;
}

export async function getCvesByVendor(
  vendorId: string,
  opts: {
    severity?: string | string[];
    kevOnly?: boolean;
    since?: string;
    product?: string;
    page?: number;
    pageSize?: number;
    sort?: "published" | "severity" | "epss";
    order?: "asc" | "desc";
  },
): Promise<CveListResult> {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 25));
  const offset = (page - 1) * pageSize;
  const dataAsOf = await getCveDataAsOf();

  const cpeTokens = await getConfirmedCpeTokens(vendorId);
  if (!cpeTokens.length) return { data: [], total: 0, page, pageSize, dataAsOf };

  const cpeWhere = opts.product
    ? and(inArray(cveCpe.cpeVendor, cpeTokens), eq(cveCpe.cpeProduct, opts.product))
    : inArray(cveCpe.cpeVendor, cpeTokens);

  const cveIdRows = await db
    .selectDistinct({ cveId: cveCpe.cveId })
    .from(cveCpe)
    .where(cpeWhere);
  let cveIdList = cveIdRows.map((r) => r.cveId);
  if (!cveIdList.length) return { data: [], total: 0, page, pageSize, dataAsOf };

  if (opts.kevOnly) {
    const kevRows = await db
      .select({ cveId: kev.cveId })
      .from(kev)
      .where(inArray(kev.cveId, cveIdList));
    cveIdList = kevRows.map((r) => r.cveId);
    if (!cveIdList.length) return { data: [], total: 0, page, pageSize, dataAsOf };
  }

  const conditions: any[] = [inArray(cve.cveId, cveIdList)];

  if (opts.severity) {
    const severities = Array.isArray(opts.severity)
      ? opts.severity.map((s) => s.toUpperCase())
      : [opts.severity.toUpperCase()];
    if (severities.length === 1) {
      conditions.push(eq(cve.cvssSeverity, severities[0]));
    } else {
      conditions.push(inArray(cve.cvssSeverity, severities));
    }
  }

  if (opts.since) {
    conditions.push(gte(cve.published, new Date(opts.since)));
  }

  const whereClause = and(...conditions);

  const orderExpr =
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
        : desc(cve.published);

  const [countRows, cveRows] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(cve)
      .where(whereClause),
    db
      .select()
      .from(cve)
      .where(whereClause)
      .orderBy(orderExpr)
      .limit(pageSize)
      .offset(offset),
  ]);

  const total = countRows[0]?.count ?? 0;
  if (!cveRows.length) return { data: [], total, page, pageSize, dataAsOf };

  const resultIds = cveRows.map((r) => r.cveId);

  const [kevMap, epssMap, productMap] = await Promise.all([
    db
      .select()
      .from(kev)
      .where(inArray(kev.cveId, resultIds))
      .then((rows) => new Map(rows.map((r) => [r.cveId, r]))),
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
    const k = kevMap.get(c.cveId);
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
      isKev: !!k,
      kevInfo: k
        ? {
            vendorProject: k.vendorProject,
            product: k.product,
            dateAdded: k.dateAdded,
            dueDate: k.dueDate,
            requiredAction: k.requiredAction,
            ransomwareUse: k.ransomwareUse,
          }
        : undefined,
      epssScore: e?.epssScore ?? null,
      epssPercentile: e?.percentile ?? null,
      products: [...(productMap.get(c.cveId) ?? [])],
    };
  });

  return { data, total, page, pageSize, dataAsOf };
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
    db.select().from(kev).where(eq(kev.cveId, cveId)).limit(1),
    db.select().from(epss).where(eq(epss.cveId, cveId)).limit(1),
    db
      .select({ product: cveCpe.cpeProduct })
      .from(cveCpe)
      .where(eq(cveCpe.cveId, cveId)),
  ]);

  const products = [
    ...new Set(cpeRows.map((r) => r.product).filter(Boolean)),
  ] as string[];
  const k = kevRow[0];

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
    isKev: !!k,
    kevInfo: k
      ? {
          vendorProject: k.vendorProject,
          product: k.product,
          dateAdded: k.dateAdded,
          dueDate: k.dueDate,
          requiredAction: k.requiredAction,
          ransomwareUse: k.ransomwareUse,
        }
      : undefined,
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
