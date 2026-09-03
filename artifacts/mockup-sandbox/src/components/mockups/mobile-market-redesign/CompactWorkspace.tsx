import { useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  FileText,
  Info,
  Layers3,
  LockKeyhole,
  MoreHorizontal,
  Network,
  PanelTop,
  SlidersHorizontal,
  Sparkles,
  X,
} from "lucide-react";
import "./_group.css";

type View = "position" | "product" | "ecosystem";
type Sheet = "definition" | "criteria" | "vendor" | "notes" | null;

const vendors = [
  { name: "Dell Technologies", short: "Dell", product: "PowerProtect Data Domain", x: 77, y: 82, color: "#047c91", score: "8.7", stance: "Leader" },
  { name: "HPE", short: "HPE", product: "StoreOnce", x: 64, y: 73, color: "#d15d39", score: "7.9", stance: "Leader" },
  { name: "ExaGrid", short: "ExaGrid", product: "Tiered Backup Storage", x: 73, y: 64, color: "#254c7a", score: "7.6", stance: "Visionary" },
  { name: "Quantum", short: "Quantum", product: "DXi-Series", x: 53, y: 55, color: "#82664e", score: "6.8", stance: "Challenger" },
  { name: "IBM", short: "IBM", product: "Storage Protect", x: 44, y: 67, color: "#735b8c", score: "6.5", stance: "Challenger" },
];

const research = {
  product: [
    { label: "Core data reduction", detail: "Inline deduplication, compression and scale-out storage", ratings: [4, 4, 4, 3, 3] },
    { label: "Cyber resilience", detail: "Immutable retention, anomaly detection and clean recovery", ratings: [4, 3, 3, 3, 3] },
    { label: "Recovery performance", detail: "Instant access, replication and rapid restore controls", ratings: [4, 3, 4, 3, 3] },
  ],
  ecosystem: [
    { label: "Backup software", detail: "Veeam, Commvault Cloud and Veritas NetBackup", ratings: [4, 4, 4, 3, 3] },
    { label: "Cloud & platform", detail: "AWS, Azure, Google Cloud, VMware and Kubernetes", ratings: [4, 4, 3, 3, 3] },
    { label: "Services & channels", detail: "Global support model, integration and delivery reach", ratings: [4, 4, 3, 3, 4] },
  ],
};

function Mark({ level }: { level: number }) {
  return <span className="mwc-mark" aria-label={`${level} of 4`}><i style={{ width: `${level * 25}%` }} /></span>;
}

function Sheet({ type, onClose }: { type: Exclude<Sheet, null>; onClose: () => void }) {
  const content = {
    definition: {
      icon: <BookOpen />,
      eyebrow: "MARKET DEFINITION",
      title: "What belongs in this market",
      body: "Backup target appliances are purpose-built storage systems designed to receive, optimize, protect and retain enterprise backup data. They combine high-throughput ingest with inline deduplication, immutable retention, replication, ransomware detection and cloud tiering.",
      extra: "This research evaluates how effectively vendors reduce storage consumption, shorten backup windows, safeguard recovery copies and integrate with leading backup applications.",
    },
    criteria: {
      icon: <SlidersHorizontal />,
      eyebrow: "EVALUATION MODEL",
      title: "Evidence behind the position",
      body: "Position reflects a weighted view of strategy, execution and vendor viability. We update the model as product and market evidence changes.",
      extra: "Strategy & execution: Product capabilities 25%, sales execution 20%, customer experience 20%, market responsiveness 15%, innovation 20%. Vendor viability: financial viability 30%, market presence 25%, partner ecosystem 20%, business strategy 25%.",
    },
    vendor: {
      icon: <Sparkles />,
      eyebrow: "VENDOR BRIEF · DELL TECHNOLOGIES",
      title: "PowerProtect Data Domain",
      body: "Dell retains the strongest combined score in this market, supported by resilient recovery controls, scale and a broad enterprise channel.",
      extra: "Watch point: administration complexity can rise in mixed environments. Last analyst review: 14 May 2025.",
    },
    notes: {
      icon: <FileText />,
      eyebrow: "ANALYST NOTES",
      title: "Why ExaGrid moved up",
      body: "ExaGrid's landing-zone architecture continues to differentiate recovery workflows. Customer references cite predictable restore performance and practical ransomware recovery.",
      extra: "Evidence basis: 18 buyer interviews, six reference calls and current product documentation. Confidence: high.",
    },
  }[type];
  return (
    <div className="mwc-sheet-backdrop" role="presentation" onClick={onClose}>
      <section className="mwc-sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title" onClick={(e) => e.stopPropagation()}>
        <div className="mwc-grabber" />
        <button className="mwc-close" onClick={onClose} aria-label="Close details"><X size={18} /></button>
        <div className="mwc-sheet-icon">{content.icon}</div>
        <p className="mwc-eyebrow">{content.eyebrow}</p>
        <h2 id="sheet-title">{content.title}</h2>
        <p className="mwc-sheet-body">{content.body}</p>
        <div className="mwc-evidence"><span>RESEARCH NOTE</span>{content.extra}</div>
        <button className="mwc-sheet-action" onClick={onClose}>Done <Check size={17} /></button>
      </section>
    </div>
  );
}

function Quadrant({ onVendor }: { onVendor: () => void }) {
  return (
    <div className="mwc-quadrant" aria-label="Vendor evaluation positioning chart">
      <div className="mwc-qcell mwc-q-challenger">Challengers</div><div className="mwc-qcell mwc-q-leader">Leaders</div>
      <div className="mwc-qcell mwc-q-niche">Niche players</div><div className="mwc-qcell mwc-q-visionary">Visionaries</div>
      <div className="mwc-axis-y">VENDOR VIABILITY</div><div className="mwc-axis-x">STRATEGY & EXECUTION</div>
      {vendors.map((vendor) => (
        <button key={vendor.name} className="mwc-dot" onClick={onVendor} style={{ left: `${vendor.x}%`, top: `${100 - vendor.y}%`, "--dot": vendor.color } as React.CSSProperties} aria-label={`See ${vendor.name} detail`}>
          <i /><b>{vendor.short}</b>
        </button>
      ))}
    </div>
  );
}

function Workspace({ mode, setSheet }: { mode: "product" | "ecosystem"; setSheet: (sheet: Sheet) => void }) {
  const [category, setCategory] = useState(0);
  const [focus, setFocus] = useState(2);
  const item = research[mode][category];
  const icon = mode === "product" ? <Layers3 size={17} /> : <Network size={17} />;
  return (
    <section className="mwc-workspace">
      <div className="mwc-workspace-top">
        <div><p className="mwc-eyebrow">{mode === "product" ? "PRODUCT EVALUATION" : "ECOSYSTEM EVALUATION"}</p><h2>{mode === "product" ? "Capability lens" : "Integration lens"}</h2></div>
        <span className={`mwc-mode-icon ${mode}`}>{icon}</span>
      </div>
      <div className="mwc-category-tabs" role="tablist">
        {research[mode].map((entry, index) => <button key={entry.label} role="tab" aria-selected={category === index} onClick={() => setCategory(index)}>{entry.label}</button>)}
      </div>
      <article className="mwc-focus-card">
        <p className="mwc-eyebrow">FOCUS CATEGORY · {category + 1}/3</p>
        <h3>{item.label}</h3><p>{item.detail}</p>
      </article>
      <div className="mwc-vendor-rail" aria-label="Choose a vendor to compare">
        {vendors.map((vendor, index) => <button className={focus === index ? "active" : ""} key={vendor.name} onClick={() => setFocus(index)}><span style={{ background: vendor.color }} />{vendor.short}</button>)}
      </div>
      <article className="mwc-rating-card">
        <div className="mwc-rating-header"><div><span className="mwc-mini-dot" style={{ background: vendors[focus].color }} /><b>{vendors[focus].name}</b><p>{vendors[focus].product}</p></div><Mark level={item.ratings[focus]} /></div>
        <div className="mwc-rating-copy"><strong>{item.ratings[focus] === 4 ? "Full support" : item.ratings[focus] === 3 ? "Strong support" : "Partial support"}</strong><p>{mode === "product" ? "Documented capabilities validated through product research and buyer evidence." : "Support validated across priority platforms and named integration partners."}</p></div>
        <button className="mwc-note-button" onClick={() => setSheet("notes")}>Read analyst evidence <ChevronRight size={16} /></button>
      </article>
    </section>
  );
}

export function CompactWorkspace() {
  const [view, setView] = useState<View>("position");
  const [sheet, setSheet] = useState<Sheet>(null);
  const activeTitle = useMemo(() => view === "position" ? "Market position" : view === "product" ? "Product evaluation" : "Ecosystem evaluation", [view]);
  return (
    <main className="mwc-shell">
      <header className="mwc-header">
        <button className="mwc-back" aria-label="Back to markets"><ArrowLeft size={19} /></button>
        <span className="mwc-logo">ITMAP</span>
        <button className="mwc-more" aria-label="More options"><MoreHorizontal size={21} /></button>
      </header>
      <div className="mwc-content">
        <section className="mwc-intro">
          <div className="mwc-kicker"><span /> MARKET INTELLIGENCE <b>2025.2</b></div>
          <h1>Backup Target<br /><em>Appliances</em></h1>
          <div className="mwc-meta"><span>5 vendors tracked</span><i /><span>Updated 14 May</span><button onClick={() => setSheet("definition")}>Definition <Info size={14} /></button></div>
        </section>

        <nav className="mwc-nav" aria-label="Primary evaluation views">
          {([{ id: "position", label: "Position", icon: PanelTop }, { id: "product", label: "Product", icon: Layers3 }, { id: "ecosystem", label: "Ecosystem", icon: Network }] as const).map(({ id, label, icon: Icon }) => (
            <button key={id} className={view === id ? "active" : ""} onClick={() => setView(id)}><Icon size={17} /><span>{label}</span></button>
          ))}
        </nav>
        <div className="mwc-view-heading"><span>VIEW</span><h2>{activeTitle}</h2>{view === "position" && <button onClick={() => setSheet("criteria")}>Model <SlidersHorizontal size={15} /></button>}</div>

        {view === "position" && <section className="mwc-position">
          <div className="mwc-position-bar"><div><strong>ITMAP Vendor Landscape</strong><span>Tap a point to inspect</span></div><button onClick={() => setSheet("criteria")} aria-label="Show evaluation criteria"><SlidersHorizontal size={18} /></button></div>
          <Quadrant onVendor={() => setSheet("vendor")} />
          <div className="mwc-chart-footer"><span>Position reflects weighted research evidence.</span><button onClick={() => setSheet("criteria")}>View criteria <ChevronRight size={15} /></button></div>
          <div className="mwc-rankings"><div className="mwc-rankings-head"><h3>Snapshot ranking</h3><span>COMPOSITE</span></div>{vendors.slice(0, 3).map((vendor, index) => <button key={vendor.name} onClick={() => setSheet(index === 2 ? "notes" : "vendor")}><b>0{index + 1}</b><i style={{ background: vendor.color }} /><span>{vendor.short}<small>{vendor.stance}</small></span><strong>{vendor.score}</strong><ChevronRight size={16} /></button>)}</div>
        </section>}
        {view !== "position" && <Workspace mode={view} setSheet={setSheet} />}
        <section className="mwc-reports"><div><span className="mwc-eyebrow">SUBSCRIPTION RESEARCH</span><h3>Market report &amp; evidence library</h3><p>Current analysis, scorecards and 42 source notes.</p></div><button aria-label="View reports"><LockKeyhole size={17} /></button></section>
      </div>
      <footer className="mwc-footer"><span>ITMAP RESEARCH</span><b>Independent technology intelligence</b><button onClick={() => setSheet("definition")}>About this market <ArrowUpRight size={14} /></button></footer>
      {sheet && <Sheet type={sheet} onClose={() => setSheet(null)} />}
    </main>
  );
}