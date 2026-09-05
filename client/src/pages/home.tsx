import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Link } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { useTeaserGate } from "@/hooks/use-registration-teaser";
import { useSeo } from "@/hooks/use-seo";
import { track, trackDwell } from "@/lib/track";
import { vendorScopePresentation, type VendorScopeResponse } from "@/lib/vendor-scope";
import { Button } from "@/components/ui/button";
import { BentoCard } from "@/components/bento-card";
import type { BentoAccent } from "@/components/bento-card";
import type { Market } from "@shared/schema";
import type { LockableFeatureKey } from "@shared/features";
import {
  ArrowRight, BarChart3, BarChart2, TrendingUp, Shield, Zap, Globe2,
  CheckCircle2, ChevronRight, Database, Brain,
  Target, Users, Sparkles,
  FileText, ClipboardList, Layers, BookOpen,
   Building2, MessageSquare, Linkedin,
} from "lucide-react";

// ─── Animation helpers ───────────────────────────────────────────────────────

const fadeUp = {
  initial: { opacity: 0, y: 30 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-80px" },
  transition: { duration: 0.6, ease: [0.25, 0.25, 0, 1] as any },
};

// ─── Bento config types ──────────────────────────────────────────────────────

interface VendorBentoCfg {
  label: string;
  description: string;
  icon: JSX.Element;
  href: string;
  featureKey: LockableFeatureKey;
  accent: BentoAccent;
  // When set, overrides the default hasFeature(featureKey) lock check
  lockedOverride?: (isAdminLinked: boolean) => boolean;
  // When set, hides the card entirely when the predicate returns false
  visibleWhen?: (isAdminLinked: boolean, hasMarkets: boolean) => boolean;
}

// Fixed set of nine featured markets for the homepage "Coverage that matters"
// section. Kept static so the section renders instantly (no API round-trip,
// which was slow on mobile). Update this list manually when featured coverage changes.
const FEATURED_MARKETS = [
  { id: "d7ac4d1c-018c-4c02-a19d-196169cb4935", name: "ITMAP for Agentic AI Platforms & Agent Orchestration", category: "AI & Automation", shortDescription: "Infrastructure to build, deploy, coordinate, and manage autonomous AI agents that plan multi-step tasks, invoke tools and APIs, and execute complete business processes." },
  { id: "130ee3b2-16b1-4803-a8f0-8c4ed3a61d96", name: "ITMAP for Backup & Recovery of SaaS Applications", category: "Infrastructure", shortDescription: "Vendors that protect SaaS applications such as Microsoft 365, Salesforce.com, Atlassian and ServiceNow, with e-discovery, archiving and ransomware recovery." },
  { id: "63955954-0414-42e8-a73c-0caee2a67dbc", name: "ITMAP for Backup Target Appliances", category: "Infrastructure", shortDescription: "Purpose-built storage systems serving as the destination for backup data, with inline deduplication, compression and replication for efficient long-term retention." },
  { id: "b94e06f1-4c03-4367-b5bb-10659c240633", name: "ITMAP for Backup and Recovery Solutions for Mid-market enterprises", category: "Infrastructure", shortDescription: "Backup and recovery solutions focused on mid-market enterprises with fewer than 100 VMs and under 50TB of data." },
  { id: "e005fe38-d997-4b9e-abf1-846af58f4d2d", name: "ITMAP for Emerging Virtualization Solution Providers", category: "Infrastructure", shortDescription: "Server and infrastructure virtualization challengers gaining traction amid post-VMware-acquisition disruption — hypervisor, VM management and HCI capabilities." },
  { id: "b9a22e91-6aef-4434-96f7-3222a9dc3d5e", name: "ITMAP for Enterprise Backup and Recovery Solutions", category: "Infrastructure", shortDescription: "Backup and recovery of on-premise and cloud-based applications including IaaS, PaaS and SaaS workloads — backup software, integrated appliances and BaaS." },
  { id: "e4601ccf-ba41-44ec-bb48-39033a65d72b", name: "ITMAP for Tech-Specialized Talent Acquisition Platforms", category: "Business Applications", shortDescription: "Digital marketplaces and software services purpose-built to source, match, assess, and hire technology and engineering talent." },
  { id: "c57edf6c-4a34-4e23-9022-20389c139ff1", name: "ITMAP for Mid-range Storage Arrays", category: "Infrastructure", shortDescription: "Enterprise-class storage systems balancing performance, capacity, scalability and cost — hybrid and all-flash, NVMe, data reduction, snapshots and replication." },
  { id: "68babfb0-bbbc-4f13-b97a-d9177663ea28", name: "ITMAP for Storage as a Service", category: "Infrastructure", shortDescription: "Consumption-based on-premises storage delivered as a managed, pay-per-use service — cloud-like elasticity and OpEx flexibility with data kept on dedicated arrays." },
] as unknown as Market[];

// ─── Module-level static config (icons use JSX; safe with Vite JSX transform) ─

// Vendor platform tools — all require a plan upgrade (locked by default).
// Shown on the vendor dashboard with a lock overlay when not granted.
const VENDOR_DASHBOARD_TOOLS_CFG: VendorBentoCfg[] = [
  {
    label: "Lead Generator",
    description: "Capture and qualify inbound buyer interest mapped to your vendor profile.",
    icon: <Target className="h-5 w-5" />,
    href: "/lead-gen/me",
    featureKey: "lead_gen",
    accent: "cyan",
  },
  {
    label: "RFP Responder",
    description: "AI-assisted RFP response generation using your product knowledge base.",
    icon: <MessageSquare className="h-5 w-5" />,
    href: "/rfp-responder",
    featureKey: "rfp",
    accent: "violet",
  },
  {
    label: "Market Builder",
    description: "Build custom vendor evaluations weighted to your specific criteria.",
    icon: <Globe2 className="h-5 w-5" />,
    href: "/me/market-builder",
    featureKey: "market_builder",
    accent: "cyan",
  },
  {
    label: "Forecast Builder",
    description: "AI-native market sizing, multi-scenario projections and sensitivity tables.",
    icon: <TrendingUp className="h-5 w-5" />,
    href: "/forecast-builder",
    featureKey: "forecast_builder",
    accent: "violet",
  },
  {
    label: "Fact Review",
    description: "Review and approve AI-generated facts about your products across markets.",
    icon: <CheckCircle2 className="h-5 w-5" />,
    href: "/lead-gen/me/fact-review",
    featureKey: "fact_review",
    accent: "violet",
    // Only shown when admin has linked this user to a vendor AND that vendor
    // appears in at least one market. Hidden entirely otherwise.
    visibleWhen: (_isAdminLinked, hasMarkets) => hasMarkets,
    // Unlocked automatically once visible — the backend enforces requireVendorScope,
    // not requireFeature, so no separate feature grant is needed.
    lockedOverride: () => false,
  },
  {
    label: "Battle Cards",
    description: "Competitive battle cards for every market where you compete — ready to use in sales.",
    icon: <Shield className="h-5 w-5" />,
    href: "/battle-cards",
    featureKey: "battle_cards",
    accent: "cyan",
  },
  {
    label: "Security Intelligence",
    description: "CVE vulnerabilities, CISA KEV alerts and EPSS exploit scores tracked across IT vendors.",
    icon: <Shield className="h-5 w-5" />,
    href: "/security",
    featureKey: "cve_intelligence",
    accent: "violet",
  },
];

// ─── Misc static data ────────────────────────────────────────────────────────

const VENDOR_SHOWCASE = [
  { name: "Veeam", category: "Backup Leader", score: 94 },
  { name: "Commvault", category: "Enterprise Storage", score: 91 },
  { name: "Cohesity", category: "Hyper-Converged", score: 89 },
  { name: "Rubrik", category: "Cloud Data Mgmt", score: 88 },
  { name: "Pure Storage", category: "Flash Arrays", score: 93 },
  { name: "NetApp", category: "Hybrid Cloud", score: 90 },
  { name: "VMware", category: "Virtualization", score: 95 },
  { name: "Veritas", category: "Data Protection", score: 86 },
];

const STATIC_STATS = [
  { value: "100%", label: "Independent Research" },
  { value: "AI-first", label: "Analysis Engine" },
];

const HOW_IT_WORKS = [
  { icon: <Database className="h-6 w-6" />, step: "01", title: "Data Ingestion", desc: "Our AI continuously ingests public vendor data, news, product releases, financials and analyst commentary across the enterprise IT landscape." },
  { icon: <Brain className="h-6 w-6" />, step: "02", title: "AI-Powered Analysis", desc: "Large language models process and score vendors across 40+ capability dimensions — execution, product depth, ecosystem and financial viability." },
  { icon: <BarChart3 className="h-6 w-6" />, step: "03", title: "Actionable Intelligence", desc: "Get interactive vendor maps, feature matrices, impact-scored news, and AI-generated research reports — updated continuously, without bias." },
];

function MarketName(name: string) {
  return name.replace(/^ITMAP for /i, "").replace(/^Spectio for /i, "");
}

// ─── Market Card ─────────────────────────────────────────────────────────────

function MarketCard({ market, href, accentViolet = false }: { market: Market; href: string; accentViolet?: boolean }) {
  return (
    <Link href={href}>
      <div className={`group relative bg-slate-900 border border-white/5 rounded-2xl p-6 cursor-pointer transition-all duration-300 overflow-hidden ${
        accentViolet
          ? "hover:border-violet-500/30 hover:shadow-[0_0_50px_rgba(139,92,246,0.07)]"
          : "hover:border-cyan-500/30 hover:shadow-[0_0_50px_rgba(14,165,233,0.07)]"
      }`}>
        <div className={`absolute inset-0 bg-gradient-to-br opacity-0 group-hover:opacity-100 transition-all duration-500 ${accentViolet ? "from-violet-500/5 to-cyan-500/5" : "from-cyan-500/5 to-violet-600/5"}`} />
        <div className="relative">
          <div className="flex items-center gap-2 mb-4">
            <div className={`p-2 rounded-lg ${accentViolet ? "bg-violet-500/15" : "bg-gradient-to-br from-cyan-500/15 to-violet-500/15"}`}>
              <BarChart3 className={`h-4 w-4 ${accentViolet ? "text-violet-400" : "text-cyan-400"}`} />
            </div>
            <span className="text-xs font-medium text-violet-400 bg-violet-400/10 px-2 py-0.5 rounded-full">{market.category}</span>
          </div>
          <h3 className={`font-semibold text-white mb-2 transition-colors leading-snug ${accentViolet ? "group-hover:text-violet-300" : "group-hover:text-cyan-300"}`}>
            {MarketName(market.name)}
          </h3>
          <p className="text-sm text-slate-500 leading-relaxed line-clamp-2">{market.shortDescription || market.description}</p>
          <div className="mt-5 flex items-center justify-between">
            {(market as any).isInReview ? (
              <div className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 bg-amber-400 rounded-full animate-pulse" />
                <span className="text-xs font-medium text-amber-400">In Review</span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />
                <span className="text-xs text-slate-500">Live Data</span>
              </div>
            )}
            <span className="text-xs text-slate-500 group-hover:text-cyan-400 transition-colors flex items-center gap-1">Explore <ChevronRight className="h-3 w-3" /></span>
          </div>
        </div>
      </div>
    </Link>
  );
}

// ─── Market Grid ─────────────────────────────────────────────────────────────

function MarketGrid({ markets, isLoading, linkToLogin = false, accentViolet = false }: {
  markets?: Market[];
  isLoading: boolean;
  linkToLogin?: boolean;
  accentViolet?: boolean;
}) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-44 bg-slate-800/40 rounded-2xl animate-pulse" />)}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {markets?.map((market, i) => (
        <motion.div key={market.id} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.07, duration: 0.5 }}>
          <MarketCard market={market} href={linkToLogin ? "/login" : `/markets/${market.name.replace(/^ITMAP for /i, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")}`} accentViolet={accentViolet} />
        </motion.div>
      ))}
    </div>
  );
}

// ─── Section label ────────────────────────────────────────────────────────────

function SectionLabel({ accent, children }: { accent: "cyan" | "violet"; children: React.ReactNode }) {
  return (
    <div className={`inline-flex items-center gap-2 text-xs font-semibold tracking-widest uppercase mb-3 ${accent === "cyan" ? "text-cyan-400" : "text-violet-400"}`}>
      <div className={`h-px w-6 ${accent === "cyan" ? "bg-cyan-400" : "bg-violet-400"}`} />
      {children}
      <div className={`h-px w-6 ${accent === "cyan" ? "bg-cyan-400" : "bg-violet-400"}`} />
    </div>
  );
}

// ─── BUYER DASHBOARD ─────────────────────────────────────────────────────────

function BuyerDashboard({ user, markets, isLoading }: { user: any; markets?: Market[]; isLoading: boolean }) {
  const { data: rfpStatus } = useQuery<{ activeCount: number; last24hCount: number }>({
    queryKey: ["/api/me/rfps-status"],
    staleTime: 30_000,
    retry: false,
  });

  return (
    <div className="min-h-screen overflow-hidden bg-[#1e2130]">
      <div className="max-w-7xl mx-auto px-4 py-8 sm:px-6 sm:py-11 lg:px-8">
        <motion.header initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45 }} className="relative mb-8 overflow-hidden rounded-3xl border border-cyan-300/10 bg-slate-900 px-6 py-7 sm:px-9 sm:py-9">
          <div className="absolute -right-20 -top-24 h-64 w-64 rounded-full bg-cyan-500/10 blur-3xl" />
          <div className="relative flex flex-col gap-7 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="mb-3 flex items-center gap-2.5 text-sm text-slate-400">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-cyan-400/20 bg-cyan-400/10 text-xs font-bold text-cyan-300">{user?.firstName?.[0] ?? "U"}</span>
                Intelligence workspace
              </div>
              <h1 className="max-w-2xl text-3xl font-bold tracking-tight text-white sm:text-4xl">Make the next technology decision with evidence.</h1>
              <p className="mt-3 max-w-xl text-sm leading-relaxed text-slate-400 sm:text-base">Welcome back{user?.firstName ? `, ${user.firstName}` : ""}. Start with the market, build the request, and keep security context close.</p>
            </div>
            <div className="grid grid-cols-2 divide-x divide-white/10 self-start overflow-hidden rounded-2xl border border-white/10 bg-slate-950/40 lg:self-auto">
              <div className="min-w-[130px] px-5 py-3.5">
                <p className="text-2xl font-bold tabular-nums text-cyan-300">{markets != null ? markets.length : "—"}</p>
                <p className="mt-0.5 text-[11px] font-medium uppercase tracking-wider text-slate-500">Live markets</p>
              </div>
              <div className="min-w-[130px] px-5 py-3.5">
                <p className="text-2xl font-bold tabular-nums text-violet-300">{rfpStatus != null ? rfpStatus.activeCount : "—"}</p>
                <p className="mt-0.5 text-[11px] font-medium uppercase tracking-wider text-slate-500">Active RFPs</p>
              </div>
            </div>
          </div>
        </motion.header>

        <motion.section initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, delay: 0.08 }} className="mb-12">
          <div className="mb-5 flex items-end justify-between">
            <div>
              <SectionLabel accent="cyan">Decision tools</SectionLabel>
              <h2 className="text-xl font-bold text-white sm:text-2xl">Your research workflow</h2>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-12">
            <Link href="/markets" className="group relative overflow-hidden rounded-2xl border border-cyan-400/20 bg-gradient-to-br from-cyan-500/15 via-slate-900 to-slate-900 p-6 transition-all duration-300 hover:-translate-y-0.5 hover:border-cyan-400/40 lg:col-span-5">
              <div className="absolute right-0 top-0 h-32 w-32 rounded-full bg-cyan-400/10 blur-2xl transition-transform duration-500 group-hover:scale-125" />
              <div className="relative flex h-full min-h-[155px] flex-col">
                <div className="flex items-start justify-between"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-400/15 text-cyan-300"><BarChart3 className="h-5 w-5" /></div><ArrowRight className="h-5 w-5 text-cyan-300 transition-transform duration-200 group-hover:translate-x-1" /></div>
                <div className="mt-auto"><p className="text-lg font-semibold text-white">Markets</p><p className="mt-1 max-w-sm text-sm leading-relaxed text-slate-400">Evaluate vendors through live market research, product context and signals.</p></div>
              </div>
            </Link>
            <Link href="/me/rfps" className="group rounded-2xl border border-white/10 bg-slate-900 p-5 transition-all duration-300 hover:-translate-y-0.5 hover:border-violet-400/35 lg:col-span-4">
              <div className="flex h-full min-h-[155px] flex-col"><div className="flex items-start justify-between"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-500/15 text-violet-300"><ClipboardList className="h-5 w-5" /></div><ArrowRight className="h-4 w-4 text-slate-500 transition-transform duration-200 group-hover:translate-x-1 group-hover:text-violet-300" /></div><div className="mt-auto"><p className="font-semibold text-white">RFP Builder</p><p className="mt-1 text-sm leading-relaxed text-slate-400">Create, manage and send vendor requests.</p></div></div>
            </Link>
            <div className="grid gap-3 sm:grid-cols-2 lg:col-span-3 lg:grid-cols-1">
              <Link href="/security" className="group flex items-center gap-3 rounded-2xl border border-white/10 bg-slate-900 p-4 transition-all duration-300 hover:border-violet-400/35">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet-500/15 text-violet-300"><Shield className="h-4 w-4" /></div><div className="min-w-0"><p className="text-sm font-semibold text-white">Security Intelligence</p><p className="truncate text-xs text-slate-500">Vulnerabilities and alerts</p></div><ChevronRight className="ml-auto h-4 w-4 text-slate-600 group-hover:text-violet-300" />
              </Link>
              <Link href="/platform" className="group flex items-center gap-3 rounded-2xl border border-white/10 bg-slate-900 p-4 transition-all duration-300 hover:border-emerald-400/35">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-300"><BookOpen className="h-4 w-4" /></div><div className="min-w-0"><p className="text-sm font-semibold text-white">Methodology</p><p className="truncate text-xs text-slate-500">How ITMAP evaluates</p></div><ChevronRight className="ml-auto h-4 w-4 text-slate-600 group-hover:text-emerald-300" />
              </Link>
            </div>
          </div>
        </motion.section>

        <motion.section initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, delay: 0.16 }}>
          <div className="mb-6 flex items-end justify-between gap-4">
            <div>
              <SectionLabel accent="cyan">Research coverage</SectionLabel>
              <h2 className="text-2xl font-bold text-white">Live markets</h2>
              <p className="mt-1 text-sm text-slate-500">Current market intelligence ready for review.</p>
            </div>
            <Link href="/markets" className="hidden shrink-0 items-center gap-1.5 rounded-lg border border-white/10 px-3.5 py-2 text-sm font-medium text-slate-300 transition-colors hover:border-cyan-400/30 hover:text-white sm:inline-flex">View all <ArrowRight className="h-3.5 w-3.5" /></Link>
          </div>
          <MarketGrid markets={markets} isLoading={isLoading} />
        </motion.section>
      </div>
    </div>
  );
}

// ─── VENDOR DASHBOARD ────────────────────────────────────────────────────────

function VendorDashboard({ user, myMarkets, allMarkets, allMarketsLoading, isLoading, hasFeature, vendorScope, vendorScopeLoading, isAdminLinked }: {
  user: any;
  myMarkets?: Market[];
  allMarkets?: Market[];
  allMarketsLoading: boolean;
  isLoading: boolean;
  hasFeature: (key: LockableFeatureKey) => boolean;
  vendorScope?: VendorScopeResponse;
  vendorScopeLoading?: boolean;
  isAdminLinked: boolean;
}) {
  // isLinked is false until the scope query resolves — treat "still loading"
  // differently from "resolved but no vendor found" so we never blank the page.
  const fallbackLabel = user?.firstName ? `${user.firstName}'s Vendor Hub` : "Vendor Hub";
  const { isLinked, label: companyLabel } = vendorScopePresentation(vendorScope, fallbackLabel);
  // True only when admin has linked this user to a vendor that appears in ≥1 market
  const hasMarkets = isAdminLinked && !!(myMarkets && myMarkets.length > 0);

  // Only show the "not linked" warning for admin-linked accounts where the
  // vendor record couldn't be resolved. Self-registered vendor-persona users
  // are NOT admin-linked and should see the full tool dashboard instead.
  if (isAdminLinked && !vendorScopeLoading && !isLinked) {
    return (
      <div className="min-h-screen bg-[#1e2130]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}
            className="max-w-lg mx-auto mt-24 bg-slate-900 border border-amber-500/20 rounded-2xl p-10 text-center">
            <div className="h-14 w-14 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mx-auto mb-6">
              <Building2 className="h-6 w-6 text-amber-400" />
            </div>
            <h2 className="text-xl font-bold text-white mb-2">Account not linked to a vendor</h2>
            <p className="text-slate-400 text-sm leading-relaxed mb-6">
              Your account is provisioned as a vendor seat but hasn't been linked to a vendor record yet.
              This is done by a <span className="text-white font-medium">itmap.ai administrator</span> — please contact your account manager to complete the setup.
            </p>
            <div className="bg-slate-800 rounded-xl p-4 text-left mb-6">
              <p className="text-xs text-slate-500 mb-2 font-medium uppercase tracking-wider">Your account</p>
              <p className="text-sm text-white">{user?.firstName} {user?.lastName}</p>
              <p className="text-sm text-slate-400">{user?.email}</p>
            </div>
            <a href="mailto:sales@itmap.ai"
              className="inline-flex items-center gap-2 bg-gradient-to-r from-cyan-500 to-violet-600 hover:from-cyan-400 hover:to-violet-500 text-white px-5 py-2.5 rounded-lg font-medium text-sm transition-all">
              Contact sales@itmap.ai
            </a>
          </motion.div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#1e2130]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {/* Vendor header */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="mb-12">
          <div className="flex items-center gap-3 mb-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-violet-500 to-cyan-500 flex items-center justify-center text-white text-base font-bold">
              {vendorScopeLoading ? <div className="h-4 w-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> : (user?.firstName?.[0] || "V")}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-white font-semibold text-lg">
                  {user?.firstName} {user?.lastName}
                </span>
                <span className="text-[10px] font-semibold tracking-widest uppercase bg-violet-500/15 text-violet-300 border border-violet-400/20 px-2 py-0.5 rounded-full">
                  {isAdminLinked && isLinked ? "Vendor seat" : "IT Vendor"}
                </span>
              </div>
              <p className="text-slate-400 text-sm">
                {user?.email}
                {isAdminLinked && isLinked && <> · linked as <span className="text-violet-300 font-medium">{companyLabel}</span></>}
              </p>
            </div>
          </div>
          <h1 className="text-3xl font-bold text-white">
            {isAdminLinked && vendorScopeLoading
              ? <div className="h-8 w-64 bg-slate-700 rounded animate-pulse inline-block" />
              : isAdminLinked && isLinked
              ? <><span className="bg-gradient-to-r from-violet-400 to-cyan-400 bg-clip-text text-transparent">{companyLabel}</span> Intelligence Hub</>
              : <>Your <span className="bg-gradient-to-r from-violet-400 to-cyan-400 bg-clip-text text-transparent">Vendor Hub</span></>
            }
          </h1>
          <p className="text-slate-400 mt-1">Market data, competitive signals and vendor tools — locked features require a plan upgrade.</p>
        </motion.div>

        {/* Platform Tools — shown first; Markets widget scrolls down to market sections */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.1 }} className="mb-14">
          <div className="mb-6">
            <SectionLabel accent="violet">Platform Tools</SectionLabel>
            <h2 className="text-2xl font-bold text-white">Vendor Tools</h2>
            <p className="text-slate-500 text-sm mt-1">Powerful tools for lead generation, competitive response and market intelligence — plan upgrade required.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Markets — always free, scrolls to markets section */}
            <BentoCard
              label="Markets"
              description="Browse all markets and explore vendor evaluations, product comparisons and ecosystem data."
              icon={<BarChart2 className="h-5 w-5" />}
              accent="cyan"
              locked={false}
              onClick={() => document.getElementById("vendor-markets-section")?.scrollIntoView({ behavior: "smooth" })}
            />
            {VENDOR_DASHBOARD_TOOLS_CFG
              .filter((card) => card.visibleWhen ? card.visibleWhen(isAdminLinked, hasMarkets) : true)
              .map((card) => (
                <BentoCard
                  key={card.label}
                  label={card.label}
                  description={card.description}
                  icon={card.icon}
                  href={card.href}
                  locked={card.lockedOverride ? card.lockedOverride(isAdminLinked) : !hasFeature(card.featureKey)}
                  accent={card.accent}
                />
              ))}
          </div>
        </motion.div>

        {/* My Markets — only for admin-linked vendor seats with a resolved company */}
        <div id="vendor-markets-section">
          {isAdminLinked && (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.2 }} className="mb-14">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <SectionLabel accent="violet">Your Markets</SectionLabel>
                  <h2 className="text-2xl font-bold text-white">My Markets</h2>
                  {myMarkets && myMarkets.length > 0 && (
                    <p className="text-slate-500 text-sm mt-0.5">{myMarkets.length} market{myMarkets.length !== 1 ? "s" : ""} where {companyLabel} appears</p>
                  )}
                </div>
                <Link href="/markets">
                  <Button variant="outline" size="sm" className="border-white/10 text-slate-300 hover:text-white hover:border-white/20 bg-transparent">
                    All markets <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                  </Button>
                </Link>
              </div>
              <MarketGrid markets={myMarkets} isLoading={isLoading && !myMarkets} accentViolet />
            </motion.div>
          )}

          {/* All Markets — always free for vendor users */}
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: isAdminLinked ? 0.3 : 0.2 }} className="mb-14">
            <div className="flex items-center justify-between mb-6">
              <div>
                <SectionLabel accent="cyan">Markets</SectionLabel>
                <h2 className="text-2xl font-bold text-white">All Markets</h2>
                <p className="text-slate-500 text-sm mt-0.5">Vendor Evaluation, Product Evaluation, Ecosystem Evaluation, News and AI Chat — fully accessible.</p>
              </div>
              <Link href="/markets">
                <Button variant="outline" size="sm" className="border-white/10 text-slate-300 hover:text-white hover:border-white/20 bg-transparent">
                  Explore <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                </Button>
              </Link>
            </div>
            <MarketGrid markets={allMarkets} isLoading={allMarketsLoading} />
          </motion.div>
        </div>

        {/* My Reports — only when Market Builder is accessible */}
        {hasFeature("market_builder") && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.4 }} className="mt-2">
            <div className="mb-6">
              <SectionLabel accent="cyan">Reports</SectionLabel>
              <h2 className="text-2xl font-bold text-white">My Reports</h2>
              <p className="text-slate-500 text-sm mt-1">Markets you've built through Market Builder.</p>
            </div>
            <Link href="/me/market-builder">
              <div className="inline-flex items-center gap-3 bg-slate-900 border border-white/5 hover:border-cyan-500/30 rounded-xl px-5 py-4 transition-all group cursor-pointer">
                <div className="p-2 rounded-lg bg-cyan-500/10">
                  <FileText className="h-4 w-4 text-cyan-400" />
                </div>
                <div>
                  <p className="text-sm font-medium text-white">Open Market Builder</p>
                  <p className="text-xs text-slate-500">View and manage your custom market reports</p>
                </div>
                <ArrowRight className="h-4 w-4 text-slate-500 group-hover:text-cyan-400 transition-colors ml-2" />
              </div>
            </Link>
          </motion.div>
        )}
      </div>
    </div>
  );
}

// ─── PUBLIC LANDING ──────────────────────────────────────────────────────────

function PublicStats() {
  const { data: stats } = useQuery<{ marketsCount: number; vendorsCount: number }>({
    queryKey: ["/api/markets/stats"],
    staleTime: 5 * 60_000,
  });

  const statItems = [
    { value: stats ? `${stats.marketsCount}+` : "—", label: "IT Markets Covered" },
    { value: stats ? `${stats.vendorsCount}+` : "—", label: "Vendors Evaluated" },
    ...STATIC_STATS,
  ];

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.8, delay: 0.5 }} className="grid grid-cols-2 sm:grid-cols-4 gap-6 max-w-xl mx-auto">
      {statItems.map((s) => (
        <div key={s.label} className="text-center">
          <div className="text-2xl font-bold text-white mb-0.5">{s.value}</div>
          <div className="text-sm text-slate-500">{s.label}</div>
        </div>
      ))}
    </motion.div>
  );
}

// Each tile deep-links into the product. Security Intelligence and the RFP
// builder sit behind sign-in, so anonymous visitors land on the login page
// for those two; the four market-centric tiles open the markets list.
const HERO_FEATURES = [
  { label: "Access to all markets", href: "/markets", icon: <Globe2 className="h-5 w-5" /> },
  { label: "Real-time vendor maps", href: "/markets", icon: <BarChart3 className="h-5 w-5" /> },
  { label: "In-depth product comparisons", href: "/markets", icon: <Layers className="h-5 w-5" /> },
  { label: "Vendor Intelligence", href: "/markets", icon: <TrendingUp className="h-5 w-5" /> },
  { label: "Security Intelligence", href: "/security", icon: <Shield className="h-5 w-5" /> },
  { label: "RFP builder", href: "/me/rfps", icon: <ClipboardList className="h-5 w-5" /> },
];

function PublicLanding({ markets, isLoading }: { markets?: Market[]; isLoading: boolean }) {
  const { teaserActive } = useTeaserGate();
  const handlePersonaSelect = (persona: "buyer" | "vendor") => {
    localStorage.setItem("spectio_persona", persona);
    window.location.href = `/${persona}`;
  };

  return (
    <div className="bg-[#1e2130] text-white overflow-x-hidden">
      {/* Hero */}
      <section className="relative min-h-[92vh] flex items-center overflow-x-hidden">
        <div className="absolute inset-0">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_20%_50%,rgba(14,165,233,0.12)_0%,transparent_55%)]" />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_80%_20%,rgba(124,58,237,0.12)_0%,transparent_55%)]" />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_85%,rgba(14,165,233,0.06)_0%,transparent_55%)]" />
          <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: "linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)", backgroundSize: "60px 60px" }} />
        </div>

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 w-full">
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="flex justify-center mb-8">
            <span className="inline-flex items-center gap-2 bg-white/5 border border-white/10 rounded-full px-4 py-1.5 text-sm text-slate-300">
              <span className="w-2 h-2 bg-cyan-400 rounded-full animate-pulse" />
              AI-Powered · Independent · Real-Time
            </span>
          </motion.div>

          <motion.h1 initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.1, ease: [0.25, 0.25, 0, 1] }} className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight leading-[1.1] mb-4 text-center">
            See Every Vendor.{" "}
            <span className="bg-gradient-to-r from-cyan-400 to-violet-400 bg-clip-text text-transparent">Know Every Move.</span>
          </motion.h1>

          <motion.p initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.25 }} className="text-lg sm:text-xl text-slate-400 max-w-2xl mx-auto leading-relaxed mb-8 text-center">
            Independent, AI-powered enterprise IT intelligence for technology buyers. No bias. No guesswork.
          </motion.p>

          {/* Free emphasis */}
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.3 }} className="flex justify-center mb-10">
            <span className="inline-flex items-center gap-2 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-full px-4 py-1.5 text-sm font-semibold">
              <Sparkles className="h-3.5 w-3.5" /> 100% free, forever — no paid plan, no credit card
            </span>
          </motion.div>

          {/* What buyers get */}
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.35 }} className="grid grid-cols-2 sm:grid-cols-3 gap-4 max-w-3xl mx-auto mb-10">
            {HERO_FEATURES.map((f) => (
              <Link key={f.label} href={f.href}>
                <div
                  className="group relative h-full bg-slate-900 border border-white/8 hover:border-cyan-500/40 rounded-2xl p-5 cursor-pointer transition-all duration-300 hover:shadow-[0_0_40px_rgba(14,165,233,0.1)]"
                  data-testid={`hero-feature-${f.label.toLowerCase().replace(/[^a-z]+/g, "-")}`}
                >
                  <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-cyan-500/15 to-violet-500/15 border border-white/10 flex items-center justify-center mb-3 text-cyan-400 group-hover:text-violet-300 transition-colors">
                    {f.icon}
                  </div>
                  <p className="text-sm font-semibold text-white leading-snug">{f.label}</p>
                </div>
              </Link>
            ))}
          </motion.div>

          {/* CTA */}
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.4 }} className="flex justify-center mb-16">
            <button onClick={() => handlePersonaSelect("buyer")} className="inline-flex items-center gap-2 bg-gradient-to-r from-cyan-500 to-violet-600 hover:from-cyan-400 hover:to-violet-500 text-white px-8 py-4 rounded-xl font-semibold text-base transition-all shadow-[0_0_40px_rgba(14,165,233,0.25)]">
              Get free access <ArrowRight className="h-4 w-4" />
            </button>
          </motion.div>

          {/* Stats */}
          <PublicStats />

        </div>

        <div className="absolute bottom-8 left-1/2 -translate-x-1/2">
          <motion.div animate={{ y: [0, 8, 0] }} transition={{ repeat: Infinity, duration: 2, ease: "easeInOut" }} className="w-5 h-8 border border-white/20 rounded-full flex items-start justify-center pt-1.5">
            <div className="w-1 h-2 bg-white/40 rounded-full" />
          </motion.div>
        </div>
      </section>

      {/* Vendor ticker */}
      <section className="py-6 border-y border-white/5 bg-slate-900/50 overflow-hidden">
        <div className="relative flex gap-8">
          {[...VENDOR_SHOWCASE, ...VENDOR_SHOWCASE].map((v, i) => (
            <motion.div key={i} className="flex-shrink-0 flex items-center gap-3 bg-slate-800/60 border border-white/5 rounded-full px-5 py-2.5" animate={{ x: [0, -100 * VENDOR_SHOWCASE.length] }} transition={{ repeat: Infinity, duration: 30, ease: "linear" }} style={{ position: "relative" }}>
              <div className="w-2 h-2 bg-gradient-to-r from-cyan-400 to-violet-400 rounded-full" />
              <span className="text-sm font-medium text-white whitespace-nowrap">{v.name}</span>
              <span className="text-xs text-slate-500 whitespace-nowrap">{v.category}</span>
              <span className="text-xs font-bold text-cyan-400">{v.score}</span>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Markets preview */}
      <section className="py-24 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
        <motion.div {...fadeUp} className="text-center mb-16">
          <div className="inline-flex items-center gap-2 text-cyan-400 text-sm font-medium mb-4"><div className="h-px w-8 bg-cyan-400" />LIVE MARKETS<div className="h-px w-8 bg-cyan-400" /></div>
          <h2 className="text-4xl sm:text-5xl font-bold text-white mb-4">Coverage that <span className="bg-gradient-to-r from-cyan-400 to-violet-400 bg-clip-text text-transparent">matters</span></h2>
          <p className="text-slate-400 text-lg max-w-2xl mx-auto">Deep-dive evaluations across the enterprise infrastructure stack, updated continuously with AI-scored intelligence.</p>
        </motion.div>
        <MarketGrid markets={FEATURED_MARKETS} isLoading={false} linkToLogin={!teaserActive} />
        <motion.div {...fadeUp} className="text-center mt-10">
          <button onClick={() => handlePersonaSelect("buyer")} className="inline-flex items-center gap-2 border border-white/10 text-slate-300 hover:text-white hover:border-white/20 rounded-lg px-5 py-2.5 text-sm transition-all">
            Create free buyer account <ArrowRight className="h-4 w-4" />
          </button>
        </motion.div>
      </section>

      {/* How It Works */}
      <section className="py-24 border-t border-white/5">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div {...fadeUp} className="text-center mb-16">
            <div className="inline-flex items-center gap-2 text-violet-400 text-sm font-medium mb-4"><div className="h-px w-8 bg-violet-400" />HOW IT WORKS<div className="h-px w-8 bg-violet-400" /></div>
            <h2 className="text-4xl sm:text-5xl font-bold text-white mb-4">Intelligence without <span className="bg-gradient-to-r from-cyan-400 to-violet-400 bg-clip-text text-transparent">the wait</span></h2>
            <p className="text-slate-400 text-lg max-w-2xl mx-auto">From raw data to actionable insight — fully automated, continuously refreshed.</p>
          </motion.div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 relative">
            <div className="absolute top-16 left-1/3 right-1/3 h-px bg-gradient-to-r from-cyan-500/30 to-violet-500/30 hidden md:block" />
            {HOW_IT_WORKS.map((step, i) => (
              <motion.div key={i} initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.15, duration: 0.6 }} className="relative bg-slate-900 border border-white/5 rounded-2xl p-8">
                <div className="text-7xl font-black text-white/3 absolute top-4 right-6 select-none">{step.step}</div>
                <div className="relative">
                  <div className="w-12 h-12 bg-gradient-to-br from-cyan-500/20 to-violet-600/20 border border-white/10 rounded-xl flex items-center justify-center text-cyan-400 mb-6">{step.icon}</div>
                  <h3 className="text-xl font-bold text-white mb-3">{step.title}</h3>
                  <p className="text-slate-400 leading-relaxed">{step.desc}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* News preview */}
      <section className="py-24 border-t border-white/5 bg-slate-900/30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div {...fadeUp} className="text-center mb-14">
            <div className="inline-flex items-center gap-2 text-violet-400 text-sm font-medium mb-4"><div className="h-px w-8 bg-violet-400" />LIVE INTELLIGENCE</div>
            <h2 className="text-4xl sm:text-5xl font-bold text-white mb-4">News that <span className="bg-gradient-to-r from-cyan-400 to-violet-400 bg-clip-text text-transparent">moves markets</span></h2>
            <p className="text-slate-400 text-lg max-w-2xl mx-auto">Every vendor news event is analysed for its impact on market positioning. Know who it benefits — and who it doesn't.</p>
          </motion.div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {[
              { vendor: "Veeam", headline: "Veeam acquires Coveware for ransomware recovery capabilities", impact: "positive", delta: "+2.3pts", time: "2h ago", category: "Backup & Recovery" },
              { vendor: "VMware", headline: "Broadcom restructures VMware licensing — customers face cost pressure", impact: "negative", delta: "-4.1pts", time: "1d ago", category: "Virtualization" },
              { vendor: "Pure Storage", headline: "Pure Storage expands AI-ready infrastructure portfolio with new FlashBlade", impact: "positive", delta: "+1.8pts", time: "3d ago", category: "Enterprise Storage" },
            ].map((item, i) => (
              <motion.div key={i} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.12, duration: 0.5 }} className="bg-slate-900 border border-white/5 rounded-2xl p-6 hover:border-white/10 transition-all">
                <div className="flex items-center justify-between mb-4">
                  <span className="text-xs font-medium text-slate-500 bg-slate-800 px-2.5 py-1 rounded-full">{item.category}</span>
                  <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${item.impact === "positive" ? "text-emerald-400 bg-emerald-400/10" : "text-red-400 bg-red-400/10"}`}>{item.delta} impact</span>
                </div>
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-7 h-7 rounded-full bg-gradient-to-br from-cyan-500/20 to-violet-500/20 border border-white/10 flex items-center justify-center text-xs font-bold text-cyan-400">{item.vendor[0]}</div>
                  <span className="text-sm font-semibold text-white">{item.vendor}</span>
                </div>
                <p className="text-sm text-slate-300 leading-snug mb-4">{item.headline}</p>
                <div className="flex items-center gap-2 text-xs text-slate-600">
                  <TrendingUp className="h-3 w-3" />
                  <span>AI Impact Score</span>
                  <span className="ml-auto">{item.time}</span>
                </div>
              </motion.div>
            ))}
          </div>
          <motion.div {...fadeUp} className="text-center mt-10">
            <button onClick={() => handlePersonaSelect("buyer")} className="inline-flex items-center gap-2 bg-gradient-to-r from-cyan-500 to-violet-600 hover:from-cyan-400 hover:to-violet-500 text-white px-6 py-3 rounded-lg font-semibold text-sm transition-all">
              Get free buyer access <ArrowRight className="h-4 w-4" />
            </button>
          </motion.div>
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="py-24 border-t border-white/5">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div {...fadeUp} className="relative rounded-3xl overflow-hidden bg-gradient-to-br from-cyan-500/10 to-violet-600/10 border border-white/8 p-12 md:p-16 text-center">
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_0%,rgba(14,165,233,0.15)_0%,transparent_60%)]" />
            <div className="relative">
              <Zap className="h-10 w-10 text-cyan-400 mx-auto mb-6" />
              <h2 className="text-4xl sm:text-5xl font-bold text-white mb-4">Ready to see clearly?</h2>
              <p className="text-slate-400 text-lg max-w-xl mx-auto mb-10">Join enterprise IT teams that trust ITMAP for unbiased, AI-powered vendor intelligence.</p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <button onClick={() => handlePersonaSelect("buyer")} className="inline-flex items-center justify-center gap-2 bg-gradient-to-r from-cyan-500 to-violet-600 hover:from-cyan-400 hover:to-violet-500 text-white px-8 py-4 rounded-xl font-semibold text-base transition-all shadow-[0_0_40px_rgba(14,165,233,0.25)]">
                  <Users className="h-4 w-4" /> Get Free Buyer Access
                </button>
                <button onClick={() => handlePersonaSelect("vendor")} className="inline-flex items-center justify-center gap-2 border border-white/15 text-white hover:bg-white/5 hover:border-white/25 px-8 py-4 rounded-xl font-semibold text-base transition-all">
                  <Building2 className="h-4 w-4" /> Contact Sales for Vendor Access
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/5 py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="text-slate-500 text-sm">© {new Date().getFullYear()} ITMAP. All rights reserved.</div>
          <div className="flex items-center gap-6 text-sm text-slate-500">
            <Link href="/platform"><span className="hover:text-white transition-colors cursor-pointer">Platform</span></Link>
            <Link href="/about"><span className="hover:text-white transition-colors cursor-pointer">About</span></Link>
            <Link href="/licensing"><span className="hover:text-white transition-colors cursor-pointer">Licensing</span></Link>
            <Link href="/contact"><span className="hover:text-white transition-colors cursor-pointer">Contact</span></Link>
             <Link href="/privacy-policy"><span className="hover:text-white transition-colors cursor-pointer">Privacy</span></Link>
            <Link href="/termsofservice"><span className="hover:text-white transition-colors cursor-pointer">Terms</span></Link>
             <a
               href="https://www.linkedin.com/company/itmap-ai"
               target="_blank"
               rel="noreferrer"
               aria-label="Follow ITMAP on LinkedIn"
               className="text-slate-500 hover:text-white transition-colors"
             >
               <Linkedin className="h-5 w-5" aria-hidden="true" />
             </a>
          </div>
        </div>
      </footer>
    </div>
  );
}

// ─── ROOT ────────────────────────────────────────────────────────────────────

export default function Home() {
  useSeo({
    title: "ITMAP — Enterprise IT Vendor Intelligence | See Every Vendor. Know Every Move.",
    description: "AI-native enterprise IT vendor intelligence — independent vendor rankings, feature evaluations, AI-powered market forecasts, news impact analysis, and research reports for technology buyers.",
    path: "/",
  });

  const { isAuthenticated, isLoading: authLoading, isVendorScoped, isAdmin, user, hasFeature } = useAuth();
  const { data: markets, isLoading: marketsLoading } = useQuery<Market[]>({ queryKey: ["/api/markets"] });

  const { data: vendorScope, isLoading: vendorScopeLoading } = useQuery<VendorScopeResponse>({
    queryKey: ["/api/lead-gen/me/scope"],
    enabled: isVendorScoped && !isAdmin,
    staleTime: 5 * 60_000,
    retry: false,
  });

  const { data: myMarkets, isLoading: myMarketsLoading } = useQuery<Market[]>({
    queryKey: ["/api/markets/my-markets"],
    enabled: isVendorScoped && !isAdmin,
    staleTime: 5 * 60_000,
    retry: false,
  });

  useEffect(() => {
    track("filter_applied", { metadata: { context: "home" } });
    const endDwell = trackDwell({ metadata: { page: "home" } });
    return endDwell;
  }, []);

  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#1e2130] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (isAuthenticated && !isAdmin) {
    // Show vendor dashboard for admin-linked vendor seats OR for users who
    // self-registered with the vendor persona (persona saved to DB at registration).
    if (isVendorScoped || user?.persona === "vendor") {
      return (
        <VendorDashboard
          user={user}
          myMarkets={myMarkets}
          allMarkets={markets}
          allMarketsLoading={marketsLoading}
          isLoading={myMarketsLoading}
          hasFeature={hasFeature}
          vendorScope={vendorScope}
          vendorScopeLoading={vendorScopeLoading}
          isAdminLinked={isVendorScoped}
        />
      );
    }
    return <BuyerDashboard user={user} markets={markets} isLoading={marketsLoading} />;
  }

  return <PublicLanding markets={markets} isLoading={marketsLoading} />;
}
