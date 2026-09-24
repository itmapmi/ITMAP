import { useEffect, useRef, useState, type ReactNode } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { track, trackDwell } from "@/lib/track";
import { apiRequest, apiRequestJson, queryClient } from "@/lib/queryClient";
import { getErrorMessage, isMissingLlmKeyError } from "@/lib/rfp-errors";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, ArrowRight, Send, Sparkles, FileDown, CheckCircle2, Clock, Upload, Trash2, SlidersHorizontal, FileText, RefreshCw, Trophy, Check, X, Mail, Download } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ObjectUploader } from "@/components/ObjectUploader";
import type { RfpProject, RfpInterviewMessage, RfpRequirement, RfpSection, InsertRfpOutreachEntry } from "@shared/schema";
import "@/styles/rfp-builder-mobile.css";

interface ShortlistRow { id: string; vendorId: string; fitScore: string | null; rationale: string | null; isIncluded: boolean; rank: number; vendor: { id: string; name: string; website: string | null } | null }
interface OutreachRow { id: string; vendorId: string; status: string; contactName: string | null; contactEmail: string | null; notes: string | null; responseText: string | null; responseFileUrl: string | null; invitedAt: string | null; respondedAt: string | null; vendor: { id: string; name: string } | null }
const fmtDate = (s: string | null | undefined) => s ? new Date(s).toLocaleDateString() : null;

// Guided step order used for the mobile wizard — same tab keys as the
// desktop Tabs, just navigated one at a time instead of via a tab strip.
const STEPS = [
  { key: "interview", label: "Interview" },
  { key: "requirements", label: "Requirements" },
  { key: "preview", label: "Preview" },
  { key: "shortlist", label: "Shortlist" },
  { key: "outreach", label: "Outreach" },
  { key: "export", label: "Export" },
] as const;

export default function MyRfpDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const [location, setLocation] = useLocation();
  // Registered at both /me/rfps/:id and /mobile/me/rfps/:id (see
  // shared/mobile-paths.ts and App.tsx) — mobileMode swaps the tab strip for
  // a guided step-by-step wizard with Back/Next, better suited to a phone.
  const mobileMode = location.startsWith("/mobile/");
  const [tab, setTab] = useState<string>("interview");
  const stepIndex = Math.max(0, STEPS.findIndex(s => s.key === tab));
  const goToStep = (i: number) => setTab(STEPS[Math.max(0, Math.min(STEPS.length - 1, i))].key);
  const [draft, setDraft] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { data: rfp } = useQuery<RfpProject & { readiness?: { ready: boolean; missing: string[]; filled: number; total: number } }>({ queryKey: ["/api/me/rfps", id] });
  const { data: messages = [] } = useQuery<RfpInterviewMessage[]>({ queryKey: ["/api/me/rfps", id, "messages"] });
  const { data: requirements = [] } = useQuery<RfpRequirement[]>({ queryKey: ["/api/me/rfps", id, "requirements"] });
  const { data: sections = [] } = useQuery<RfpSection[]>({ queryKey: ["/api/me/rfps", id, "sections"] });
  const { data: shortlist = [] } = useQuery<ShortlistRow[]>({ queryKey: ["/api/me/rfps", id, "shortlist"] });
  const { data: outreach = [] } = useQuery<OutreachRow[]>({ queryKey: ["/api/me/rfps", id, "outreach"] });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  // Track intent when the user opens an RFP — viewing a market RFP is a strong research signal.
  useEffect(() => {
    if (!rfp) return;
    track("market_viewed", { marketId: rfp.marketId, metadata: { context: "rfp_detail", rfpId: rfp.id, status: rfp.status } });
    const endDwell = trackDwell({ marketId: rfp.marketId, metadata: { rfpId: rfp.id } });
    return endDwell;
  }, [rfp?.id]);

  const sendMutation = useMutation({
    mutationFn: async (content: string) => apiRequestJson(`/api/me/rfps/${id}/messages`, "POST", { content }),
    onSuccess: () => {
      setDraft("");
      queryClient.invalidateQueries({ queryKey: ["/api/me/rfps", id, "messages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/me/rfps", id] });
    },
    onError: (e: unknown) => {
      if (isMissingLlmKeyError(e)) {
        toast({ title: "OpenAI key required", description: "Add your OpenAI API key in Settings → LLM Keys.", variant: "destructive" });
        setLocation("/me/settings/llm-keys");
        return;
      }
      toast({ title: "Could not send", description: getErrorMessage(e), variant: "destructive" });
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
    onError: (e: unknown) => {
      if (isMissingLlmKeyError(e)) {
        toast({ title: "OpenAI key required", description: "Add your OpenAI API key in Settings → LLM Keys.", variant: "destructive" });
        setLocation("/me/settings/llm-keys");
        return;
      }
      toast({ title: "Generation failed", description: getErrorMessage(e), variant: "destructive" });
    },
  });

  type RequirementPatch = Partial<Pick<RfpRequirement, "label" | "description" | "priority" | "weight" | "expectedValue" | "displayOrder" | "kind" | "featureId">>;
  const updateReqMutation = useMutation({
    mutationFn: async ({ reqId, body }: { reqId: string; body: RequirementPatch }) => apiRequestJson(`/api/me/rfps/${id}/requirements/${reqId}`, "PATCH", body),
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
  type OutreachPayload = Omit<InsertRfpOutreachEntry, "rfpId">;
  const upsertOutreachMutation = useMutation({
    mutationFn: async (body: OutreachPayload) => apiRequestJson(`/api/me/rfps/${id}/outreach`, "POST", body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/me/rfps", id, "outreach"] }),
  });
  const regenSectionMutation = useMutation({
    mutationFn: async (sectionKey: string) => apiRequestJson(`/api/me/rfps/${id}/sections/${sectionKey}/regenerate`, "POST"),
    onSuccess: () => {
      toast({ title: "Section regenerated" });
      queryClient.invalidateQueries({ queryKey: ["/api/me/rfps", id, "sections"] });
      queryClient.invalidateQueries({ queryKey: ["/api/me/rfps", id] });
    },
    onError: (e: unknown) => {
      if (isMissingLlmKeyError(e)) {
        toast({ title: "OpenAI key required", description: "Add your OpenAI API key in Settings → LLM Keys.", variant: "destructive" });
        setLocation("/me/settings/llm-keys");
        return;
      }
      toast({ title: "Regeneration failed", description: getErrorMessage(e), variant: "destructive" });
    },
  });

  const profile = (rfp?.customerProfile ?? {}) as Record<string, unknown>;
  // Readiness is computed server-side (single source of truth: `profileReadiness`).
  // The server returns it on GET /api/me/rfps/:id alongside the project row.
  const filledSlots = rfp?.readiness?.filled ?? 0;
  const totalSlots = rfp?.readiness?.total ?? 14;
  const missingCritical = rfp?.readiness?.missing ?? [];
  const interviewReady = !!rfp?.readiness?.ready;
  const interviewComplete = interviewReady;

  if (mobileMode) {
    const step = STEPS[stepIndex];
    const sortedSections = [...sections].sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0));
    const generateLabel = generateMutation.isPending ? "Generating…" : rfp?.status === "ready" ? "Regenerate" : "Generate";
    const sectionHeading = (
      title: string,
      subtitle: string,
      icon: ReactNode,
    ) => (
      <div className="rfpm-row" style={{ alignItems: "flex-start" }}>
        <div><h1 className="rfpm-h1">{title}</h1><p className="rfpm-sub">{subtitle}</p></div>
        {icon}
      </div>
    );

    return (
      <div className="rfp-mobile">
        <main className="rfpm-main">
          <div className="rfpm-row" style={{ alignItems: "flex-start" }}>
            <div style={{ minWidth: 0 }}>
              <div className="rfpm-kicker">ACTIVE RFP</div>
              <div className="rfpm-title" style={{ fontSize: 16, marginTop: 4 }}>{rfp?.title || "RFP"}</div>
              <div className="rfpm-meta">{filledSlots}/{totalSlots} slots · <span style={{ color: "var(--rfp-text)" }}>{rfp?.status || "loading"}</span></div>
            </div>
            <button
              className="rfpm-btn primary"
              onClick={() => generateMutation.mutate()}
              disabled={generateMutation.isPending || !interviewReady}
              title={interviewReady ? undefined : `Need critical slots: ${missingCritical.join(", ") || "8 of 14 total"}`}
              data-testid="button-generate-rfp"
            >
              <Sparkles size={14} /> {generateLabel}
            </button>
          </div>
          <div className="rfpm-step">
            <div className="rfpm-stepbar">{STEPS.map((s, i) => <i key={s.key} className={i <= stepIndex ? "on" : ""} />)}</div>
            <div className="rfpm-steptext">Step {stepIndex + 1} of 6 · {step.label}</div>
          </div>
        </main>

        <main className="rfpm-main flush">
          {tab === "interview" && (
            <>
              <div className="rfpm-row">
                <h1 className="rfpm-h1">Discovery interview</h1>
                <span className="rfpm-mini">{filledSlots} / {totalSlots} SLOTS</span>
              </div>
              <div className="rfpm-chat">
                {messages.map((m) => (
                  <div className={`rfpm-msg ${m.role === "user" ? "user" : ""}`} key={m.id}>
                    <small>{m.role === "user" ? "YOU" : "ITMAP ANALYST"}</small>{m.content}
                  </div>
                ))}
                {sendMutation.isPending && <div className="rfpm-msg"><small>ITMAP ANALYST</small><Clock size={13} className="animate-pulse" /> Thinking…</div>}
                <div className="rfpm-card" style={{ color: interviewComplete ? "var(--rfp-lime)" : "var(--rfp-amber)", fontSize: 11 }}>
                  <CheckCircle2 size={14} style={{ display: "inline", marginRight: 6 }} />
                  {interviewComplete ? "Interview complete · ready to generate" : `Interview in progress · ${missingCritical.length} critical slots remain`}
                </div>
                <div ref={messagesEndRef} />
              </div>
              <div className="rfpm-compose">
                <input
                  className="rfpm-input"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && draft.trim() && !sendMutation.isPending) sendMutation.mutate(draft.trim()); }}
                  placeholder="Type your answer…"
                  data-testid="input-interview-message"
                />
                <button className="rfpm-btn primary" onClick={() => draft.trim() && sendMutation.mutate(draft.trim())} disabled={!draft.trim() || sendMutation.isPending} data-testid="button-send-message">
                  {sendMutation.isPending ? <Clock size={14} className="animate-pulse" /> : <Send size={14} />}
                </button>
              </div>
              {!interviewReady && <div className="rfpm-alert"><Clock size={13} /> Generate RFP is unavailable until all critical slots are captured.</div>}
            </>
          )}

          {tab === "requirements" && (
            <>
              {sectionHeading("Requirements", "Generated from your interview and market catalogue.", <SlidersHorizontal size={16} color="var(--rfp-cyan)" />)}
              <div style={{ marginTop: 18 }}>
                {requirements.length === 0 ? <div className="rfpm-empty">Generate the RFP to seed weighted requirements.</div> : requirements.map((r) => (
                  <article className="rfpm-card" key={r.id} data-testid={`row-requirement-${r.id}`}>
                    <div className="rfpm-row" style={{ alignItems: "flex-start" }}>
                      <h2 className="rfpm-title">{r.label}</h2>
                      <button className="rfpm-btn ghost" onClick={() => deleteReqMutation.mutate(r.id)} aria-label={`Delete ${r.label}`}><Trash2 size={14} /></button>
                    </div>
                    {r.description && <p className="rfpm-meta">{r.description}</p>}
                    <p className="rfpm-meta">{r.kind} requirement</p>
                    <div className="rfpm-row">
                      <select className="rfpm-select" value={r.priority} onChange={(e) => updateReqMutation.mutate({ reqId: r.id, body: { priority: e.target.value } })}>
                        <option value="must">must</option><option value="should">should</option><option value="nice">nice</option>
                      </select>
                      <select className="rfpm-select" value={String(r.weight)} onChange={(e) => updateReqMutation.mutate({ reqId: r.id, body: { weight: Number(e.target.value) } })}>
                        {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>Weight {n}</option>)}
                      </select>
                    </div>
                  </article>
                ))}
              </div>
            </>
          )}

          {tab === "preview" && (
            <>
              {sectionHeading("Document preview", "Generated markdown · current document", <FileText size={19} color="var(--rfp-cyan)" />)}
              <div style={{ marginTop: 18 }}>
                {sortedSections.length === 0 ? <div className="rfpm-empty">Generate the RFP to produce the document.</div> : sortedSections.map((s, index) => (
                  <article className="rfpm-card" key={s.id} data-testid={`section-${s.sectionKey}`}>
                    <div className="rfpm-row" style={{ alignItems: "flex-start" }}>
                      <div><span className="rfpm-kicker">{String(index + 1).padStart(2, "0")}</span><h2 className="rfpm-title" style={{ marginTop: 5 }}>{s.title}</h2></div>
                      <button className="rfpm-btn" onClick={() => regenSectionMutation.mutate(s.sectionKey)} disabled={regenSectionMutation.isPending} data-testid={`button-regenerate-${s.sectionKey}`}>
                        <RefreshCw size={13} /> {regenSectionMutation.isPending && regenSectionMutation.variables === s.sectionKey ? "Regenerating…" : "Regenerate"}
                      </button>
                    </div>
                    <div className="rfpm-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{s.body || "_(empty)_"}</ReactMarkdown></div>
                  </article>
                ))}
              </div>
            </>
          )}

          {tab === "shortlist" && (
            <>
              {sectionHeading("Vendor shortlist", "Deterministic fit against your weighted requirements.", <Trophy size={18} color="var(--rfp-amber)" />)}
              <div style={{ marginTop: 18 }}>
                {shortlist.length === 0 ? <div className="rfpm-empty">Generate the RFP to score vendors.</div> : shortlist.map((s, index) => (
                  <article className="rfpm-card" key={s.id}>
                    <div className="rfpm-row"><span className="rfpm-kicker">RANK #{s.rank || index + 1}</span><span className="rfpm-score">{Number(s.fitScore || 0).toFixed(1)}</span></div>
                    <h2 className="rfpm-title" style={{ marginTop: 8 }}>{s.vendor?.name || "Vendor"}</h2>
                    <p className="rfpm-meta">{s.rationale}</p>
                    <button className={`rfpm-btn ${s.isIncluded ? "primary" : "ghost"}`} style={{ width: "100%", marginTop: 7 }} onClick={() => toggleShortlistMutation.mutate({ entryId: s.id, isIncluded: !s.isIncluded })} data-testid={`button-toggle-shortlist-${s.id}`}>
                      {s.isIncluded ? <><Check size={14} /> Included</> : <><X size={14} /> Excluded</>}
                    </button>
                  </article>
                ))}
              </div>
            </>
          )}

          {tab === "outreach" && (
            <>
              {sectionHeading("Outreach tracker", "Capture vendor contact details and responses.", <Mail size={18} color="var(--rfp-cyan)" />)}
              <div style={{ marginTop: 18 }}>
                {shortlist.filter((s) => s.isIncluded).map((s) => {
                  const row = outreach.find((o) => o.vendorId === s.vendorId);
                  const base = (over: Partial<OutreachPayload>): OutreachPayload => ({
                    vendorId: s.vendorId, status: row?.status || "not_started", contactName: row?.contactName,
                    contactEmail: row?.contactEmail, notes: row?.notes, responseText: row?.responseText,
                    responseFileUrl: row?.responseFileUrl, ...over,
                  });
                  return (
                    <article className="rfpm-card" key={s.id} data-testid={`outreach-row-${s.vendorId}`}>
                      <div className="rfpm-row">
                        <h2 className="rfpm-title">{s.vendor?.name || "Vendor"}</h2>
                        <span className={`rfpm-tag ${row?.status === "responded" || row?.status === "awarded" ? "ready" : ""}`}>{row?.status === "invited" ? "sent" : (row?.status || "draft").replace("_", " ")}</span>
                      </div>
                      {(row?.invitedAt || row?.respondedAt) && <p className="rfpm-meta">{fmtDate(row.invitedAt) && `Sent ${fmtDate(row.invitedAt)}`} {fmtDate(row.respondedAt) && `· Replied ${fmtDate(row.respondedAt)}`}</p>}
                      <select className="rfpm-select" style={{ marginTop: 11 }} value={row?.status || "not_started"} onChange={(e) => upsertOutreachMutation.mutate(base({ status: e.target.value }))}>
                        <option value="not_started">Draft</option><option value="invited">Sent</option><option value="declined">Declined</option><option value="responded">Responded</option><option value="awarded">Awarded</option>
                      </select>
                      <input key={`cn-${row?.id || "new"}`} className="rfpm-input" style={{ marginTop: 8 }} defaultValue={row?.contactName || ""} placeholder="Contact name" onBlur={(e) => upsertOutreachMutation.mutate(base({ contactName: e.target.value }))} />
                      <input key={`ce-${row?.id || "new"}`} className="rfpm-input" style={{ marginTop: 8 }} defaultValue={row?.contactEmail || ""} placeholder="Contact email" type="email" onBlur={(e) => upsertOutreachMutation.mutate(base({ contactEmail: e.target.value }))} />
                      <textarea key={`notes-${row?.id || "new"}`} className="rfpm-textarea" style={{ marginTop: 8 }} defaultValue={row?.notes || ""} placeholder="Outreach notes…" rows={2} onBlur={(e) => upsertOutreachMutation.mutate(base({ notes: e.target.value }))} />
                      <textarea key={`rt-${row?.id || "new"}`} className="rfpm-textarea" style={{ marginTop: 8 }} defaultValue={row?.responseText || ""} placeholder="Paste vendor response text here…" rows={3} onBlur={(e) => upsertOutreachMutation.mutate(base({ responseText: e.target.value }))} />
                      <ObjectUploader
                        maxNumberOfFiles={1}
                        maxFileSize={26214400}
                        onGetUploadParameters={async () => {
                          const result = await apiRequestJson("/api/objects/upload", "POST") as { uploadURL: string };
                          return { method: "PUT" as const, url: result.uploadURL };
                        }}
                        onComplete={(result) => {
                          const url = result?.successful?.[0]?.uploadURL;
                          if (url) upsertOutreachMutation.mutate(base({ responseFileUrl: url }));
                        }}
                        buttonClassName="rfpm-upload"
                      >
                        <span><Upload size={13} style={{ display: "inline", marginRight: 6 }} />Upload response file · one file, up to 25MB</span>
                      </ObjectUploader>
                      {row?.responseFileUrl && <a href={row.responseFileUrl} target="_blank" rel="noreferrer" className="rfpm-meta" style={{ display: "block", color: "var(--rfp-cyan)" }}>View uploaded file</a>}
                    </article>
                  );
                })}
                {!shortlist.some((s) => s.isIncluded) && <div className="rfpm-empty">Include vendors in the Shortlist step to track outreach.</div>}
              </div>
            </>
          )}

          {tab === "export" && (
            <>
              {sectionHeading("Export RFP", "Download the generated document in your preferred format.", <CheckCircle2 size={18} color="var(--rfp-lime)" />)}
              {rfp?.generatedMarkdown ? (
                <>
                  <div className="rfpm-card" style={{ marginTop: 20 }}>
                    <div className="rfpm-kicker">DOCUMENT READY</div>
                    <h2 className="rfpm-title" style={{ fontSize: 17, marginTop: 8 }}>{rfp.title}</h2>
                    <p className="rfpm-meta">Generated markdown available · {sections.length} sections · {requirements.length} requirements</p>
                  </div>
                  {(["pdf", "docx", "xlsx"] as const).map((format) => (
                    <a className="rfpm-card" href={`/api/me/rfps/${id}/export/${format}`} target="_blank" rel="noreferrer" key={format} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", color: "var(--rfp-text)", textDecoration: "none" }} data-testid={`link-export-${format}`}>
                      <span style={{ display: "flex", gap: 10, alignItems: "center" }}><FileText size={17} color="var(--rfp-cyan)" /><span><b style={{ fontSize: 13 }}>Download {format.toUpperCase()}</b><small className="rfpm-meta" style={{ display: "block" }}>Generated from current RFP</small></span></span>
                      <Download size={15} color="var(--rfp-cyan)" />
                    </a>
                  ))}
                </>
              ) : <div className="rfpm-empty" style={{ marginTop: 20 }}>Generate the RFP first to enable exports.</div>}
            </>
          )}
        </main>

        <div className="rfpm-footer">
          <button className="rfpm-btn ghost" onClick={() => goToStep(stepIndex - 1)} disabled={stepIndex === 0} data-testid="button-wizard-back"><ArrowLeft size={14} /> Back</button>
          <button className="rfpm-btn primary" onClick={() => goToStep(stepIndex + 1)} disabled={stepIndex === STEPS.length - 1} data-testid="button-wizard-next">
            Next: {STEPS[Math.min(stepIndex + 1, STEPS.length - 1)].label} <ArrowRight size={14} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`min-h-screen bg-slate-950 text-slate-100 ${mobileMode ? "pb-24" : ""}`}>
      <div className={mobileMode ? "px-4 py-5" : "max-w-6xl mx-auto px-6 py-8"}>
        {mobileMode ? (
          <div className="mb-5">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <h1 className="text-lg font-bold truncate">{rfp?.title || "RFP"}</h1>
                <p className="text-xs text-slate-400 mt-0.5">
                  {filledSlots}/{totalSlots} slots · <span className="font-medium text-slate-200">{rfp?.status}</span>
                </p>
              </div>
              <Button
                size="sm"
                onClick={() => generateMutation.mutate()}
                disabled={generateMutation.isPending || !interviewReady}
                title={interviewReady ? undefined : `Need critical slots: ${missingCritical.join(", ") || "10 of 14 total"}`}
                className="bg-gradient-to-r from-cyan-500 to-violet-600 flex-shrink-0"
                data-testid="button-generate-rfp"
              >
                <Sparkles className="w-4 h-4" />
              </Button>
            </div>
            {/* Step progress — the wizard's only "tab strip" on mobile */}
            <div className="mt-4 flex items-center gap-1.5">
              {STEPS.map((s, i) => (
                <div key={s.key} className={`h-1.5 flex-1 rounded-full transition-colors ${i <= stepIndex ? "bg-gradient-to-r from-cyan-500 to-violet-600" : "bg-slate-800"}`} />
              ))}
            </div>
            <p className="text-xs text-slate-500 mt-2">Step {stepIndex + 1} of {STEPS.length}: {STEPS[stepIndex].label}</p>
          </div>
        ) : (
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
        )}

        <Tabs value={tab} onValueChange={setTab}>
          {!mobileMode && (
            <TabsList className="bg-slate-900 border border-white/5">
              <TabsTrigger value="interview" data-testid="tab-interview">Interview</TabsTrigger>
              <TabsTrigger value="requirements" data-testid="tab-requirements">Requirements ({requirements.length})</TabsTrigger>
              <TabsTrigger value="preview" data-testid="tab-preview">Preview</TabsTrigger>
              <TabsTrigger value="shortlist" data-testid="tab-shortlist">Shortlist ({shortlist.length})</TabsTrigger>
              <TabsTrigger value="outreach" data-testid="tab-outreach">Outreach</TabsTrigger>
              <TabsTrigger value="export" data-testid="tab-export">Export</TabsTrigger>
            </TabsList>
          )}

          {/* ── Interview ─────────────────────────────────────────── */}
          <TabsContent value="interview">
            <Card className="bg-slate-900 border-white/5 text-slate-100">
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
                    className="bg-slate-800 border-white/10 text-slate-100 placeholder:text-slate-500"
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
            <Card className="bg-slate-900 border-white/5 text-slate-100">
              <CardHeader><CardTitle className="text-base">Requirements</CardTitle></CardHeader>
              <CardContent>
                {requirements.length === 0 ? (
                  <p className="text-sm text-slate-400">Requirements will be seeded automatically the first time you Generate the RFP, based on this market's feature catalogue and your must-haves.</p>
                ) : (
                  <div className="space-y-2">
                    {requirements.map(r => {
                      const prioritySelect = (
                        <Select value={r.priority} onValueChange={(v) => updateReqMutation.mutate({ reqId: r.id, body: { priority: v } })}>
                          <SelectTrigger className="bg-slate-900 border-white/10 h-8 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent className="bg-slate-900 border-white/10 text-slate-100">
                            <SelectItem value="must">Must</SelectItem>
                            <SelectItem value="should">Should</SelectItem>
                            <SelectItem value="nice">Nice</SelectItem>
                          </SelectContent>
                        </Select>
                      );
                      const weightSelect = (
                        <Select value={String(r.weight)} onValueChange={(v) => updateReqMutation.mutate({ reqId: r.id, body: { weight: Number(v) } })}>
                          <SelectTrigger className="bg-slate-900 border-white/10 h-8 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent className="bg-slate-900 border-white/10 text-slate-100">
                            {[1,2,3,4,5].map(n => <SelectItem key={n} value={String(n)}>Weight {n}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      );
                      return mobileMode ? (
                        <div key={r.id} className="p-3 bg-slate-800/50 rounded border border-white/5 space-y-2" data-testid={`row-requirement-${r.id}`}>
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="text-sm font-medium">{r.label}</div>
                              {r.description && <div className="text-xs text-slate-400 mt-0.5">{r.description}</div>}
                            </div>
                            <Button variant="ghost" size="sm" onClick={() => deleteReqMutation.mutate(r.id)} className="h-8 text-xs flex-shrink-0 text-slate-100 hover:text-white">×</Button>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="flex-1">{prioritySelect}</div>
                            <div className="flex-1">{weightSelect}</div>
                            <span className="text-xs text-slate-400 flex-shrink-0">{r.kind}</span>
                          </div>
                        </div>
                      ) : (
                        <div key={r.id} className="grid grid-cols-12 gap-3 items-center p-3 bg-slate-800/50 rounded border border-white/5">
                          <div className="col-span-5">
                            <div className="text-sm font-medium">{r.label}</div>
                            {r.description && <div className="text-xs text-slate-400 mt-0.5">{r.description}</div>}
                          </div>
                          <div className="col-span-2">{prioritySelect}</div>
                          <div className="col-span-2">{weightSelect}</div>
                          <div className="col-span-2 text-xs text-slate-400">{r.kind}</div>
                          <div className="col-span-1 text-right">
                            <Button variant="ghost" size="sm" onClick={() => deleteReqMutation.mutate(r.id)} className="h-8 text-xs text-slate-100 hover:text-white">×</Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Preview (per-section, each with a Regenerate button) ─ */}
          <TabsContent value="preview">
            {sections.length === 0 ? (
              <Card className="bg-slate-900 border-white/5 text-slate-100">
                <CardContent className="p-6">
                  <p className="text-sm text-slate-400">Click <span className="font-medium">Generate RFP</span> above to produce the document.</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-4">
                {[...sections].sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0)).map(s => (
                  <Card key={s.id} className="bg-slate-900 border-white/5 text-slate-100" data-testid={`section-${s.sectionKey}`}>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0">
                      <CardTitle className="text-base">{s.title}</CardTitle>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => regenSectionMutation.mutate(s.sectionKey)}
                        disabled={regenSectionMutation.isPending}
                        className="bg-slate-800 border-white/10 hover:bg-slate-700 text-slate-100"
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
            <Card className="bg-slate-900 border-white/5 text-slate-100">
              <CardHeader><CardTitle className="text-base">Vendor Shortlist (deterministic fit)</CardTitle></CardHeader>
              <CardContent>
                {shortlist.length === 0 ? (
                  <p className="text-sm text-slate-400">No shortlist yet — generate the RFP to score vendors.</p>
                ) : (
                  <div className="space-y-2">
                    {shortlist.map((s, i) => (
                      <div key={s.id} className={mobileMode ? "flex flex-wrap items-center gap-2 p-3 rounded border border-white/5 bg-slate-800/50" : "flex items-center gap-3 p-3 rounded border border-white/5 bg-slate-800/50"}>
                        <div className="text-xs text-slate-500 w-6">#{i + 1}</div>
                        <div className={mobileMode ? "w-full order-1" : "flex-1"}>
                          <div className="font-medium text-sm">{s.vendor?.name}</div>
                          <div className="text-xs text-slate-400">{s.rationale}</div>
                        </div>
                        <div className="text-cyan-300 font-mono text-sm">{Number(s.fitScore ?? 0).toFixed(1)}</div>
                        <Button
                          variant={s.isIncluded ? "default" : "outline"}
                          size="sm"
                          onClick={() => toggleShortlistMutation.mutate({ entryId: s.id, isIncluded: !s.isIncluded })}
                          className={s.isIncluded ? "bg-gradient-to-r from-cyan-500 to-violet-600" : "bg-slate-800 border-white/10 text-slate-100"}
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
            <Card className="bg-slate-900 border-white/5 text-slate-100">
              <CardHeader><CardTitle className="text-base">Vendor Outreach Tracker</CardTitle></CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {shortlist.filter(s => s.isIncluded).map(s => {
                    const row = outreach.find(o => o.vendorId === s.vendorId);
                    const base = (over: Partial<OutreachPayload>): OutreachPayload => ({
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
                        {/* mobileMode swaps to a single-column grid so the
                            col-span-N utilities below simply stack full-width
                            instead of trying to fit a 12-col layout on a phone. */}
                        <div className={mobileMode ? "grid grid-cols-1 gap-2" : "grid grid-cols-12 gap-3 items-center"}>
                          <div className="col-span-3 text-sm font-medium">
                            {s.vendor?.name}
                            <div className="text-[10px] text-slate-400 mt-0.5 space-x-2">
                              {fmtDate(row?.invitedAt) && <span data-testid={`outreach-invited-${s.vendorId}`}>Sent {fmtDate(row?.invitedAt)}</span>}
                              {fmtDate(row?.respondedAt) && <span data-testid={`outreach-responded-${s.vendorId}`}>Replied {fmtDate(row?.respondedAt)}</span>}
                            </div>
                          </div>
                          <div className="col-span-2">
                            <Select value={row?.status || "not_started"} onValueChange={(v) => upsertOutreachMutation.mutate(base({ status: v }))}>
                              <SelectTrigger className="bg-slate-900 border-white/10 h-8 text-xs"><SelectValue /></SelectTrigger>
                              <SelectContent className="bg-slate-900 border-white/10 text-slate-100">
                                <SelectItem value="not_started">Draft</SelectItem>
                                <SelectItem value="invited">Sent</SelectItem>
                                <SelectItem value="declined">Declined</SelectItem>
                                <SelectItem value="responded">Responded</SelectItem>
                                <SelectItem value="awarded">Awarded</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <Input key={`cn-${row?.id || "new"}`} placeholder="Contact name" defaultValue={row?.contactName || ""}
                            onBlur={(e) => upsertOutreachMutation.mutate(base({ contactName: e.target.value }))}
                            className="col-span-3 bg-slate-900 border-white/10 h-8 text-xs"
                            data-testid={`input-contact-name-${s.vendorId}`} />
                          <Input key={`ce-${row?.id || "new"}`} placeholder="Email" defaultValue={row?.contactEmail || ""}
                            onBlur={(e) => upsertOutreachMutation.mutate(base({ contactEmail: e.target.value }))}
                            className="col-span-4 bg-slate-900 border-white/10 h-8 text-xs"
                            data-testid={`input-contact-email-${s.vendorId}`} />
                        </div>
                        <div className={mobileMode ? "grid grid-cols-1 gap-2" : "grid grid-cols-12 gap-3 items-start"}>
                          <Textarea key={`rt-${row?.id || "new"}`} placeholder="Paste vendor's response text here…"
                            defaultValue={row?.responseText || ""}
                            onBlur={(e) => upsertOutreachMutation.mutate(base({ responseText: e.target.value }))}
                            className="col-span-8 bg-slate-900 border-white/10 text-xs min-h-[60px]"
                            data-testid={`input-response-text-${s.vendorId}`} />
                          <div className="col-span-4 space-y-1">
                            <ObjectUploader
                              maxNumberOfFiles={1}
                              maxFileSize={26214400}
                              onGetUploadParameters={async () => {
                                const r = await apiRequestJson("/api/objects/upload", "POST") as { uploadURL: string };
                                return { method: "PUT" as const, url: r.uploadURL };
                              }}
                              onComplete={(result) => {
                                const url = result?.successful?.[0]?.uploadURL;
                                if (!url) return;
                                upsertOutreachMutation.mutate(base({ responseFileUrl: url }));
                                toast({ title: "Response file uploaded" });
                              }}
                              buttonClassName="w-full bg-slate-900 border border-white/10 hover:bg-slate-800 h-8 text-xs px-2"
                            >
                              <span className="flex items-center gap-1 text-xs" data-testid={`button-upload-response-${s.vendorId}`}>
                                <Upload className="w-3 h-3" /> Upload response file
                              </span>
                            </ObjectUploader>
                            {row?.responseFileUrl && (
                              <a href={row.responseFileUrl} target="_blank" rel="noreferrer"
                                className="block text-[10px] text-cyan-400 underline truncate"
                                data-testid={`link-response-file-${s.vendorId}`}>
                                View uploaded file
                              </a>
                            )}
                          </div>
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
            <Card className="bg-slate-900 border-white/5 text-slate-100">
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

      {/* Guided wizard footer — replaces the tab strip with Back/Next */}
      {mobileMode && (
        <div className="fixed bottom-0 inset-x-0 bg-slate-900 border-t border-white/10 px-4 py-3 flex items-center gap-2 z-10">
          <Button
            variant="outline"
            onClick={() => goToStep(stepIndex - 1)}
            disabled={stepIndex === 0}
            className="flex-1 bg-slate-800 border-white/10 hover:bg-slate-700 text-slate-100"
            data-testid="button-wizard-back"
          >
            Back
          </Button>
          <Button
            onClick={() => goToStep(stepIndex + 1)}
            disabled={stepIndex === STEPS.length - 1}
            className="flex-1 bg-gradient-to-r from-cyan-500 to-violet-600"
            data-testid="button-wizard-next"
          >
            Next: {STEPS[Math.min(stepIndex + 1, STEPS.length - 1)].label}
          </Button>
        </div>
      )}
    </div>
  );
}
