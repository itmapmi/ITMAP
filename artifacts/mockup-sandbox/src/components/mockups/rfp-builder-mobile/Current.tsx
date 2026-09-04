import { useMemo, useState } from "react";
import { ArrowRight, AlertCircle, FileText, Monitor, Plus, Trash2 } from "lucide-react";
import "./_group.css";

type RfpStatus = "draft" | "interviewing" | "generating" | "ready";
type RfpProject = { id: string; title: string; marketId: string; status: RfpStatus; updatedAt: string };
type Market = { id: string; name: string };

// Mirrors GET /api/me/rfps, GET /api/markets, and GET /api/me/rfps-status.
const markets: Market[] = [
  { id: "market-endpoint", name: "ITMAP for Endpoint Security" },
  { id: "market-sase", name: "ITMAP for Secure Access Service Edge" },
  { id: "market-observability", name: "ITMAP for Observability Platforms" },
];
const seedProjects: RfpProject[] = [
  { id: "rfp-acme", title: "Acme Corp — Endpoint Security RFP", marketId: "market-endpoint", status: "interviewing", updatedAt: "2025-02-18T16:10:00.000Z" },
  { id: "rfp-northstar", title: "Northstar — SASE Renewal", marketId: "market-sase", status: "generating", updatedAt: "2025-02-16T11:45:00.000Z" },
  { id: "rfp-meridian", title: "Meridian — Observability RFP", marketId: "market-observability", status: "draft", updatedAt: "2025-02-14T09:30:00.000Z" },
  { id: "rfp-horizon", title: "Horizon — Endpoint Selection", marketId: "market-endpoint", status: "ready", updatedAt: "2025-02-07T14:00:00.000Z" },
];

const activeStatuses: RfpStatus[] = ["draft", "interviewing", "generating"];
const labelMarket = (marketId: string) => markets.find((market) => market.id === marketId)?.name.replace(/^ITMAP for /i, "") ?? "";
const formatDate = (date: string) => new Date(date).toLocaleDateString("en-US");

export function Current() {
  const [projects, setProjects] = useState(seedProjects);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [marketId, setMarketId] = useState("");
  const status = useMemo(() => ({
    hasOpenAiKey: true,
    activeCount: projects.filter((project) => activeStatuses.includes(project.status)).length,
    activeLimit: 3,
    last24hCount: 1,
    dailyLimit: 5,
  }), [projects]);
  const atActiveLimit = status.activeCount >= status.activeLimit;
  const atDailyLimit = status.last24hCount >= status.dailyLimit;

  function startInterview() {
    if (!title || !marketId || atActiveLimit || atDailyLimit) return;
    setProjects((current) => [{ id: `rfp-${Date.now()}`, title, marketId, status: "draft", updatedAt: new Date().toISOString() }, ...current]);
    setTitle(""); setMarketId(""); setOpen(false);
  }

  return (
    <div className="rfp-current">
      <header className="rfp-mobile-header">
        <span className="rfp-brand">ITMAP</span>
        <button className="rfp-desktop-link" type="button"><Monitor size={14} />Desktop site</button>
      </header>
      <main className="rfp-page">
        <section>
          <h1 className="rfp-title">RFP Builder</h1>
          <p className="rfp-intro">Run a conversational interview and produce a customer-specific RFP, grounded in real market data.</p>
          <button className="rfp-gradient-button" type="button" onClick={() => setOpen(true)} data-testid="button-new-rfp"><Plus size={16} />New RFP</button>
        </section>

        {(atActiveLimit || atDailyLimit) && (
          <div className="rfp-limit" role="status">
            <AlertCircle size={16} />
            <span>{atDailyLimit ? `Daily limit reached (${status.last24hCount}/${status.dailyLimit} RFPs in 24 h). Try again tomorrow.` : `You have ${status.activeCount}/${status.activeLimit} active RFPs. Complete or delete one before starting another.`}</span>
          </div>
        )}

        <section className="rfp-grid" aria-label="RFP projects">
          {projects.map((project) => (
            <article className="rfp-card" key={project.id} data-testid={`card-rfp-${project.id}`}>
              <div className="rfp-card-head">
                <div className="rfp-card-row">
                  <h2 className="rfp-card-title">{project.title}</h2>
                  <span className={`rfp-status ${project.status}`}>{project.status}</span>
                </div>
                <p className="rfp-market">{labelMarket(project.marketId)}</p>
              </div>
              <div className="rfp-card-body">
                <p className="rfp-updated">Updated {formatDate(project.updatedAt)}</p>
                <div className="rfp-actions">
                  <button className="rfp-open" type="button" data-testid={`button-open-rfp-${project.id}`}>Open <ArrowRight size={16} /></button>
                  <button className="rfp-delete" type="button" aria-label={`Delete ${project.title}`} onClick={() => setProjects((current) => current.filter((item) => item.id !== project.id))} data-testid={`button-delete-rfp-${project.id}`}><Trash2 size={16} /></button>
                </div>
              </div>
            </article>
          ))}
        </section>
      </main>

      {open && (
        <div className="rfp-dialog-backdrop" role="presentation" onMouseDown={() => setOpen(false)}>
          <section className="rfp-dialog" role="dialog" aria-modal="true" aria-labelledby="rfp-dialog-title" onMouseDown={(event) => event.stopPropagation()}>
            <h2 id="rfp-dialog-title">Start a new RFP</h2>
            <label className="rfp-field">Working title
              <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Acme Corp — Endpoint Security RFP" data-testid="input-rfp-title" />
            </label>
            <label className="rfp-field">Market
              <select value={marketId} onChange={(event) => setMarketId(event.target.value)} data-testid="select-rfp-market">
                <option value="">Pick a market</option>
                {markets.map((market) => <option value={market.id} key={market.id}>{market.name.replace(/^ITMAP for /i, "")}</option>)}
              </select>
            </label>
            <div className="rfp-dialog-footer">
              <button className="rfp-cancel" type="button" onClick={() => setOpen(false)}>Cancel</button>
              <button className="rfp-start" type="button" onClick={startInterview} disabled={!title || !marketId || !status.hasOpenAiKey || atActiveLimit || atDailyLimit} data-testid="button-create-rfp">Start interview</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}