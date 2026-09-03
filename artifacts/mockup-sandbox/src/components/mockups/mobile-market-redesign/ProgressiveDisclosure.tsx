import { useState } from "react";
import {
  ArrowLeft,
  BarChart3,
  BookOpen,
  Check,
  ChevronDown,
  ChevronUp,
  CircleHelp,
  Download,
  FileText,
  Layers3,
  Network,
  Plus,
  ShieldCheck,
  X,
} from "lucide-react";
import "./_group.css";

type Section = "vendor" | "product" | "ecosystem" | "intelligence";

const vendors = [
  { name: "Dell Technologies", short: "Dell", product: "PowerProtect Data Domain", x: 76, y: 82, score: "8.8", color: "#087ea4" },
  { name: "HPE", short: "HPE", product: "StoreOnce", x: 59, y: 73, score: "7.6", color: "#725eaa" },
  { name: "ExaGrid", short: "ExaGrid", product: "Tiered Backup Storage", x: 70, y: 62, score: "7.3", color: "#df7b49" },
  { name: "Quantum", short: "Quantum", product: "DXi-Series", x: 47, y: 56, score: "6.4", color: "#468c79" },
  { name: "IBM", short: "IBM", product: "Storage Protect", x: 39, y: 68, score: "6.8", color: "#ba5a69" },
];

const criteria = [
  ["Product Capabilities", 25], ["Sales Execution", 20], ["Customer Experience", 20],
  ["Market Responsiveness", 15], ["Innovation", 20], ["Financial Viability", 30],
  ["Market Presence", 25], ["Partner Ecosystem", 20], ["Business Strategy", 25],
] as const;

const productGroups = [
  { name: "Core data reduction & storage", score: "4.0", features: [["Inline deduplication & compression", "Data reduction across mixed workloads"], ["Scale-out architecture", "Non-disruptive capacity and performance expansion"], ["Replication", "Encrypted replication to site or cloud"]] },
  { name: "Cyber resilience", score: "3.7", features: [["Immutable retention", "WORM retention controls and compliance locking"], ["Ransomware anomaly detection", "Detection of unusual change rates and backup behavior"]] },
];

const ecosystemGroups = [
  { name: "Backup software integrations", score: "3.8", features: ["Veeam Backup & Replication", "Commvault Cloud", "Veritas NetBackup"] },
  { name: "Cloud & platform ecosystem", score: "3.3", features: ["AWS, Azure & Google Cloud object tiers", "VMware and Kubernetes integration"] },
];

function Wordmark() {
  return <span className="font-bold tracking-[.2em] text-[17px] text-[#eaf5f1]">ITMAP</span>;
}

function Accord({ open, onClick, children }: { open: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button onClick={onClick} className="flex min-h-12 w-full items-center justify-between gap-3 text-left">{children}{open ? <ChevronUp className="h-4 w-4 shrink-0" /> : <ChevronDown className="h-4 w-4 shrink-0" />}</button>;
}

function Score({ value }: { value: number }) {
  return <span aria-label={`${value} out of 4 support`} className="relative block h-5 w-5 overflow-hidden rounded-full border border-[#087ea4] bg-[#f4f0e8]"><span className="absolute inset-y-0 left-0 bg-[#087ea4]" style={{ width: `${value * 25}%` }} /></span>;
}

function Quadrant({ active, onPick }: { active: string | null; onPick: (name: string) => void }) {
  return <div className="relative mx-auto aspect-square w-full max-w-[342px] overflow-hidden rounded-xl border border-[#17314d]/20 bg-[#fffdf8]">
    <div className="absolute right-0 top-0 h-1/2 w-1/2 bg-[#dcefe9]" /><div className="absolute left-1/2 top-0 h-full w-px bg-[#17314d]/20" /><div className="absolute left-0 top-1/2 h-px w-full bg-[#17314d]/20" />
    <p className="absolute right-3 top-2 text-[9px] font-bold uppercase tracking-[.14em] text-[#087ea4]">Leaders</p><p className="absolute left-3 top-2 text-[9px] font-bold uppercase tracking-[.1em] text-[#607082]">Challengers</p>
    <p className="absolute bottom-3 left-3 text-[9px] font-bold uppercase tracking-[.1em] text-[#607082]">Niche</p><p className="absolute bottom-3 right-3 text-[9px] font-bold uppercase tracking-[.1em] text-[#607082]">Visionaries</p>
    <p className="absolute bottom-8 left-1/2 -translate-x-1/2 whitespace-nowrap text-[8px] font-semibold uppercase tracking-[.08em] text-[#607082]">strategy & execution</p>
    {vendors.map((vendor) => <button key={vendor.name} aria-label={`Explore ${vendor.name}`} onClick={() => onPick(vendor.name)} className="pd-dot absolute z-10 h-7 w-7 rounded-full border-2 border-[#fffdf8] shadow-sm" style={{ left: `${vendor.x}%`, top: `${100 - vendor.y}%`, background: vendor.color, transform: "translate(-50%,-50%)" }}>
      <span className={`absolute left-5 top-1/2 -translate-y-1/2 whitespace-nowrap rounded-sm px-1 text-[9px] font-bold ${active === vendor.name ? "bg-[#17314d] text-white" : "bg-[#fffdf8]/90 text-[#17314d]"}`}>{vendor.short}</span>
    </button>)}
  </div>;
}

function FeatureGroup({ group, ecosystem = false }: { group: typeof productGroups[number] | typeof ecosystemGroups[number]; ecosystem?: boolean }) {
  const [open, setOpen] = useState(false);
  const [feature, setFeature] = useState<number | null>(null);
  const entries = group.features;
  return <div className="overflow-hidden rounded-xl border border-[#17314d]/12 bg-[#fffdf8]">
    <div className="px-4"><Accord open={open} onClick={() => setOpen(!open)}><span><span className="block text-sm font-bold text-[#17314d]">{group.name}</span><span className="mt-1 block text-[11px] text-[#607082]">{entries.length} capabilities to explore</span></span><span className="rounded-full bg-[#e7f0ed] px-2 py-1 text-xs font-bold text-[#087ea4]">{group.score}</span></Accord></div>
    {open && <div className="pd-reveal border-t border-[#17314d]/10 bg-[#f8f5ee] p-2">
      {entries.map((entry, i) => {
        const label = Array.isArray(entry) ? entry[0] : entry;
        const description = Array.isArray(entry) ? entry[1] : "Depth of current vendor support and tested interoperability";
        return <div key={label} className="rounded-lg">
          <button onClick={() => setFeature(feature === i ? null : i)} className="flex min-h-12 w-full items-center gap-3 px-3 text-left"><Plus className={`h-4 w-4 shrink-0 text-[#087ea4] transition-transform ${feature === i ? "rotate-45" : ""}`} /><span className="text-[13px] font-semibold leading-5 text-[#17314d]">{label}</span></button>
          {feature === i && <div className="pd-reveal mx-3 mb-3 rounded-lg bg-white p-3"><p className="mb-3 text-[11px] leading-4 text-[#607082]">{description}</p>{vendors.slice(0, 3).map((v, vi) => <div key={v.name} className="flex items-center justify-between border-t border-[#17314d]/8 py-2 first:border-0 first:pt-0"><span className="text-xs font-semibold text-[#17314d]">{v.short}</span><span className="flex items-center gap-2 text-[10px] text-[#607082]"><span>{vi === 0 ? "Full support" : vi === 1 ? "Strong" : "Good"}</span><Score value={vi === 2 ? 3 : 4} /></span></div>)}</div>}
        </div>;
      })}
    </div>}
  </div>;
}

export function ProgressiveDisclosure() {
  const [section, setSection] = useState<Section>("vendor");
  const [definitionOpen, setDefinitionOpen] = useState(false);
  const [criteriaOpen, setCriteriaOpen] = useState(false);
  const [picked, setPicked] = useState<string | null>("Dell Technologies");
  const [compare, setCompare] = useState(["Dell Technologies", "ExaGrid"]);
  const [reportOpen, setReportOpen] = useState(false);
  const selectedVendor = vendors.find((v) => v.name === picked);
  const nav = [{ id: "vendor" as const, label: "Vendor", icon: BarChart3 }, { id: "product" as const, label: "Product", icon: Layers3 }, { id: "ecosystem" as const, label: "Ecosystem", icon: Network }, { id: "intelligence" as const, label: "Intelligence", icon: BookOpen }];
  return <main className="mm-progressive pb-10">
    <header className="sticky top-0 z-30 bg-[#17314d]/95 backdrop-blur-md"><div className="mx-auto flex h-14 max-w-[480px] items-center justify-between px-5"><Wordmark /><button className="min-h-11 rounded-lg px-2 text-xs font-semibold text-[#c3ddd9]"><CircleHelp className="mr-1 inline h-4 w-4" />Methodology</button></div></header>
    <div className="mx-auto max-w-[480px] px-4 pt-5">
      <button className="mb-5 flex min-h-11 items-center gap-2 text-xs font-bold uppercase tracking-[.12em] text-[#416176]"><ArrowLeft className="h-4 w-4" />Markets</button>
      <section className="mb-4"><p className="mb-2 text-[10px] font-bold uppercase tracking-[.17em] text-[#087ea4]">Market evaluation · Q2 2025</p><h1 className="pd-display text-[29px] font-extrabold leading-[1.08] text-[#17314d]">Backup Target<br />Appliances</h1><p className="mt-3 max-w-[340px] text-[13px] leading-5 text-[#536778]">A decision workspace for enterprise teams selecting resilient backup infrastructure.</p></section>
      <section className="pd-card mb-5 px-4"><Accord open={definitionOpen} onClick={() => setDefinitionOpen(!definitionOpen)}><span className="text-sm font-bold">Market definition</span></Accord>{definitionOpen && <p className="pd-reveal border-t border-[#17314d]/10 py-3 text-xs leading-5 text-[#536778]">Purpose-built storage systems that receive, optimize, protect and retain enterprise backup data. This market evaluates reduction efficiency, recovery confidence, scale, cloud reach and integration with leading backup applications.</p>}</section>
      <nav className="mb-5 grid grid-cols-2 gap-2" aria-label="Evaluation areas">{nav.map(({ id, label, icon: Icon }) => <button key={id} onClick={() => setSection(id)} className={`flex min-h-[62px] items-center gap-3 rounded-xl border px-3 text-left transition-all ${section === id ? "border-[#17314d] bg-[#17314d] text-[#f4f0e8] shadow-md" : "border-[#17314d]/15 bg-[#fffdf8] text-[#365168]"}`}><Icon className="h-4 w-4" /><span className="text-xs font-bold">{label}<small className="mt-1 block font-normal opacity-70">{id === "vendor" ? "Leaders & evidence" : id === "product" ? "Capability depth" : id === "ecosystem" ? "Integration reach" : "Reports & signals"}</small></span></button>)}</nav>
      {section === "vendor" && <div className="pd-reveal space-y-4">
        <section className="pd-card overflow-hidden"><div className="flex items-start justify-between p-4 pb-2"><div><p className="text-[10px] font-bold uppercase tracking-[.14em] text-[#087ea4]">Vendor landscape</p><h2 className="mt-1 text-lg font-bold text-[#17314d]">Who leads this market</h2></div><button onClick={() => setReportOpen(true)} className="flex min-h-10 items-center gap-1 rounded-lg bg-[#e7f0ed] px-2 text-[11px] font-bold text-[#087ea4]"><Download className="h-3.5 w-3.5" />Brief</button></div><div className="p-3 pt-2"><Quadrant active={picked} onPick={setPicked} /></div><div className="border-t border-[#17314d]/10 bg-[#e7f0ed]/60 p-3">{selectedVendor && <div className="pd-reveal flex items-center justify-between"><div><p className="text-sm font-bold text-[#17314d]">{selectedVendor.name}</p><p className="text-[11px] text-[#536778]">{selectedVendor.product}</p></div><span className="rounded-lg bg-[#17314d] px-2.5 py-1.5 text-sm font-bold text-[#eaf5f1]">{selectedVendor.score}</span></div>}</div></section>
        <section className="pd-card px-4"><Accord open={criteriaOpen} onClick={() => setCriteriaOpen(!criteriaOpen)}><span><span className="block text-sm font-bold">Evaluation model</span><span className="mt-1 block text-[11px] text-[#607082]">9 weighted criteria · updated 14 May</span></span></Accord>{criteriaOpen && <div className="pd-reveal border-t border-[#17314d]/10 py-3">{criteria.map(([name, weight]) => <div key={name} className="mb-3 last:mb-0"><div className="mb-1 flex justify-between text-[11px]"><span className="font-semibold text-[#17314d]">{name}</span><span className="font-bold text-[#087ea4]">{weight}%</span></div><div className="h-1.5 overflow-hidden rounded-full bg-[#d9e1dc]"><div className="pd-bar h-full rounded-full bg-[#2cc8b7]" style={{ width: `${weight * 3.33}%` }} /></div></div>)}</div>}</section>
        <section className="pd-card overflow-hidden"><div className="p-4 pb-2"><p className="text-[10px] font-bold uppercase tracking-[.14em] text-[#087ea4]">Decision view</p><h2 className="mt-1 text-lg font-bold text-[#17314d]">Compare shortlist</h2></div><div className="px-3 pb-3">{vendors.map((v) => { const on = compare.includes(v.name); return <button key={v.name} onClick={() => setCompare(on ? compare.filter((n) => n !== v.name) : [...compare, v.name])} className="flex min-h-11 w-full items-center gap-3 border-t border-[#17314d]/10 px-2 text-left"><span className={`flex h-5 w-5 items-center justify-center rounded border ${on ? "border-[#087ea4] bg-[#087ea4] text-white" : "border-[#79909b]"}`}>{on && <Check className="h-3.5 w-3.5" />}</span><span className="flex-1 text-xs font-bold text-[#17314d]">{v.name}</span><span className="text-xs font-bold text-[#087ea4]">{v.score}</span></button>; })}</div>{compare.length >= 2 && <div className="border-t border-[#17314d]/10 bg-[#f8f5ee] p-3"><p className="mb-2 text-[11px] font-bold text-[#17314d]">Evidence: cyber resilience</p>{compare.slice(0, 3).map((name, i) => <div key={name} className="flex items-center justify-between py-1 text-xs"><span className="text-[#536778]">{name.replace(" Technologies", "")}</span><span className="font-bold text-[#17314d]">{(8.7 - i * .5).toFixed(1)} <span className="font-normal text-[#607082]">/ 10</span></span></div>)}</div>}</section>
      </div>}
      {section === "product" && <section className="pd-reveal"><p className="text-[10px] font-bold uppercase tracking-[.14em] text-[#087ea4]">Product evaluation</p><h2 className="mb-2 mt-1 text-xl font-bold text-[#17314d]">Start at the capability that matters.</h2><p className="mb-4 text-xs leading-5 text-[#536778]">Open a category, then inspect support without losing your place.</p><div className="space-y-3">{productGroups.map((group) => <FeatureGroup key={group.name} group={group} />)}</div></section>}
      {section === "ecosystem" && <section className="pd-reveal"><p className="text-[10px] font-bold uppercase tracking-[.14em] text-[#087ea4]">Ecosystem evaluation</p><h2 className="mb-2 mt-1 text-xl font-bold text-[#17314d]">Interoperability, not assumptions.</h2><p className="mb-4 text-xs leading-5 text-[#536778]">Follow support from backup software to cloud and platform operations.</p><div className="space-y-3">{ecosystemGroups.map((group) => <FeatureGroup key={group.name} group={group} ecosystem />)}</div></section>}
      {section === "intelligence" && <section className="pd-reveal space-y-3"><p className="text-[10px] font-bold uppercase tracking-[.14em] text-[#087ea4]">Market intelligence</p><h2 className="text-xl font-bold text-[#17314d]">Signals for your buying team</h2>{[["Market pulse", "Why immutable architecture is now a board-level recovery requirement.", "6 min read"], ["Vendor brief", "Dell Technologies: PowerProtect Data Domain buyer evidence.", "PDF · 14 pages"], ["Category forecast", "Backup target appliances through 2027.", "Analyst note"]].map(([title, text, meta]) => <button key={title} onClick={() => setReportOpen(true)} className="pd-card block w-full p-4 text-left"><FileText className="mb-3 h-4 w-4 text-[#087ea4]" /><p className="text-sm font-bold text-[#17314d]">{title}</p><p className="mt-1 text-xs leading-5 text-[#536778]">{text}</p><p className="mt-3 text-[10px] font-bold uppercase tracking-[.1em] text-[#087ea4]">{meta}</p></button>)}</section>}
    </div>
    {reportOpen && <div className="fixed inset-0 z-50 flex items-end bg-[#17314d]/35 p-3" onClick={() => setReportOpen(false)}><div className="pd-reveal w-full rounded-2xl bg-[#fffdf8] p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}><button onClick={() => setReportOpen(false)} className="float-right min-h-10 min-w-10 text-[#536778]"><X className="ml-auto h-5 w-5" /></button><ShieldCheck className="mb-3 h-6 w-6 text-[#087ea4]" /><h2 className="text-xl font-bold text-[#17314d]">Decision brief ready</h2><p className="mt-2 text-sm leading-5 text-[#536778]">Your mobile brief includes the market landscape, weighted criteria and vendor evidence.</p><button onClick={() => setReportOpen(false)} className="mt-5 min-h-12 w-full rounded-xl bg-[#17314d] text-sm font-bold text-[#f4f0e8]">Download evaluation brief</button></div></div>}
  </main>;
}