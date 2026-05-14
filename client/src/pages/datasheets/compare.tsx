import { Fragment, useEffect, useMemo, useState } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { Send, Bookmark, Download, FileSpreadsheet, FileText, MessageSquare, X, Plus, ExternalLink } from "lucide-react";
import type {
  DatasheetMarket, DatasheetProduct, DatasheetVendor, Datasheet, DatasheetSpec,
  DatasheetSchemaDefinition, DatasheetCitation, DatasheetChatConversation, DatasheetChatMessage,
} from "@shared/schema";

type ProductWithVendor = DatasheetProduct & { vendor: DatasheetVendor };
type MarketDetail = { market: DatasheetMarket; products: ProductWithVendor[] };
type CompareData = { products: ProductWithVendor[]; datasheets: Datasheet[]; specs: DatasheetSpec[] };

export default function DatasheetComparePage() {
  const params = useParams<{ slug: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { isAuthenticated } = useAuth();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [previewProductId, setPreviewProductId] = useState<string | null>(null);

  const { data: marketDetail, isLoading } = useQuery<MarketDetail>({
    queryKey: ["/api/datasheets/markets", params.slug],
    queryFn: async () => (await apiRequest(`/api/datasheets/markets/${params.slug}`, "GET")).json(),
  });

  // Initialize default selection from ?ids= query string, or first 2 products
  useEffect(() => {
    if (marketDetail && selectedIds.length === 0) {
      const qs = new URLSearchParams(window.location.search).get("ids");
      const validIds = new Set(marketDetail.products.map(p => p.id));
      const fromQs = qs ? qs.split(",").filter(id => validIds.has(id)).slice(0, 5) : [];
      if (fromQs.length > 0) { setSelectedIds(fromQs); return; }
      const defaults = marketDetail.products.slice(0, Math.min(2, marketDetail.products.length)).map(p => p.id);
      if (defaults.length) setSelectedIds(defaults);
    }
  }, [marketDetail, selectedIds.length]);

  const compareMut = useMutation({
    mutationFn: async (ids: string[]) => {
      const res = await apiRequest("/api/datasheets/compare", "POST", { productIds: ids });
      return (await res.json()) as CompareData;
    },
  });
  useEffect(() => {
    if (selectedIds.length >= 1) compareMut.mutate(selectedIds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds.join(",")]);

  const data = compareMut.data;
  const market = marketDetail?.market;
  const schema = market?.schemaDefinition as DatasheetSchemaDefinition | undefined;

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!isAuthenticated) { setLocation("/login"); throw new Error("Login required"); }
      if (!market) throw new Error("Market not loaded");
      const name = prompt("Name this comparison:", `${market.name} — ${new Date().toLocaleDateString()}`);
      if (!name) throw new Error("Cancelled");
      return await apiRequest("/api/me/datasheet-comparisons", "POST", { marketId: market.id, name, productIds: selectedIds });
    },
    onSuccess: () => toast({ title: "Comparison saved" }),
    onError: (err: unknown) => { if (err instanceof Error && err.message !== "Cancelled" && err.message !== "Login required") toast({ title: "Failed", description: err.message, variant: "destructive" }); },
  });

  if (isLoading) return <div className="min-h-screen bg-slate-950 text-white pt-20 px-6">Loading…</div>;
  if (!marketDetail || !market || !schema) return <div className="min-h-screen bg-slate-950 text-white pt-20 px-6">Market not found.</div>;

  const toggle = (id: string) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(p => p !== id) : prev.length < 5 ? [...prev, id] : prev);
  };

  const downloadExport = async (kind: "pdf" | "excel") => {
    const res = await fetch(`/api/datasheets/export/${kind}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ productIds: selectedIds }),
    });
    if (!res.ok) { toast({ title: "Export failed", variant: "destructive" }); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${market.slug}_comparison.${kind === "pdf" ? "pdf" : "xlsx"}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white pt-20 pb-12">
      <div className="max-w-7xl mx-auto px-6">
        <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="text-xs text-cyan-400 uppercase tracking-wider mb-1">Datasheet comparison</div>
            <h1 className="text-3xl font-bold">{market.name}</h1>
            {market.description && <p className="text-slate-400 mt-1 max-w-2xl text-sm">{market.description}</p>}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => saveMut.mutate()} disabled={selectedIds.length === 0} data-testid="button-save-comparison"><Bookmark className="h-4 w-4 mr-1" />Save</Button>
            <Button variant="outline" size="sm" onClick={() => downloadExport("pdf")} disabled={selectedIds.length === 0}><FileText className="h-4 w-4 mr-1" />PDF</Button>
            <Button variant="outline" size="sm" onClick={() => downloadExport("excel")} disabled={selectedIds.length === 0}><FileSpreadsheet className="h-4 w-4 mr-1" />Excel</Button>
          </div>
        </div>

        {/* Zone 1: Selector */}
        <Card className="bg-slate-900 border-white/5 p-4 mb-6">
          <div className="text-xs text-slate-400 mb-3">Choose up to 5 products to compare</div>
          <div className="flex flex-wrap gap-2">
            {marketDetail.products.map(p => {
              const active = selectedIds.includes(p.id);
              return (
                <button
                  key={p.id}
                  onClick={() => toggle(p.id)}
                  className={`px-3 py-2 rounded-full text-sm border transition ${
                    active ? "bg-cyan-500 text-slate-950 border-cyan-500" : "border-white/10 hover:border-cyan-500/40 text-slate-300"
                  }`}
                  data-testid={`button-toggle-product-${p.slug}`}
                >
                  <span className="font-medium">{p.vendor.name}</span> <span className="opacity-80">{p.name}</span>
                  {active && <X className="inline h-3 w-3 ml-1" />}
                </button>
              );
            })}
            {marketDetail.products.length === 0 && <div className="text-sm text-slate-500">No products in this market yet.</div>}
          </div>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Zone 2: Spec matrix */}
          <div className="lg:col-span-2">
            <SpecMatrix data={data} schema={schema} onProductClick={setPreviewProductId} />
          </div>
          {/* Zone 4: Chat */}
          <div>
            <ChatPanel
              market={market}
              selectedIds={selectedIds}
              isAuthenticated={isAuthenticated}
            />
          </div>
        </div>

        {/* Zone 3: PDF viewer modal */}
        {previewProductId && data && (
          <PdfPreview
            datasheets={data.datasheets}
            productId={previewProductId}
            onClose={() => setPreviewProductId(null)}
          />
        )}
      </div>
    </div>
  );
}

// ── Spec matrix ──────────────────────────────────────────────────────────
function SpecMatrix({ data, schema, onProductClick }: { data: CompareData | undefined; schema: DatasheetSchemaDefinition; onProductClick: (id: string) => void }) {
  const specs = data?.specs ?? [];
  const specsByDs = useMemo(() => {
    const m = new Map<string, Map<string, DatasheetSpec>>();
    for (const s of specs) {
      const inner = m.get(s.datasheetId) ?? new Map();
      inner.set(`${s.categoryKey}.${s.attributeKey}`, s);
      m.set(s.datasheetId, inner);
    }
    return m;
  }, [specs]);
  if (!data) return <Card className="bg-slate-900 border-white/5 p-6 text-slate-500">Select products to begin.</Card>;
  const { products, datasheets } = data;
  const dsByProduct = new Map(datasheets.map(d => [d.productId, d]));

  return (
    <Card className="bg-slate-900 border-white/5">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-white/5">
            <tr>
              <th className="text-left p-3 text-xs uppercase text-slate-500 font-medium">Attribute</th>
              {products.map(p => (
                <th key={p.id} className="text-left p-3 text-xs uppercase text-slate-300 font-semibold min-w-[160px]">
                  <button onClick={() => onProductClick(p.id)} className="hover:text-cyan-300 text-left" data-testid={`button-preview-${p.slug}`}>
                    <div className="text-cyan-400 text-[10px] mb-0.5">{p.vendor.name}</div>
                    <div>{p.name}</div>
                    <ExternalLink className="inline h-3 w-3 ml-1 opacity-50" />
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {schema.groups.map(g => (
              <Fragment key={g.key}>
                <tr className="bg-slate-950/50">
                  <td colSpan={products.length + 1} className="px-3 py-2 text-xs font-semibold text-violet-300 uppercase tracking-wider">{g.label}</td>
                </tr>
                {g.attributes.map(a => {
                  const values = products.map(p => {
                    const ds = dsByProduct.get(p.id);
                    return ds ? specsByDs.get(ds.id)?.get(`${g.key}.${a.key}`) : undefined;
                  });
                  const isDiff = computeDiff(values);
                  const winner = a.higherIsBetter ? computeWinnerIdx(values, true) : null;
                  return (
                    <tr key={`${g.key}-${a.key}`} className="border-t border-white/5">
                      <td className="p-3 text-slate-300">
                        <div className="font-medium">{a.label}</div>
                        {a.unit && <div className="text-xs text-slate-500">{a.unit}</div>}
                      </td>
                      {values.map((sp, i) => (
                        <td key={i} className={`p-3 ${isDiff ? "bg-amber-500/5" : ""} ${winner === i ? "text-emerald-400 font-semibold" : "text-slate-200"}`}>
                          {sp?.rawValue ?? <span className="text-slate-600">—</span>}
                          {sp?.sourcePage && <div className="text-[10px] text-slate-500 mt-0.5">p. {sp.sourcePage}</div>}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function computeDiff(values: Array<DatasheetSpec | undefined>): boolean {
  const raws = values.map(v => v?.rawValue ?? null);
  const first = raws[0];
  return raws.some(r => r !== first);
}

function computeWinnerIdx(values: Array<DatasheetSpec | undefined>, higherIsBetter: boolean): number | null {
  let bestIdx: number | null = null;
  let bestNum = higherIsBetter ? -Infinity : Infinity;
  values.forEach((v, i) => {
    if (!v?.normalizedValue) return;
    const n = Number(v.normalizedValue);
    if (!Number.isFinite(n)) return;
    if ((higherIsBetter && n > bestNum) || (!higherIsBetter && n < bestNum)) {
      bestNum = n; bestIdx = i;
    }
  });
  return bestIdx;
}

// ── PDF preview modal ────────────────────────────────────────────────────
function PdfPreview({ datasheets, productId, onClose }: { datasheets: Datasheet[]; productId: string; onClose: () => void }) {
  const ds = datasheets.find(d => d.productId === productId);
  if (!ds) return null;
  return (
    <div className="fixed inset-0 z-50 bg-slate-950/90 backdrop-blur-sm flex items-center justify-center p-6" onClick={onClose}>
      <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-5xl h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-white/5">
          <div className="text-sm">Datasheet PDF · v{ds.version}</div>
          <Button variant="ghost" size="sm" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>
        <iframe src={ds.fileUrl} className="flex-1 rounded-b-2xl bg-white" title="Datasheet PDF" />
      </div>
    </div>
  );
}

// ── Chat panel ───────────────────────────────────────────────────────────
function ChatPanel({ market, selectedIds, isAuthenticated }: { market: DatasheetMarket; selectedIds: string[]; isAuthenticated: boolean }) {
  const { toast } = useToast();
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [question, setQuestion] = useState("");

  const { data: convoData } = useQuery<{ conversation: DatasheetChatConversation; messages: DatasheetChatMessage[] }>({
    queryKey: ["/api/datasheets/chat/conversations", conversationId],
    queryFn: async () => (await apiRequest(`/api/datasheets/chat/conversations/${conversationId}`, "GET")).json(),
    enabled: !!conversationId,
  });

  const askMut = useMutation({
    mutationFn: async (q: string) => {
      let cid = conversationId;
      if (!cid) {
        const res = await apiRequest("/api/datasheets/chat/conversations", "POST", {
          marketId: market.id, productIds: selectedIds,
        });
        const c = await res.json();
        cid = c.id as string;
        setConversationId(cid);
      }
      return await apiRequest(`/api/datasheets/chat/conversations/${cid}/messages`, "POST", { question: q });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/datasheets/chat/conversations", conversationId] });
      setQuestion("");
    },
    onError: (err: unknown) => toast({ title: "Chat failed", description: err instanceof Error ? err.message : "", variant: "destructive" }),
  });

  const send = () => {
    if (!isAuthenticated) { toast({ title: "Sign in to chat", description: "Log in or create an account to use the datasheet chat." }); return; }
    if (selectedIds.length === 0) { toast({ title: "Select products first" }); return; }
    if (!question.trim()) return;
    askMut.mutate(question.trim());
  };

  const messages = convoData?.messages ?? [];

  return (
    <Card className="bg-slate-900 border-white/5 flex flex-col h-[700px]">
      <div className="p-3 border-b border-white/5 flex items-center gap-2">
        <MessageSquare className="h-4 w-4 text-cyan-400" />
        <span className="text-sm font-medium">Ask the datasheets</span>
        {conversationId && (
          <Button variant="ghost" size="sm" className="ml-auto text-xs" onClick={() => setConversationId(null)}>
            <Plus className="h-3 w-3 mr-1" />New
          </Button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.length === 0 && (
          <div className="text-xs text-slate-500">
            <p className="mb-2">Try asking:</p>
            <ul className="space-y-1 list-disc pl-4">
              <li>"Which has the highest IOPS?"</li>
              <li>"Compare power consumption."</li>
              <li>"What's the price-per-TB difference?"</li>
            </ul>
          </div>
        )}
        {messages.map(m => (
          <div key={m.id} className={`text-sm ${m.role === "user" ? "text-right" : ""}`}>
            <div className={`inline-block max-w-[90%] rounded-lg px-3 py-2 ${m.role === "user" ? "bg-cyan-500/20 text-cyan-100" : "bg-slate-800 text-slate-200"}`}>
              <div className="whitespace-pre-wrap">{m.content}</div>
              {m.role === "assistant" && Array.isArray(m.citations) && (m.citations as DatasheetCitation[]).length > 0 && (
                <div className="mt-2 pt-2 border-t border-white/5 text-xs text-slate-400 space-y-1">
                  {(m.citations as DatasheetCitation[]).slice(0, 4).map((c, i) => (
                    <div key={i}><span className="text-cyan-400">{c.vendorName} {c.productName}</span>{c.page ? ` (p. ${c.page})` : ""}: "{c.quote}"</div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
        {askMut.isPending && <div className="text-xs text-slate-500 animate-pulse">Thinking…</div>}
      </div>
      <div className="p-3 border-t border-white/5 flex gap-2">
        <Input
          value={question}
          onChange={e => setQuestion(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder="Ask about these datasheets…"
          className="bg-slate-950 border-white/10"
          data-testid="input-chat-question"
        />
        <Button onClick={send} disabled={askMut.isPending || !question.trim()} data-testid="button-send-chat"><Send className="h-4 w-4" /></Button>
      </div>
    </Card>
  );
}
