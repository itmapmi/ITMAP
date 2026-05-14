import { useEffect, useRef, useState } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, apiRequestJson, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Send, Sparkles, FileDown, CheckCircle2, Clock } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import Navigation from "@/components/navigation";
import type { RfpProject, RfpInterviewMessage, RfpRequirement, RfpSection } from "@shared/schema";

interface ShortlistRow { id: string; vendorId: string; fitScore: string | null; rationale: string | null; isIncluded: boolean; rank: number; vendor: { id: string; name: string; website: string | null } | null }
interface OutreachRow { id: string; vendorId: string; status: string; contactName: string | null; contactEmail: string | null; notes: string | null; responseText: string | null; responseFileUrl: string | null; vendor: { id: string; name: string } | null }

export default function MyRfpDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [tab, setTab] = useState("interview");
  const [draft, setDraft] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { data: rfp } = useQuery<RfpProject>({ queryKey: ["/api/me/rfps", id] });
  const { data: messages = [] } = useQuery<RfpInterviewMessage[]>({ queryKey: ["/api/me/rfps", id, "messages"] });
  const { data: requirements = [] } = useQuery<RfpRequirement[]>({ queryKey: ["/api/me/rfps", id, "requirements"] });
  const { data: sections = [] } = useQuery<RfpSection[]>({ queryKey: ["/api/me/rfps", id, "sections"] });
  const { data: shortlist = [] } = useQuery<ShortlistRow[]>({ queryKey: ["/api/me/rfps", id, "shortlist"] });
  const { data: outreach = [] } = useQuery<OutreachRow[]>({ queryKey: ["/api/me/rfps", id, "outreach"] });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const sendMutation = useMutation({
    mutationFn: async (content: string) => apiRequestJson(`/api/me/rfps/${id}/messages`, "POST", { content }),
    onSuccess: () => {
      setDraft("");
      queryClient.invalidateQueries({ queryKey: ["/api/me/rfps", id, "messages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/me/rfps", id] });
    },
    onError: (e: any) => {
      const msg = String(e?.message || "");
      if (msg.includes("MISSING_LLM_KEY") || msg.startsWith("412")) {
        toast({ title: "OpenAI key required", description: "Add your OpenAI API key in Settings → LLM Keys.", variant: "destructive" });
        setLocation("/me/settings/llm-keys");
        return;
      }
      toast({ title: "Could not send", description: msg, variant: "destructive" });
    },
  });

  const generateMutation = useMutation({
    mutationFn: async () => apiRequestJson(`/api/me/rfps/${id}/generate`, "POST"),
    onSuccess: () => {
      toast({ title: "RFP generated", description: "Preview, shortlist, and exports are ready." });
      queryClient.invalidateQueries({ queryKey: ["/api/me/rfps", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/me/rfps", id, "sections"] });
      queryClient.invalidateQueries({ queryKey: ["/api/me/rfps", id, "shortlist"] });
      queryClient.invalidateQueries({ queryKey: ["/api/me/rfps", id, "requirements"] });
      setTab("preview");
    },
    onError: (e: any) => {
      const msg = String(e?.message || "");
      if (msg.includes("MISSING_LLM_KEY") || msg.startsWith("412")) {
        toast({ title: "OpenAI key required", description: "Add your OpenAI API key in Settings → LLM Keys.", variant: "destructive" });
        setLocation("/me/settings/llm-keys");
        return;
      }
      toast({ title: "Generation failed", description: msg, variant: "destructive" });
    },
  });

  const updateReqMutation = useMutation({
    mutationFn: async ({ reqId, body }: { reqId: string; body: any }) => apiRequestJson(`/api/me/rfps/${id}/requirements/${reqId}`, "PATCH", body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/me/rfps", id, "requirements"] }),
  });
  const deleteReqMutation = useMutation({
    mutationFn: async (reqId: string) => apiRequest(`/api/me/rfps/${id}/requirements/${reqId}`, "DELETE"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/me/rfps", id, "requirements"] }),
  });
  const toggleShortlistMutation = useMutation({
    mutationFn: async ({ entryId, isIncluded }: { entryId: string; isIncluded: boolean }) => apiRequestJson(`/api/me/rfps/${id}/shortlist/${entryId}`, "PATCH", { isIncluded }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/me/rfps", id, "shortlist"] }),
  });
  const upsertOutreachMutation = useMutation({
    mutationFn: async (body: any) => apiRequestJson(`/api/me/rfps/${id}/outreach`, "POST", body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/me/rfps", id, "outreach"] }),
  });
  const regenSectionMutation = useMutation({
    mutationFn: async (sectionKey: string) => apiRequestJson(`/api/me/rfps/${id}/sections/${sectionKey}/regenerate`, "POST"),
    onSuccess: () => {
      toast({ title: "Section regenerated" });
      queryClient.invalidateQueries({ queryKey: ["/api/me/rfps", id, "sections"] });
      queryClient.invalidateQueries({ queryKey: ["/api/me/rfps", id] });
    },
    onError: (e: any) => {
      const msg = String(e?.message || "");
      if (msg.includes("MISSING_LLM_KEY") || msg.startsWith("412")) {
        toast({ title: "OpenAI key required", description: "Add your OpenAI API key in Settings → LLM Keys.", variant: "destructive" });
        setLocation("/me/settings/llm-keys");
        return;
      }
      toast({ title: "Regeneration failed", description: msg, variant: "destructive" });
    },
  });

  const profile = (rfp?.customerProfile || {}) as Record<string, any>;
  const SLOT_KEYS = ["companyName","industry","companySize","geography","timeline","budgetBand","mustHaves","niceToHaves","dealBreakers","quantitativeSpecs","integrations","complianceRequirements","slaTargets","successMetrics"];
  const CRITICAL_SLOTS = ["companyName","industry","timeline","mustHaves","integrations","complianceRequirements"];
  const isFilled = (k: string) => {
    const v = profile[k]; return v && (typeof v !== "string" || v.trim()) && (!Array.isArray(v) || v.length > 0);
  };
  const filledSlots = SLOT_KEYS.filter(isFilled).length;
  const totalSlots = SLOT_KEYS.length;
  const missingCritical = CRITICAL_SLOTS.filter(k => !isFilled(k));
  // Mirrors server `profileReadiness`: every critical slot captured AND ≥10/14 total.
  const interviewReady = missingCritical.length === 0 && filledSlots >= 10;
  const interviewComplete = interviewReady;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <Navigation />
      <div className="max-w-6xl mx-auto px-6 py-8">
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">{rfp?.title || "RFP"}</h1>
            <p className="text-slate-400 text-sm mt-1">
              {filledSlots}/{totalSlots} interview slots captured · Status: <span className="font-medium text-slate-200">{rfp?.status}</span>
            </p>
          </div>
          <Button
            onClick={() => generateMutation.mutate()}
            disabled={generateMutation.isPending || !interviewReady}
            title={interviewReady ? undefined : `Need critical slots: ${missingCritical.join(", ") || "10 of 14 total"}`}
            className="bg-gradient-to-r from-cyan-500 to-violet-600"
            data-testid="button-generate-rfp"
          >
            <Sparkles className="w-4 h-4 mr-2" />
            {generateMutation.isPending ? "Generating…" : rfp?.status === "ready" ? "Regenerate RFP" : "Generate RFP"}
          </Button>
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="bg-slate-900 border border-white/5">
            <TabsTrigger value="interview" data-testid="tab-interview">Interview</TabsTrigger>
            <TabsTrigger value="requirements" data-testid="tab-requirements">Requirements ({requirements.length})</TabsTrigger>
            <TabsTrigger value="preview" data-testid="tab-preview">Preview</TabsTrigger>
            <TabsTrigger value="shortlist" data-testid="tab-shortlist">Shortlist ({shortlist.length})</TabsTrigger>
            <TabsTrigger value="outreach" data-testid="tab-outreach">Outreach</TabsTrigger>
            <TabsTrigger value="export" data-testid="tab-export">Export</TabsTrigger>
          </TabsList>

          {/* ── Interview ─────────────────────────────────────────── */}
          <TabsContent value="interview">
            <Card className="bg-slate-900 border-white/5">
              <CardContent className="p-0">
                <div className="h-[55vh] overflow-y-auto p-6 space-y-4">
                  {messages.map(m => (
                    <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                      <div className={`max-w-[75%] rounded-2xl px-4 py-3 text-sm ${m.role === "user" ? "bg-gradient-to-br from-cyan-600 to-violet-700 text-white" : "bg-slate-800 text-slate-100 border border-white/5"}`}>
                        {m.content}
                      </div>
                    </div>
                  ))}
                  {interviewComplete && (
                    <div className="flex justify-center">
                      <div className="text-xs text-emerald-300 inline-flex items-center gap-2 bg-emerald-500/10 px-3 py-2 rounded-full">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Interview complete — click Generate RFP above.
                      </div>
                    </div>
                  )}
                  <div ref={messagesEndRef} />
                </div>
                <div className="border-t border-white/5 p-4 flex gap-2">
                  <Input
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder="Type your answer…"
                    onKeyDown={(e) => { if (e.key === "Enter" && draft.trim()) sendMutation.mutate(draft); }}
                    className="bg-slate-800 border-white/10"
                    data-testid="input-interview-message"
                  />
                  <Button
                    onClick={() => draft.trim() && sendMutation.mutate(draft)}
                    disabled={!draft.trim() || sendMutation.isPending}
                    className="bg-gradient-to-r from-cyan-500 to-violet-600"
                    data-testid="button-send-message"
                  >
                    {sendMutation.isPending ? <Clock className="w-4 h-4 animate-pulse" /> : <Send className="w-4 h-4" />}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Requirements ──────────────────────────────────────── */}
          <TabsContent value="requirements">
            <Card className="bg-slate-900 border-white/5">
              <CardHeader><CardTitle className="text-base">Requirements</CardTitle></CardHeader>
              <CardContent>
                {requirements.length === 0 ? (
                  <p className="text-sm text-slate-400">Requirements will be seeded automatically the first time you Generate the RFP, based on this market's feature catalogue and your must-haves.</p>
                ) : (
                  <div className="space-y-2">
                    {requirements.map(r => (
                      <div key={r.id} className="grid grid-cols-12 gap-3 items-center p-3 bg-slate-800/50 rounded border border-white/5">
                        <div className="col-span-5">
                          <div className="text-sm font-medium">{r.label}</div>
                          {r.description && <div className="text-xs text-slate-400 mt-0.5">{r.description}</div>}
                        </div>
                        <div className="col-span-2">
                          <Select value={r.priority} onValueChange={(v) => updateReqMutation.mutate({ reqId: r.id, body: { priority: v } })}>
                            <SelectTrigger className="bg-slate-900 border-white/10 h-8 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent className="bg-slate-900 border-white/10 text-slate-100">
                              <SelectItem value="must">Must</SelectItem>
                              <SelectItem value="should">Should</SelectItem>
                              <SelectItem value="nice">Nice</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="col-span-2">
                          <Select value={String(r.weight)} onValueChange={(v) => updateReqMutation.mutate({ reqId: r.id, body: { weight: Number(v) } })}>
                            <SelectTrigger className="bg-slate-900 border-white/10 h-8 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent className="bg-slate-900 border-white/10 text-slate-100">
                              {[1,2,3,4,5].map(n => <SelectItem key={n} value={String(n)}>Weight {n}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="col-span-2 text-xs text-slate-400">{r.kind}</div>
                        <div className="col-span-1 text-right">
                          <Button variant="ghost" size="sm" onClick={() => deleteReqMutation.mutate(r.id)} className="h-8 text-xs">×</Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Preview (per-section, each with a Regenerate button) ─ */}
          <TabsContent value="preview">
            {sections.length === 0 ? (
              <Card className="bg-slate-900 border-white/5">
                <CardContent className="p-6">
                  <p className="text-sm text-slate-400">Click <span className="font-medium">Generate RFP</span> above to produce the document.</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-4">
                {[...sections].sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0)).map(s => (
                  <Card key={s.id} className="bg-slate-900 border-white/5" data-testid={`section-${s.sectionKey}`}>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0">
                      <CardTitle className="text-base">{s.title}</CardTitle>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => regenSectionMutation.mutate(s.sectionKey)}
                        disabled={regenSectionMutation.isPending}
                        className="bg-slate-800 border-white/10 hover:bg-slate-700"
                        data-testid={`button-regenerate-${s.sectionKey}`}
                      >
                        <Sparkles className="w-3.5 h-3.5 mr-1.5" />
                        {regenSectionMutation.isPending && regenSectionMutation.variables === s.sectionKey ? "Regenerating…" : "Regenerate"}
                      </Button>
                    </CardHeader>
                    <CardContent>
                      <div className="prose prose-invert prose-sm max-w-none prose-headings:text-slate-100 prose-p:text-slate-200 prose-li:text-slate-200 prose-strong:text-slate-100 prose-table:text-slate-200 prose-th:text-slate-100 prose-td:border-white/10 prose-th:border-white/10">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{s.body || "_(empty)_"}</ReactMarkdown>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          {/* ── Shortlist ─────────────────────────────────────────── */}
          <TabsContent value="shortlist">
            <Card className="bg-slate-900 border-white/5">
              <CardHeader><CardTitle className="text-base">Vendor Shortlist (deterministic fit)</CardTitle></CardHeader>
              <CardContent>
                {shortlist.length === 0 ? (
                  <p className="text-sm text-slate-400">No shortlist yet — generate the RFP to score vendors.</p>
                ) : (
                  <div className="space-y-2">
                    {shortlist.map((s, i) => (
                      <div key={s.id} className="flex items-center gap-3 p-3 rounded border border-white/5 bg-slate-800/50">
                        <div className="text-xs text-slate-500 w-6">#{i + 1}</div>
                        <div className="flex-1">
                          <div className="font-medium text-sm">{s.vendor?.name}</div>
                          <div className="text-xs text-slate-400">{s.rationale}</div>
                        </div>
                        <div className="text-cyan-300 font-mono text-sm">{Number(s.fitScore ?? 0).toFixed(1)}</div>
                        <Button
                          variant={s.isIncluded ? "default" : "outline"}
                          size="sm"
                          onClick={() => toggleShortlistMutation.mutate({ entryId: s.id, isIncluded: !s.isIncluded })}
                          className={s.isIncluded ? "bg-gradient-to-r from-cyan-500 to-violet-600" : "bg-slate-800 border-white/10"}
                          data-testid={`button-toggle-shortlist-${s.id}`}
                        >
                          {s.isIncluded ? "Included" : "Excluded"}
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Outreach ──────────────────────────────────────────── */}
          <TabsContent value="outreach">
            <Card className="bg-slate-900 border-white/5">
              <CardHeader><CardTitle className="text-base">Vendor Outreach Tracker</CardTitle></CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {shortlist.filter(s => s.isIncluded).map(s => {
                    const row = outreach.find(o => o.vendorId === s.vendorId);
                    const base = (over: any) => ({
                      vendorId: s.vendorId,
                      status: row?.status || "not_started",
                      contactName: row?.contactName,
                      contactEmail: row?.contactEmail,
                      notes: row?.notes,
                      responseText: row?.responseText,
                      responseFileUrl: row?.responseFileUrl,
                      ...over,
                    });
                    return (
                      <div key={s.id} className="p-3 rounded border border-white/5 bg-slate-800/50 space-y-2" data-testid={`outreach-row-${s.vendorId}`}>
                        <div className="grid grid-cols-12 gap-3 items-center">
                          <div className="col-span-3 text-sm font-medium">{s.vendor?.name}</div>
                          <div className="col-span-2">
                            <Select value={row?.status || "not_started"} onValueChange={(v) => upsertOutreachMutation.mutate(base({ status: v }))}>
                              <SelectTrigger className="bg-slate-900 border-white/10 h-8 text-xs"><SelectValue /></SelectTrigger>
                              <SelectContent className="bg-slate-900 border-white/10 text-slate-100">
                                <SelectItem value="not_started">Not started</SelectItem>
                                <SelectItem value="invited">Invited</SelectItem>
                                <SelectItem value="declined">Declined</SelectItem>
                                <SelectItem value="responded">Responded</SelectItem>
                                <SelectItem value="awarded">Awarded</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <Input placeholder="Contact name" defaultValue={row?.contactName || ""}
                            onBlur={(e) => upsertOutreachMutation.mutate(base({ contactName: e.target.value }))}
                            className="col-span-3 bg-slate-900 border-white/10 h-8 text-xs"
                            data-testid={`input-contact-name-${s.vendorId}`} />
                          <Input placeholder="Email" defaultValue={row?.contactEmail || ""}
                            onBlur={(e) => upsertOutreachMutation.mutate(base({ contactEmail: e.target.value }))}
                            className="col-span-4 bg-slate-900 border-white/10 h-8 text-xs"
                            data-testid={`input-contact-email-${s.vendorId}`} />
                        </div>
                        <div className="grid grid-cols-12 gap-3 items-start">
                          <Textarea placeholder="Paste vendor's response text here…"
                            defaultValue={row?.responseText || ""}
                            onBlur={(e) => upsertOutreachMutation.mutate(base({ responseText: e.target.value }))}
                            className="col-span-8 bg-slate-900 border-white/10 text-xs min-h-[60px]"
                            data-testid={`input-response-text-${s.vendorId}`} />
                          <Input placeholder="Response file URL (https://…)"
                            defaultValue={row?.responseFileUrl || ""}
                            onBlur={(e) => upsertOutreachMutation.mutate(base({ responseFileUrl: e.target.value }))}
                            className="col-span-4 bg-slate-900 border-white/10 h-8 text-xs"
                            data-testid={`input-response-file-${s.vendorId}`} />
                        </div>
                      </div>
                    );
                  })}
                  {!shortlist.some(s => s.isIncluded) && (
                    <p className="text-sm text-slate-400">Include vendors in the Shortlist tab to track outreach.</p>
                  )}
                  {/* Compare-view: side-by-side response snippets */}
                  {outreach.some(o => o.responseText || o.responseFileUrl) && (
                    <div className="mt-6 pt-4 border-t border-white/5">
                      <div className="text-sm font-medium mb-2">Response comparison</div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {outreach.filter(o => o.responseText || o.responseFileUrl).map(o => (
                          <div key={o.id} className="p-3 rounded border border-white/5 bg-slate-900/70" data-testid={`compare-card-${o.vendorId}`}>
                            <div className="text-xs font-semibold text-cyan-300 mb-1">{o.vendor?.name}</div>
                            {o.responseFileUrl && (
                              <a href={o.responseFileUrl} target="_blank" rel="noreferrer" className="text-xs text-cyan-400 underline break-all">{o.responseFileUrl}</a>
                            )}
                            {o.responseText && (
                              <pre className="whitespace-pre-wrap text-xs text-slate-300 mt-2 max-h-40 overflow-y-auto font-sans">{o.responseText}</pre>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Export ───────────────────────────────────────────── */}
          <TabsContent value="export">
            <Card className="bg-slate-900 border-white/5">
              <CardHeader><CardTitle className="text-base">Download</CardTitle></CardHeader>
              <CardContent>
                {!rfp?.generatedMarkdown ? (
                  <p className="text-sm text-slate-400">Generate the RFP first to enable exports.</p>
                ) : (
                  <div className="flex flex-wrap gap-3">
                    <a href={`/api/me/rfps/${id}/export/pdf`} target="_blank" rel="noreferrer" data-testid="link-export-pdf">
                      <Button className="bg-slate-800 border border-white/10 hover:bg-slate-700"><FileDown className="w-4 h-4 mr-2" /> PDF</Button>
                    </a>
                    <a href={`/api/me/rfps/${id}/export/docx`} target="_blank" rel="noreferrer" data-testid="link-export-docx">
                      <Button className="bg-slate-800 border border-white/10 hover:bg-slate-700"><FileDown className="w-4 h-4 mr-2" /> DOCX</Button>
                    </a>
                    <a href={`/api/me/rfps/${id}/export/xlsx`} target="_blank" rel="noreferrer" data-testid="link-export-xlsx">
                      <Button className="bg-slate-800 border border-white/10 hover:bg-slate-700"><FileDown className="w-4 h-4 mr-2" /> XLSX</Button>
                    </a>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
