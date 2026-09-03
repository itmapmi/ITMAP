import { useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Check,
  ChevronDown,
  ChevronUp,
  Download,
  FileText,
  Info,
  Layers3,
  LockKeyhole,
  Network,
  Sparkles,
} from "lucide-react";
import "./_group.css";

type StoryStep = "position" | "product" | "ecosystem";

const vendors = [
  { name: "Dell Technologies", product: "PowerProtect Data Domain", score: 8.8, x: 78, y: 82, color: "#1769a9", note: "Most complete enterprise proposition" },
  { name: "ExaGrid", product: "Tiered Backup Storage", score: 8.1, x: 72, y: 64, color: "#e98567", note: "Fast recovery, focused architecture" },
  { name: "HPE", product: "StoreOnce", score: 7.7, x: 63, y: 71, color: "#418b83", note: "Strong integration-led option" },
  { name: "Quantum", product: "DXi-Series", score: 6.9, x: 53, y: 55, color: "#8f7db2", note: "Solid fit for existing estates" },
  { name: "IBM", product: "Storage Protect", score: 6.5, x: 44, y: 67, color: "#b66b7d", note: "Broad portfolio, mixed execution" },
];

const productSignals = [
  { feature: "Immutable retention", insight: "Dell and ExaGrid offer the clearest protection story for regulated recovery copies.", scores: [4, 4, 3] },
  { feature: "Data reduction efficiency", insight: "ExaGrid's landing zone design is a differentiator where recovery performance matters.", scores: [4, 4, 3] },
  { feature: "Cloud tiering", insight: "Dell has the broadest operational path across public-cloud object storage.", scores: [4, 3, 3] },
];

const ecosystemSignals = [
  { feature: "Backup software", detail: "Veeam, Commvault Cloud, NetBackup", scores: [4, 4, 3] },
  { feature: "Cloud & platform", detail: "AWS, Azure, Google Cloud; VMware & Kubernetes", scores: [4, 3, 3] },
];

function DotScore({ level }: { level: number }) {
  return <span className="flex gap-1" aria-label={`${level} of 4 support`}>{[1, 2, 3, 4].map((i) => <i key={i} className="h-2.5 w-2.5 rounded-full" style={{ background: i <= level ? "#1769a9" : "#d6e3e2" }} />)}</span>;
}

function Quadrant() {
  return (
    <div className="relative mx-auto aspect-square w-full max-w-[334px] overflow-hidden rounded-sm border border-[#9ec4cc] bg-[#f8fcfb]">
      <div className="absolute right-0 top-0 h-1/2 w-1/2 bg-[#dff1f4]" />
      <div className="absolute left-0 top-1/2 h-1/2 w-1/2 bg-[#f2f0ea]" />
      <div className="absolute left-1/2 top-0 h-full border-l border-dashed border-[#88adb5]" />
      <div className="absolute left-0 top-1/2 w-full border-t border-dashed border-[#88adb5]" />
      <span className="absolute right-2 top-2 text-[8px] font-bold uppercase tracking-[.1em] text-[#397887]">Leaders</span>
      <span className="absolute left-2 top-2 text-[8px] font-bold uppercase tracking-[.1em] text-[#6c7a7d]">Challengers</span>
      <span className="absolute bottom-2 right-2 text-[8px] font-bold uppercase tracking-[.1em] text-[#6c7a7d]">Visionaries</span>
      <span className="absolute bottom-2 left-2 text-[8px] font-bold uppercase tracking-[.1em] text-[#6c7a7d]">Niche</span>
      {vendors.map((vendor) => (
        <div key={vendor.name} className="absolute z-[1]" style={{ left: `${vendor.x}%`, top: `${100 - vendor.y}%`, transform: "translate(-50%,-50%)" }}>
          <span className="block h-3.5 w-3.5 rounded-full border-2 border-[#fffdf8] shadow-sm" style={{ background: vendor.color }} />
          <span className="absolute left-3 top-[-5px] whitespace-nowrap bg-[#fffdf8]/85 px-0.5 text-[8px] font-bold text-[#25354a]">{vendor.name.replace(" Technologies", "")}</span>
        </div>
      ))}
      <span className="absolute bottom-1 left-1/2 -translate-x-1/2 text-[8px] uppercase tracking-[.07em] text-[#597178]">Strategy & execution</span>
      <span className="absolute left-1 top-1/2 -translate-y-1/2 -rotate-90 origin-left text-[8px] uppercase tracking-[.07em] text-[#597178]">Vendor viability</span>
    </div>
  );
}

export function GuidedStory() {
  const [step, setStep] = useState<StoryStep>("position");
  const [definitionOpen, setDefinitionOpen] = useState(false);
  const [methodOpen, setMethodOpen] = useState(false);
  const [selected, setSelected] = useState("Dell Technologies");
  const [showAllEvidence, setShowAllEvidence] = useState(false);
  const activeVendor = useMemo(() => vendors.find((vendor) => vendor.name === selected) ?? vendors[0], [selected]);
  const steps: { id: StoryStep; number: string; title: string }[] = [
    { id: "position", number: "01", title: "Market position" },
    { id: "product", number: "02", title: "Product proof" },
    { id: "ecosystem", number: "03", title: "Ecosystem fit" },
  ];
  const visibleSignals = showAllEvidence ? productSignals : productSignals.slice(0, 2);

  return (
    <main className="mm-story">
      <header className="mm-story-header">
        <div className="flex h-14 items-center justify-between px-5">
          <div><div className="mm-story-wordmark">ITMAP</div><div className="mm-story-kicker mt-1">Independent intelligence</div></div>
          <button aria-label="Download report" className="flex min-h-11 min-w-11 items-center justify-center rounded-full border border-white/20 text-white"><Download size={17} /></button>
        </div>
        <div className="mm-story-topline" />
      </header>

      <div className="mx-auto max-w-[430px] pb-10">
        <section className="px-5 pb-6 pt-7">
          <button className="mb-5 flex min-h-10 items-center gap-2 text-xs font-semibold text-[#537180]"><ArrowLeft size={15} /> All markets</button>
          <p className="mm-story-label">Market guide · Q2 2025</p>
          <h1 className="mt-2 font-serif text-[32px] font-bold leading-[1.04] tracking-[-.045em] text-[#17213b]">Backup Target<br />Appliances</h1>
          <p className="mt-4 max-w-[340px] text-sm leading-6 text-[#55616e]">A buyer's guided view of who protects enterprise recovery copies best—and why.</p>
          <button onClick={() => setDefinitionOpen(!definitionOpen)} className="mt-5 flex min-h-11 w-full items-center justify-between border-y border-[#d7ddd9] text-left text-xs font-semibold text-[#36596b]">
            Market definition & scope {definitionOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
          {definitionOpen && <p className="mm-story-fade pt-3 text-xs leading-5 text-[#566774]">Purpose-built storage systems that receive, optimize, protect, and retain enterprise backup data. This assessment examines high-throughput ingest, inline reduction, immutable retention, replication, ransomware detection, cloud tiering, recovery speed, and integration with leading backup applications.</p>}
        </section>

        <nav className="sticky top-[59px] z-[5] border-y border-[#d7ddd9] bg-[#f5f3ee]/95 px-5 py-3 backdrop-blur" aria-label="Research journey">
          <div className="flex items-center justify-between">
            {steps.map((item, index) => <button key={item.id} onClick={() => setStep(item.id)} className={`flex min-h-10 items-center gap-2 text-left ${step === item.id ? "text-[#1769a9]" : "text-[#778287]"}`} aria-current={step === item.id ? "step" : undefined}>
              <span className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold ${step === item.id ? "bg-[#1769a9] text-white" : "bg-[#e1e3dd]"}`}>{item.number}</span>
              <span className="hidden text-[10px] font-bold uppercase tracking-[.07em] sm:block">{item.title}</span>
              {index < 2 && <span className="mx-1 h-px w-4 bg-[#c4cecc]" />}
            </button>)}
          </div>
        </nav>

        {step === "position" && <section className="mm-story-reveal px-5 pt-7">
          <p className="mm-story-label">Analyst takeaway</p>
          <h2 className="mt-2 font-serif text-[25px] font-bold leading-tight tracking-[-.035em]">The leaders split on enterprise breadth versus recovery speed.</h2>
          <div className="mm-story-takeaway mt-5 p-4">
            <p className="text-[13px] font-semibold leading-5 text-[#263b4d]">Dell is the most complete choice for complex estates. ExaGrid deserves a close look when rapid restore and a focused backup architecture are decisive.</p>
          </div>
          <div className="mm-story-surface mt-6 p-4">
            <div className="mb-4 flex items-center justify-between"><div><p className="mm-story-label">The market at a glance</p><p className="mt-1 text-xs text-[#657078]">Vendor viability × strategy & execution</p></div><BarChart3 size={18} className="text-[#1769a9]" /></div>
            <Quadrant />
          </div>
          <div className="mt-5 grid grid-cols-[1fr_auto] gap-4 border-b border-[#d7ddd9] pb-5">
            <div><p className="mm-story-label">Best positioned</p><p className="mt-1 text-base font-bold">Dell Technologies</p><p className="mt-1 text-xs leading-5 text-[#5b6972]">Broadest protection, scale, and cloud story.</p></div>
            <span className="mm-story-num">8.8</span>
          </div>
          <button onClick={() => setMethodOpen(!methodOpen)} className="mt-5 flex min-h-11 w-full items-center justify-between text-left text-xs font-semibold text-[#36596b]"><span className="flex items-center gap-2"><Info size={16} /> How ITMAP scores vendors</span>{methodOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</button>
          {methodOpen && <div className="mm-story-fade mt-2 rounded-sm bg-[#e7f0ee] p-4 text-xs leading-5 text-[#405e66]">Scores combine product capability (25%), sales execution (20%), customer experience (20%), market responsiveness (15%), innovation (20%), financial viability (30%), market presence (25%), partner ecosystem (20%), and business strategy (25%).</div>}
          <button onClick={() => setStep("product")} className="mt-7 flex min-h-12 w-full items-center justify-between bg-[#17213b] px-4 text-sm font-bold text-white">See the product proof <ArrowRight size={17} /></button>
        </section>}

        {step === "product" && <section className="mm-story-reveal px-5 pt-7">
          <p className="mm-story-label">Product evaluation</p>
          <h2 className="mt-2 font-serif text-[25px] font-bold leading-tight tracking-[-.035em]">Protection evidence, made decision-ready.</h2>
          <p className="mt-3 text-sm leading-6 text-[#5d6971]">Follow the signals that matter before opening a full feature matrix.</p>
          <div className="mt-6 space-y-2" role="listbox" aria-label="Choose a vendor">
            {vendors.slice(0, 3).map((vendor) => <button key={vendor.name} onClick={() => setSelected(vendor.name)} className={`mm-story-choice flex min-h-14 w-full items-center justify-between p-3 text-left ${selected === vendor.name ? "is-selected" : ""}`} role="option" aria-selected={selected === vendor.name}>
              <span><span className="block text-sm font-bold">{vendor.name}</span><span className="mt-0.5 block text-[11px] text-[#64747b]">{vendor.product}</span></span>{selected === vendor.name ? <Check size={18} className="text-[#1769a9]" /> : <span className="text-sm font-bold text-[#60747e]">{vendor.score}</span>}
            </button>)}
          </div>
          <div className="mt-6 border-l-2 border-[#e98567] bg-[#fff3ee] p-4"><p className="mm-story-label text-[#a8543d]">What this means</p><p className="mt-1 text-sm font-semibold leading-5">{activeVendor.note}.</p></div>
          <div className="mt-7 space-y-3">
            {visibleSignals.map((signal, index) => <article key={signal.feature} className="mm-story-surface p-4">
              <div className="flex items-start justify-between gap-3"><div><p className="text-sm font-bold">{signal.feature}</p><p className="mt-2 text-xs leading-5 text-[#617077]">{signal.insight}</p></div><Layers3 size={17} className="shrink-0 text-[#1769a9]" /></div>
              <div className="mm-story-compare mt-4 space-y-2 pl-3">{vendors.slice(0, 3).map((vendor, vendorIndex) => <div key={vendor.name} className="flex items-center justify-between text-xs"><span className="font-semibold">{vendor.name.replace(" Technologies", "")}</span><DotScore level={signal.scores[vendorIndex]} /></div>)}</div>
            </article>)}
          </div>
          <button onClick={() => setShowAllEvidence(!showAllEvidence)} className="mt-4 flex min-h-11 w-full items-center justify-center gap-2 border border-[#aebfbd] text-xs font-bold text-[#31586b]">{showAllEvidence ? "Show less evidence" : "Reveal one more proof point"} <ChevronDown className={showAllEvidence ? "rotate-180 transition-transform" : "transition-transform"} size={16} /></button>
          <button onClick={() => setStep("ecosystem")} className="mt-6 flex min-h-12 w-full items-center justify-between bg-[#17213b] px-4 text-sm font-bold text-white">Check ecosystem fit <ArrowRight size={17} /></button>
        </section>}

        {step === "ecosystem" && <section className="mm-story-reveal px-5 pt-7">
          <p className="mm-story-label">Ecosystem evaluation</p>
          <h2 className="mt-2 font-serif text-[25px] font-bold leading-tight tracking-[-.035em]">Your stack determines the better choice.</h2>
          <p className="mt-3 text-sm leading-6 text-[#5d6971]">Use these compatibility signals to turn the shortlist into a fit decision.</p>
          <div className="mt-6 rounded-sm bg-[#dff1f4] p-4"><div className="flex items-center gap-2 text-[#1769a9]"><Network size={17} /><p className="text-xs font-bold uppercase tracking-[.08em]">Buyer guidance</p></div><p className="mt-2 text-sm font-semibold leading-5 text-[#27465a]">Prioritize Dell for multi-cloud standardization; validate ExaGrid when Veeam-led recovery workflows are central.</p></div>
          <div className="mt-5 space-y-3">{ecosystemSignals.map((signal) => <article key={signal.feature} className="mm-story-surface p-4"><p className="text-sm font-bold">{signal.feature}</p><p className="mt-1 text-xs leading-5 text-[#617077]">{signal.detail}</p><div className="mt-4 divide-y divide-[#e0e5df]">{vendors.slice(0, 3).map((vendor, index) => <div key={vendor.name} className="flex min-h-10 items-center justify-between"><span className="text-xs font-semibold">{vendor.name}</span><DotScore level={signal.scores[index]} /></div>)}</div></article>)}</div>
          <div className="mt-6 border-y border-[#d7ddd9] py-5"><p className="mm-story-label">Continue the research</p><button className="mt-3 flex min-h-11 w-full items-center justify-between text-left"><span className="flex items-center gap-3"><FileText size={18} className="text-[#1769a9]" /><span><span className="block text-sm font-bold">Market intelligence</span><span className="block text-[11px] text-[#657078]">3 analyst notes available</span></span></span><ArrowRight size={17} /></button><button className="mt-2 flex min-h-11 w-full items-center justify-between rounded-sm bg-[#e9e6de] px-3 text-left text-sm font-bold text-[#70777a]"><span className="flex items-center gap-2"><LockKeyhole size={15} /> Full market report</span><span className="text-[10px]">Member access</span></button></div>
          <div className="mt-6 flex items-center gap-3 text-xs text-[#62777e]"><Sparkles size={16} className="text-[#e98567]" /> Updated with analyst evidence · June 2025</div>
        </section>}
      </div>
    </main>
  );
}