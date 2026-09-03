import { useState } from "react";
import {
  ArrowLeft,
  ChevronDown,
  Download,
  LayoutGrid,
  Lock,
  Monitor,
  Network,
  Smartphone,
  X,
} from "lucide-react";
import "./_group.css";

type Tab = "vendor" | "product" | "ecosystem";

const vendors = [
  { name: "Dell Technologies", product: "PowerProtect Data Domain", x: 77, y: 82, color: "#2563eb" },
  { name: "HPE", product: "StoreOnce", x: 63, y: 71, color: "#7c3aed" },
  { name: "ExaGrid", product: "Tiered Backup Storage", x: 72, y: 64, color: "#0d9488" },
  { name: "Quantum", product: "DXi-Series", x: 53, y: 55, color: "#ea580c" },
  { name: "IBM", product: "Storage Protect", x: 44, y: 67, color: "#db2777" },
];

const criteria = [
  ["Product Capabilities", 25],
  ["Sales Execution", 20],
  ["Customer Experience", 20],
  ["Market Responsiveness", 15],
  ["Innovation", 20],
  ["Financial Viability", 30],
  ["Market Presence", 25],
  ["Partner Ecosystem", 20],
  ["Business Strategy", 25],
] as const;

const productGroups = [
  {
    name: "Core Data Reduction & Storage",
    features: [
      ["Inline deduplication and compression", "Data reduction efficiency across mixed workloads"],
      ["Scale-out architecture", "Non-disruptive capacity and performance expansion"],
      ["Replication", "Efficient encrypted replication between appliances and cloud"],
    ],
  },
  {
    name: "Cyber Resilience",
    features: [
      ["Immutable retention", "WORM retention controls and compliance locking"],
      ["Ransomware anomaly detection", "Detection of unusual change rates and backup behavior"],
    ],
  },
];

const ecosystemGroups = [
  {
    name: "Backup Software Integrations",
    features: ["Veeam Backup & Replication", "Commvault Cloud", "Veritas NetBackup"],
  },
  {
    name: "Cloud & Platform Ecosystem",
    features: ["AWS, Azure and Google Cloud object tiers", "VMware and Kubernetes integration"],
  },
];

function Wordmark() {
  return (
    <span className="inline-flex h-[38px] items-center font-semibold uppercase leading-none text-white text-[22px] tracking-[.18em]">
      ITMAP
    </span>
  );
}

function HarveyBall({ level }: { level: number }) {
  return <span className="mm-harvey" aria-label={`${level} out of 4`}><span style={{ width: `${level * 25}%` }} /></span>;
}

function Quadrant() {
  return (
    <div className="relative mx-auto aspect-[1/1.06] w-full max-w-[330px] overflow-hidden rounded-xl border-2 border-gray-200 bg-white shadow-sm">
      <div className="absolute inset-x-0 top-0 h-1/2 bg-[#fafafa]" />
      <div className="absolute bottom-0 right-0 h-1/2 w-1/2 bg-blue-50/60" />
      <div className="absolute left-1/2 top-0 h-full w-px bg-slate-300" />
      <div className="absolute left-0 top-1/2 h-px w-full bg-slate-300" />
      <span className="absolute left-2 top-2 text-[9px] font-bold uppercase tracking-wide text-slate-400">Challengers</span>
      <span className="absolute right-2 top-2 text-[9px] font-bold uppercase tracking-wide text-blue-500">Leaders</span>
      <span className="absolute bottom-2 left-2 text-[9px] font-bold uppercase tracking-wide text-slate-400">Niche Players</span>
      <span className="absolute bottom-2 right-2 text-[9px] font-bold uppercase tracking-wide text-slate-400">Visionaries</span>
      <span className="absolute -left-7 top-1/2 -rotate-90 text-[8px] font-semibold uppercase tracking-wide text-slate-500">Vendor viability →</span>
      <span className="absolute bottom-2 left-1/2 -translate-x-1/2 text-[8px] font-semibold uppercase tracking-wide text-slate-500">Strategy & execution →</span>
      {vendors.map((vendor) => (
        <div
          key={vendor.name}
          className="absolute z-10"
          style={{ left: `${vendor.x}%`, top: `${100 - vendor.y}%`, transform: "translate(-50%, -50%)" }}
        >
          <span className="block h-3.5 w-3.5 rounded-full border-2 border-white shadow" style={{ background: vendor.color }} />
          <span className="absolute left-3 top-[-5px] whitespace-nowrap rounded bg-white/90 px-1 text-[8px] font-semibold text-slate-700">
            {vendor.name.replace(" Technologies", "")}
          </span>
        </div>
      ))}
    </div>
  );
}

function Comparison() {
  const [selected, setSelected] = useState(["Dell Technologies", "ExaGrid"]);
  return (
    <section className="mm-card mt-8 overflow-hidden">
      <h3 className="px-5 pt-5 text-lg font-semibold text-gray-900">Compare Vendors</h3>
      <div className="space-y-3 p-5">
        {vendors.map((vendor) => {
          const checked = selected.includes(vendor.name);
          return (
            <label key={vendor.name} className="flex cursor-pointer items-center gap-3 rounded-lg bg-gray-50 p-3 text-base font-medium text-gray-700">
              <input
                type="checkbox"
                className="h-5 w-5 rounded"
                checked={checked}
                onChange={() => setSelected((old) => checked ? old.filter((v) => v !== vendor.name) : [...old, vendor.name])}
              />
              {vendor.name}
            </label>
          );
        })}
        {selected.length >= 2 ? criteria.slice(0, 4).map(([name], index) => (
          <div key={name} className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <p className="mb-3 text-base font-medium text-gray-900">{name}</p>
            <div className="space-y-2">
              {selected.map((vendor, vendorIndex) => (
                <div key={vendor} className="flex items-center justify-between rounded-lg bg-gray-50 p-3">
                  <span className="text-sm font-medium text-gray-800">{vendor}</span>
                  <span className="text-lg font-bold text-blue-600">{(8.9 - index * .4 - vendorIndex * .3).toFixed(1)}</span>
                </div>
              ))}
            </div>
          </div>
        )) : <p className="py-8 text-center text-sm text-gray-500">Select at least 2 vendors to compare their scores</p>}
        <button className="flex w-full items-center justify-center gap-2 rounded-md bg-sky-500 px-4 py-2.5 text-sm font-semibold text-white">
          <Download className="h-4 w-4" /> View Detailed Report
        </button>
      </div>
    </section>
  );
}

function VendorEvaluation() {
  return (
    <>
      <section className="mm-card overflow-hidden">
        <div className="flex items-center justify-between gap-2 px-5 py-5">
          <h3 className="text-lg font-semibold text-gray-900">ITMAP for Backup Target Appliances</h3>
          <button className="flex shrink-0 items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-[10px] font-medium text-slate-600">
            <Download className="h-3.5 w-3.5" /> Export PDF
          </button>
        </div>
        <div className="px-4 pb-5">
          <div className="mb-3 flex items-center gap-2.5 rounded-lg border border-indigo-100 bg-indigo-50/80 px-3 py-2">
            <Smartphone className="h-5 w-5 shrink-0 text-indigo-500" />
            <p className="flex-1 text-xs font-medium text-indigo-700">Rotate your phone for a clearer, less crowded view</p>
            <X className="h-3.5 w-3.5 text-indigo-400" />
          </div>
          <Quadrant />
        </div>
      </section>

      <section className="mm-card mt-8 overflow-hidden">
        <h3 className="px-5 py-5 text-lg font-semibold text-gray-900">Criteria Weights</h3>
        <div className="bg-[#f9fafc] p-5">
          <h4 className="mb-4 text-sm font-bold text-gray-900">Product Strategy and Execution</h4>
          <div className="space-y-4">
            {criteria.slice(0, 5).map(([name, weight]) => (
              <label key={name} className="block">
                <span className="mb-1 block text-sm font-medium text-gray-700">{name}</span>
                <input className="w-full" type="range" defaultValue={weight} />
                <span className="block text-right text-xs text-gray-500">{weight}%</span>
              </label>
            ))}
          </div>
          <hr className="my-6 border-gray-300" />
          <h4 className="mb-4 text-sm font-bold text-gray-900">Vendor Viability</h4>
          <div className="space-y-4">
            {criteria.slice(5).map(([name, weight]) => (
              <label key={name} className="block">
                <span className="mb-1 block text-sm font-medium text-gray-700">{name}</span>
                <input className="w-full" type="range" defaultValue={weight} />
                <span className="block text-right text-xs text-gray-500">{weight}%</span>
              </label>
            ))}
          </div>
        </div>
      </section>
      <Comparison />
    </>
  );
}

function EvaluationHeader({ kind }: { kind: "Product" | "Ecosystem" }) {
  const green = kind === "Ecosystem";
  return (
    <div className={`border-b p-5 ${green ? "border-green-100 bg-gradient-to-r from-green-50 to-emerald-50" : "border-blue-100 bg-gradient-to-r from-blue-50 to-purple-50"}`}>
      <h3 className="flex items-center gap-2 text-lg font-semibold text-gray-900">
        {green ? <Network className="h-5 w-5 text-green-500" /> : <LayoutGrid className="h-5 w-5 text-blue-500" />}
        {kind} Evaluation
      </h3>
      <p className="mt-1 text-xs text-gray-600">Harvey ball indicators showing vendor {green ? "ecosystem support" : "product evaluation levels"}</p>
    </div>
  );
}

function ProductEvaluation() {
  return (
    <section className="mm-card overflow-hidden border-blue-100">
      <EvaluationHeader kind="Product" />
      <div className="space-y-8 px-4 py-6">
        {productGroups.map((group) => (
          <div key={group.name} className="space-y-4">
            <div className="rounded-lg border border-gray-200 bg-gradient-to-r from-gray-50 to-blue-50/50 px-4 py-4 shadow-sm">
              <button className="flex w-full items-center gap-2 p-2 text-left text-base font-semibold text-gray-900">
                <ChevronDown className="h-5 w-5" /> {group.name}
                <span className="ml-auto rounded-full border px-2 py-0.5 text-[10px] font-medium">{group.features.length} features</span>
              </button>
            </div>
            {group.features.map(([feature, description]) => (
              <div key={feature} className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                <h4 className="mb-1 text-sm font-medium text-gray-900">{feature}</h4>
                <p className="mb-3 text-xs leading-relaxed text-gray-600">{description}</p>
                <div className="space-y-3">
                  {vendors.slice(0, 3).map((vendor, index) => (
                    <div key={vendor.name} className="flex items-center justify-between rounded-lg bg-gray-50 p-3">
                      <div><p className="text-sm font-medium text-gray-900">{vendor.name}</p><p className="text-xs text-gray-500">{index === 2 ? "Good" : "Full Support"}</p></div>
                      <HarveyBall level={index === 2 ? 3 : 4} />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

function EcosystemEvaluation() {
  return (
    <section className="mm-card overflow-hidden border-green-100">
      <EvaluationHeader kind="Ecosystem" />
      <div className="space-y-8 px-4 py-6">
        {ecosystemGroups.map((group) => (
          <div key={group.name} className="space-y-4">
            <div className="rounded-lg border border-gray-200 bg-gradient-to-r from-gray-50 to-green-50/50 px-4 py-4 shadow-sm">
              <button className="flex w-full items-center gap-2 p-2 text-left text-base font-semibold text-gray-900">
                <ChevronDown className="h-5 w-5" /> {group.name}
                <span className="ml-auto rounded-full border px-2 py-0.5 text-[10px] font-medium">{group.features.length} features</span>
              </button>
            </div>
            {group.features.map((feature, featureIndex) => (
              <div key={feature} className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                <h4 className="mb-3 text-sm font-medium leading-snug text-gray-900">{feature}</h4>
                <div className="space-y-3">
                  {vendors.slice(0, 3).map((vendor, index) => {
                    const level = Math.max(2, 4 - ((index + featureIndex) % 3));
                    return (
                      <div key={vendor.name} className="flex items-center justify-between rounded-lg bg-gray-50 p-3">
                        <div><p className="text-sm font-medium text-gray-900">{vendor.name}</p><p className="text-xs text-gray-500">{level === 4 ? "Full Support" : level === 3 ? "Good" : "Partial"}</p></div>
                        <HarveyBall level={level} />
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

export function Current() {
  const [tab, setTab] = useState<Tab>("vendor");
  return (
    <main className="mm-current">
      <header className="sticky top-0 z-50 border-b border-white/5 bg-[#1e2130]/95 backdrop-blur-xl">
        <div className="flex h-14 items-center justify-between px-4">
          <Wordmark />
          <button className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-400">
            <Monitor className="h-3.5 w-3.5" /> Desktop site
          </button>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-4 py-8">
        <div className="rounded-xl bg-white p-4 shadow-sm">
          <div className="mb-6 space-y-4">
            <div>
              <h1 className="text-xl font-bold text-gray-900">ITMAP for Backup Target Appliances</h1>
              <p className="mt-1 text-sm leading-6 text-gray-600">
                Backup target appliances are purpose-built storage systems designed to receive, optimize, protect, and retain enterprise backup data. They combine high-throughput ingest with inline deduplication and compression, immutable retention, replication, ransomware detection, cloud tiering, and rapid recovery. This market evaluates how effectively each vendor reduces storage consumption, shortens backup windows, safeguards recovery copies, scales across data centers and cloud environments, and integrates with leading backup applications.
              </p>
            </div>
            <button className="mx-auto flex items-center rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm">
              <ArrowLeft className="mr-2 h-4 w-4" /> Back
            </button>
          </div>

          <nav className="mm-scrollbar flex w-full items-center justify-start overflow-x-auto rounded-lg bg-slate-100 p-1" aria-label="Market sections">
            <button onClick={() => setTab("vendor")} className={`shrink-0 rounded-sm px-2 py-1.5 text-[10px] font-medium ${tab === "vendor" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}>Vendor Eval</button>
            <button onClick={() => setTab("product")} className={`shrink-0 rounded-sm px-2 py-1.5 text-[10px] font-medium ${tab === "product" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}>Product Eval</button>
            <button onClick={() => setTab("ecosystem")} className={`shrink-0 rounded-sm px-2 py-1.5 text-[10px] font-medium ${tab === "ecosystem" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}>Ecosystem</button>
            <button className="flex shrink-0 items-center gap-1 rounded-sm px-2 py-1.5 text-[10px] font-medium text-slate-500">Intelligence <ChevronDown className="h-3 w-3" /></button>
            <button className="flex shrink-0 items-center gap-1 rounded-sm px-2 py-1.5 text-[10px] font-medium text-slate-400">Reports <Lock className="h-3 w-3" /></button>
          </nav>

          <div className="mt-6">
            {tab === "vendor" && <VendorEvaluation />}
            {tab === "product" && <ProductEvaluation />}
            {tab === "ecosystem" && <EcosystemEvaluation />}
          </div>
        </div>
      </div>
    </main>
  );
}