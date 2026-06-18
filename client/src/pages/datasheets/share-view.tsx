import { Fragment, useMemo, useState } from "react";
import { useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type {
  DatasheetMarket, DatasheetProduct, DatasheetVendor, Datasheet,
  DatasheetSpec, DatasheetSchemaDefinition,
} from "@shared/schema";

type ProductWithVendor = DatasheetProduct & { vendor: DatasheetVendor };
type ShareSnapshot = {
  comparisonName: string;
  market: DatasheetMarket;
  products: ProductWithVendor[];
  datasheets: Datasheet[];
  specs: DatasheetSpec[];
};

/**
 * Public read-only datasheet comparison snapshot viewer.
 *
 * Loaded via /share/comparison/:token — endpoint is anonymous; no auth-gated
 * UI is rendered (no Save, no Send to RFP, no chat). The same spec-matrix
 * layout as the authenticated /datasheets/:slug page so screenshots match.
 */
export default function DatasheetSharePage() {
  const params = useParams<{ token: string }>();
  const { data, isLoading, error } = useQuery<ShareSnapshot>({
    queryKey: ["/api/share/comparison", params.token],
    queryFn: async () => (await apiRequest(`/api/share/comparison/${params.token}`, "GET")).json(),
    retry: false,
  });

  if (isLoading) return <div className="min-h-screen theme-bg pt-20 px-6">Loading shared comparison…</div>;
  if (error || !data) return (
    <div className="min-h-screen theme-bg pt-20 px-6">
      <div className="max-w-2xl mx-auto py-20 text-center">
        <h1 className="text-2xl font-bold mb-2">Link unavailable</h1>
        <p className="text-slate-400">This share link is invalid or has been revoked by its owner.</p>
      </div>
    </div>
  );

  const schema = data.market.schemaDefinition as DatasheetSchemaDefinition;
  return (
    <div className="min-h-screen theme-bg pt-20 pb-12">
      <div className="max-w-7xl mx-auto px-6">
        <div className="mb-6">
          <div className="text-xs text-cyan-400 uppercase tracking-wider mb-1">Shared datasheet comparison</div>
          <h1 className="text-3xl font-bold">{data.comparisonName}</h1>
          <p className="text-slate-400 mt-1 text-sm">From {data.market.name} · read-only snapshot</p>
        </div>
        <ShareSpecMatrix data={data} schema={schema} />
        <p className="text-xs text-slate-500 mt-6">Powered by DCIG datasheet intelligence.</p>
      </div>
    </div>
  );
}

function ShareSpecMatrix({ data, schema }: { data: ShareSnapshot; schema: DatasheetSchemaDefinition }) {
  const specsByDs = useMemo(() => {
    const m = new Map<string, Map<string, DatasheetSpec>>();
    for (const s of data.specs) {
      const inner = m.get(s.datasheetId) ?? new Map();
      inner.set(`${s.categoryKey}.${s.attributeKey}`, s);
      m.set(s.datasheetId, inner);
    }
    return m;
  }, [data.specs]);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const dsByProduct = new Map(data.datasheets.map(d => [d.productId, d]));

  return (
    <Card className="bg-slate-900 border-white/5">
      <div className="overflow-x-auto max-h-[75vh] overflow-y-auto">
        <table className="w-full text-sm border-separate border-spacing-0">
          <thead>
            <tr>
              <th className="sticky top-0 left-0 z-30 text-left p-3 text-xs uppercase text-slate-500 font-medium bg-slate-900 border-b border-white/5 min-w-[180px]">Attribute</th>
              {data.products.map(p => (
                <th key={p.id} className="sticky top-0 z-20 text-left p-3 text-xs uppercase text-slate-300 font-semibold min-w-[160px] bg-slate-900 border-b border-white/5">
                  <div className="text-cyan-400 text-[10px] mb-0.5">{p.vendor.name}</div>
                  <div>{p.name}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {schema.groups.map(g => {
              const isCollapsed = !!collapsed[g.key];
              return (
                <Fragment key={g.key}>
                  <tr>
                    <td colSpan={data.products.length + 1}
                      className="bg-slate-950/60 px-3 py-2 text-xs font-semibold text-violet-300 uppercase tracking-wider cursor-pointer"
                      onClick={() => setCollapsed(p => ({ ...p, [g.key]: !p[g.key] }))}>
                      <span className="inline-block w-3">{isCollapsed ? "▸" : "▾"}</span> {g.label}
                    </td>
                  </tr>
                  {!isCollapsed && g.attributes.map(a => (
                    <tr key={`${g.key}-${a.key}`}>
                      <td className="sticky left-0 z-10 p-3 text-slate-300 bg-slate-900 border-t border-white/5">
                        <div className="font-medium">{a.label}</div>
                        {a.unit && <div className="text-xs text-slate-500">{a.unit}</div>}
                      </td>
                      {data.products.map(p => {
                        const ds = dsByProduct.get(p.id);
                        const sp = ds ? specsByDs.get(ds.id)?.get(`${g.key}.${a.key}`) : undefined;
                        return (
                          <td key={p.id} className="p-3 border-t border-white/5 text-slate-200"
                              title={sp?.sourceQuote ? `"${sp.sourceQuote}"${sp.sourcePage ? ` — p. ${sp.sourcePage}` : ""}` : undefined}>
                            {sp?.rawValue ?? <span className="text-slate-600">—</span>}
                            {sp?.sourcePage && <div className="text-[10px] text-slate-500 mt-0.5">p. {sp.sourcePage}</div>}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="p-3 border-t border-white/5 text-xs text-slate-500 flex items-center gap-3">
        <Badge variant="outline" className="text-[10px]">Read-only</Badge>
        Snapshot of {data.products.length} products · {data.datasheets.length} datasheets
      </div>
    </Card>
  );
}
