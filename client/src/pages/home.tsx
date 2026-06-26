import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Link } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { useSeo } from "@/hooks/use-seo";
import { track, trackDwell } from "@/lib/track";
import { Button } from "@/components/ui/button";
import { BentoCard } from "@/components/bento-card";
import type { BentoAccent, BentoSize } from "@/components/bento-card";
import type { Market } from "@shared/schema";
import type { LockableFeatureKey } from "@shared/features";
import {
  ArrowRight, BarChart3, TrendingUp, Shield, Zap, Globe2,
  CheckCircle2, ChevronRight, Eye, Database, Brain,
  Newspaper, FileSearch, Target, LineChart, Users,
  FileText, ClipboardList, Layers, BookOpen, Activity,
  Building2, MessageSquare,
} from "lucide-react";

// ─── Animation helpers ───────────────────────────────────────────────────────

const fadeUp = {
  initial: { opacity: 0, y: 30 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-80px" },
  transition: { duration: 0.6, ease: [0.25, 0.25, 0, 1] as any },
};

// ─── Bento config types ──────────────────────────────────────────────────────

interface BentoCfg {
  label: string;
  description: string;
  icon: JSX.Element;
  href: string;
  accent: BentoAccent;
  size?: BentoSize;
  stat?: string;
  statLabel?: string;
}

interface VendorBentoCfg {
  label: string;
  description: string;
  icon: JSX.Element;
  href: string;
  featureKey: LockableFeatureKey;
  accent: BentoAccent;
}

// ─── Module-level static config (icons use JSX; safe with Vite JSX transform) ─

const VENDOR_INTELLIGENCE_CFG: VendorBentoCfg[] = [
  {
    label: "Signals & News",
    description: "AI-scored news impact analysis across all your markets in real-time.",
    icon: <Activity className="h-5 w-5" />,
    href: "/markets",
    featureKey: "news",
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
    label: "Market Builder",
    description: "Build custom vendor evaluations weighted to your specific criteria.",
    icon: <Globe2 className="h-5 w-5" />,
    href: "/me/market-builder",
    featureKey: "market_builder",
    accent: "cyan",
  },
];

const VENDOR_TOOLS_CFG: VendorBentoCfg[] = [
  {
    label: "RFP Responder",
    description: "AI-assisted RFP response generation using your product knowledge base.",
    icon: <MessageSquare className="h-5 w-5" />,
    href: "/rfp-responder",
    featureKey: "rfp",
    accent: "violet",
  },
  {
    label: "Battle Cards",
    description: "Competitive battle cards for every market where you compete.",
    icon: <Shield className="h-5 w-5" />,
    href: "/battle-cards",
    featureKey: "battle_cards",
    accent: "cyan",
  },
  {
    label: "Datasheets",
    description: "Side-by-side vendor feature comparisons — shareable with prospects.",
    icon: <Layers className="h-5 w-5" />,
    href: "/datasheets",
    featureKey: "datasheets",
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

const STATS = [
  { value: "6+", label: "IT Markets Covered" },
  { value: "50+", label: "Vendors Evaluated" },
  { value: "100%", label: "Independent Research" },
  { value: "AI-first", label: "Analysis Engine" },
];

const HOW_IT_WORKS = [
  { icon: <Database className="h-6 w-6" />, step: "01", title: "Data Ingestion", desc: "Our AI continuously ingests public vendor data, news, product releases, financials and analyst commentary across the enterprise IT landscape." },
  { icon: <Brain className="h-6 w-6" />, step: "02", title: "AI-Powered Analysis", desc: "Large language models process and score vendors across 40+ capability dimensions — execution, product depth, ecosystem and financial viability." },
  { icon: <BarChart3 className="h-6 w-6" />, step: "03", title: "Actionable Intelligence", desc: "Get interactive vendor maps, feature matrices, impact-scored news, and AI-generated research reports — updated continuously, without bias." },
];

const PLATFORM_FEATURES = [
  { icon: <Eye className="h-5 w-5 text-cyan-400" />, title: "Vendor Evaluation Maps", desc: "Interactive quadrant-style positioning for every vendor across execution and product strength dimensions.", badge: "Live" },
  { icon: <Target className="h-5 w-5 text-violet-400" />, title: "Feature Support Matrix", desc: "Side-by-side capability comparisons across hundreds of product features — always current.", badge: "Granular" },
  { icon: <Newspaper className="h-5 w-5 text-cyan-400" />, title: "News Impact Analysis", desc: "Every market-relevant news article is scored for impact — positive, negative or neutral — on each vendor's position.", badge: "AI-scored" },
  { icon: <FileSearch className="h-5 w-5 text-violet-400" />, title: "Research Reports", desc: "Deep-dive analyst reports generated and updated by AI, covering market dynamics, vendor strengths and strategic guidance.", badge: "In-depth" },
  { icon: <LineChart className="h-5 w-5 text-cyan-400" />, title: "Market Builder", desc: "Define your own evaluation criteria and weights to build a custom vendor ranking tailored to your organisation's needs.", badge: "Custom" },
  { icon: <Globe2 className="h-5 w-5 text-violet-400" />, title: "Ecosystem Mapping", desc: "Understand partner networks, integrations and strategic alliances that shape the competitive landscape.", badge: "Visual" },
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
            <div className="flex -space-x-1">
              {["V", "C", "R", "P"].map((l, j) => (
                <div key={j} className="w-6 h-6 rounded-full bg-gradient-to-br from-slate-600 to-slate-700 border border-slate-900 flex items-center justify-center text-xs text-slate-300 font-bold">{l}</div>
              ))}
              <div className="w-6 h-6 rounded-full bg-slate-800 border border-slate-900 flex items-center justify-center text-xs text-slate-400">+</div>
            </div>
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
          <MarketCard market={market} href={linkToLogin ? "/login" : `/markets/${market.id}`} accentViolet={accentViolet} />
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
  const { data: savedSheets } = useQuery<any[]>({
    queryKey: ["/api/me/datasheet-comparisons"],
    staleTime: 30_000,
    retry: false,
  });

  const buyerBento: BentoCfg[] = [
    {
      label: "Markets",
      description: "Explore AI-scored vendor evaluations across all live IT markets — interactive quadrant maps, feature matrices, news impact and research reports.",
      icon: <BarChart3 className="h-5 w-5" />,
      href: "/markets",
      accent: "cyan",
      size: "1x2",
      stat: markets ? `${markets.length}` : undefined,
      statLabel: "live markets",
    },
    {
      label: "Research Reports",
      description: "AI-generated deep-dive analyst reports for every market.",
      icon: <FileText className="h-5 w-5" />,
      href: "/me/reports",
      accent: "violet",
    },
    {
      label: "RFP Builder",
      description: "Create, manage and respond to vendor RFPs with AI assistance.",
      icon: <ClipboardList className="h-5 w-5" />,
      href: "/me/rfps",
      accent: "cyan",
      stat: rfpStatus ? `${rfpStatus.activeCount}` : undefined,
      statLabel: "active RFPs",
    },
    {
      label: "Datasheets",
      description: "Side-by-side vendor feature comparisons, shareable with your team.",
      icon: <Layers className="h-5 w-5" />,
      href: "/datasheets",
      accent: "violet",
      stat: savedSheets ? `${savedSheets.length}` : undefined,
      statLabel: "saved comparisons",
    },
    {
      label: "Battle Cards",
      description: "Competitive intelligence battle cards for every IT market.",
      icon: <Shield className="h-5 w-5" />,
      href: "/battle-cards",
      accent: "cyan",
    },
    {
      label: "Methodology",
      description: "How we score and evaluate vendors — transparent, independent criteria.",
      icon: <BookOpen className="h-5 w-5" />,
      href: "/platform",
      accent: "emerald",
    },
    {
      label: "Forecast Builder",
      description: "AI-native market sizing, multi-scenario projections and sensitivity tables.",
      icon: <TrendingUp className="h-5 w-5" />,
      href: "/forecast-builder",
      accent: "violet",
    },
    {
      label: "Market Builder",
      description: "Build custom markets with your own criteria and weights.",
      icon: <Globe2 className="h-5 w-5" />,
      href: "/me/market-builder",
      accent: "cyan",
    },
  ];

  return (
    <div className="min-h-screen bg-[#1e2130]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {/* Welcome header */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="mb-10">
          <div className="flex items-center gap-3 mb-2">
            <div className="h-8 w-8 rounded-full bg-gradient-to-br from-cyan-500 to-violet-600 flex items-center justify-center text-white text-sm font-bold">
              {user?.firstName?.[0] ?? "U"}
            </div>
            <span className="text-slate-400 text-sm">Welcome back, <span className="text-white font-medium">{user?.firstName}</span></span>
          </div>
          <h1 className="text-3xl font-bold text-white mb-1">Your Intelligence Dashboard</h1>
          <p className="text-slate-400">All platform features are unlocked for your account.</p>
        </motion.div>

        {/* Config-driven bento grid */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.1 }} className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-12">
          {buyerBento.map((card) => (
            <BentoCard key={card.label} {...card} />
          ))}
        </motion.div>

        {/* Market grid */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.2 }}>
          <div className="flex items-center justify-between mb-6">
            <div>
              <SectionLabel accent="cyan">Live Markets</SectionLabel>
              <h2 className="text-2xl font-bold text-white">Explore Markets</h2>
            </div>
            <Link href="/markets">
              <Button variant="outline" size="sm" className="border-white/10 text-slate-300 hover:text-white hover:border-white/20 bg-transparent">
                View all <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
              </Button>
            </Link>
          </div>
          <MarketGrid markets={markets} isLoading={isLoading} />
        </motion.div>
      </div>
    </div>
  );
}

// ─── VENDOR DASHBOARD ────────────────────────────────────────────────────────

function VendorDashboard({ user, myMarkets, isLoading, hasFeature, vendorName, vendorScopeLoading }: {
  user: any;
  myMarkets?: Market[];
  isLoading: boolean;
  hasFeature: (key: LockableFeatureKey) => boolean;
  vendorName?: string;
  vendorScopeLoading?: boolean;
}) {
  const isLinked = !!vendorName;
  const companyLabel = vendorName ?? "";

  // While the scope API is still in flight, show a skeleton header
  if (vendorScopeLoading) {
    return (
      <div className="min-h-screen bg-[#1e2130] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Account has vendorScopeId set but the vendor record couldn't be resolved
  if (!isLinked) {
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
              This is done by a <span className="text-white font-medium">spectio.ai administrator</span> — please contact your account manager to complete the setup.
            </p>
            <div className="bg-slate-800 rounded-xl p-4 text-left mb-6">
              <p className="text-xs text-slate-500 mb-2 font-medium uppercase tracking-wider">Your account</p>
              <p className="text-sm text-white">{user?.firstName} {user?.lastName}</p>
              <p className="text-sm text-slate-400">{user?.email}</p>
            </div>
            <a href="mailto:sales@dcig.com"
              className="inline-flex items-center gap-2 bg-gradient-to-r from-cyan-500 to-violet-600 hover:from-cyan-400 hover:to-violet-500 text-white px-5 py-2.5 rounded-lg font-medium text-sm transition-all">
              Contact sales@dcig.com
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
              {companyLabel[0]}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-white font-semibold text-lg">{companyLabel}</span>
                <span className="text-[10px] font-semibold tracking-widest uppercase bg-violet-500/15 text-violet-300 border border-violet-400/20 px-2 py-0.5 rounded-full">Vendor seat</span>
              </div>
              <p className="text-slate-400 text-sm">{user?.firstName} {user?.lastName} · linked as <span className="text-violet-300 font-medium">{companyLabel}</span></p>
            </div>
          </div>
          <h1 className="text-3xl font-bold text-white">
            <span className="bg-gradient-to-r from-violet-400 to-cyan-400 bg-clip-text text-transparent">{companyLabel}</span> Intelligence Hub
          </h1>
          <p className="text-slate-400 mt-1">Market data, competitive signals and vendor tools — some features require plan upgrade.</p>
        </motion.div>

        {/* My Markets — scoped to vendor's markets */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.1 }} className="mb-14">
          <div className="flex items-center justify-between mb-6">
            <div>
              <SectionLabel accent="violet">Your Markets</SectionLabel>
              <h2 className="text-2xl font-bold text-white">My Markets</h2>
              {vendorMarkets && vendorMarkets.length > 0 && (
                <p className="text-slate-500 text-sm mt-0.5">{vendorMarkets.length} market{vendorMarkets.length !== 1 ? "s" : ""} where {companyLabel} appears</p>
              )}
            </div>
            <Link href="/markets">
              <Button variant="outline" size="sm" className="border-white/10 text-slate-300 hover:text-white hover:border-white/20 bg-transparent">
                All markets <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
              </Button>
            </Link>
          </div>
          <MarketGrid markets={vendorMarkets} isLoading={isLoading && !vendorMarkets} accentViolet />
        </motion.div>

        {/* Intelligence — config-driven */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.2 }} className="mb-10">
          <div className="mb-6">
            <SectionLabel accent="cyan">Intelligence</SectionLabel>
            <h2 className="text-2xl font-bold text-white">Market Intelligence</h2>
            <p className="text-slate-500 text-sm mt-1">Advanced analytics and forecasting tools for your markets.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {VENDOR_INTELLIGENCE_CFG.map((card) => (
              <BentoCard
                key={card.label}
                label={card.label}
                description={card.description}
                icon={card.icon}
                href={card.href}
                locked={!hasFeature(card.featureKey)}
                accent={card.accent}
              />
            ))}
          </div>
        </motion.div>

        {/* Tools — config-driven */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.3 }}>
          <div className="mb-6">
            <SectionLabel accent="violet">Tools</SectionLabel>
            <h2 className="text-2xl font-bold text-white">Vendor Tools</h2>
            <p className="text-slate-500 text-sm mt-1">Competitive intelligence and response tools for your team.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {VENDOR_TOOLS_CFG.map((card) => (
              <BentoCard
                key={card.label}
                label={card.label}
                description={card.description}
                icon={card.icon}
                href={card.href}
                locked={!hasFeature(card.featureKey)}
                accent={card.accent}
              />
            ))}
          </div>
        </motion.div>

        {/* Lead gen quick links */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.4 }} className="mt-10 flex flex-wrap gap-3">
          <Link href="/lead-gen/me">
            <Button variant="outline" size="sm" className="border-white/10 text-slate-300 hover:text-white hover:border-white/20 bg-transparent">
              My Leads <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
            </Button>
          </Link>
          <Link href="/lead-gen/me/fact-review">
            <Button variant="outline" size="sm" className="border-white/10 text-slate-300 hover:text-white hover:border-white/20 bg-transparent">
              Fact Review <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
            </Button>
          </Link>
        </motion.div>
      </div>
    </div>
  );
}

// ─── PUBLIC LANDING ──────────────────────────────────────────────────────────

function PublicLanding({ markets, isLoading }: { markets?: Market[]; isLoading: boolean }) {
  const handlePersonaSelect = (persona: "buyer" | "vendor") => {
    localStorage.setItem("spectio_persona", persona);
    window.location.href = `/login?persona=${persona}`;
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

          <motion.p initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.25 }} className="text-lg sm:text-xl text-slate-400 max-w-2xl mx-auto leading-relaxed mb-12 text-center">
            Independent, AI-powered enterprise IT intelligence for technology buyers and vendors. No bias. No guesswork.
          </motion.p>

          {/* Persona cards */}
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.35 }} className="grid grid-cols-1 sm:grid-cols-2 gap-5 max-w-2xl mx-auto mb-16">
            {/* Buyer */}
            <button onClick={() => handlePersonaSelect("buyer")} className="group relative text-left bg-slate-900 border border-white/8 hover:border-cyan-500/50 rounded-2xl p-6 cursor-pointer transition-all duration-300 hover:shadow-[0_0_50px_rgba(14,165,233,0.12)]">
              <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-cyan-500/0 to-cyan-500/0 group-hover:from-cyan-500/8 group-hover:to-violet-500/5 transition-all duration-500" />
              <div className="relative">
                <div className="h-11 w-11 rounded-xl bg-cyan-500/15 border border-cyan-500/20 flex items-center justify-center mb-4">
                  <Users className="h-5 w-5 text-cyan-400" />
                </div>
                <h3 className="font-bold text-white text-lg mb-1.5 group-hover:text-cyan-300 transition-colors">Technology Buyer</h3>
                <p className="text-sm text-slate-400 leading-relaxed mb-4">Evaluate vendors, compare products, build RFPs and access independent market research — all features unlocked.</p>
                <div className="flex items-center gap-1.5 text-cyan-400 text-sm font-medium">
                  Get buyer access <ArrowRight className="h-3.5 w-3.5 group-hover:translate-x-1 transition-transform" />
                </div>
              </div>
            </button>

            {/* Vendor */}
            <button onClick={() => handlePersonaSelect("vendor")} className="group relative text-left bg-slate-900 border border-white/8 hover:border-violet-500/50 rounded-2xl p-6 cursor-pointer transition-all duration-300 hover:shadow-[0_0_50px_rgba(139,92,246,0.12)]">
              <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-violet-500/0 to-violet-500/0 group-hover:from-violet-500/8 group-hover:to-cyan-500/5 transition-all duration-500" />
              <div className="relative">
                <div className="h-11 w-11 rounded-xl bg-violet-500/15 border border-violet-500/20 flex items-center justify-center mb-4">
                  <Building2 className="h-5 w-5 text-violet-400" />
                </div>
                <h3 className="font-bold text-white text-lg mb-1.5 group-hover:text-violet-300 transition-colors">IT Vendor</h3>
                <p className="text-sm text-slate-400 leading-relaxed mb-4">Monitor your market position, respond to RFPs, track competitive signals and showcase your products to buyers.</p>
                <div className="flex items-center gap-1.5 text-violet-400 text-sm font-medium">
                  Get vendor access <ArrowRight className="h-3.5 w-3.5 group-hover:translate-x-1 transition-transform" />
                </div>
              </div>
            </button>
          </motion.div>

          {/* Stats */}
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.8, delay: 0.5 }} className="grid grid-cols-2 sm:grid-cols-4 gap-6 max-w-xl mx-auto">
            {STATS.map((s) => (
              <div key={s.label} className="text-center">
                <div className="text-2xl font-bold text-white mb-0.5">{s.value}</div>
                <div className="text-sm text-slate-500">{s.label}</div>
              </div>
            ))}
          </motion.div>
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
        <MarketGrid markets={markets} isLoading={isLoading} linkToLogin />
        <motion.div {...fadeUp} className="text-center mt-10">
          <button onClick={() => handlePersonaSelect("buyer")} className="inline-flex items-center gap-2 border border-white/10 text-slate-300 hover:text-white hover:border-white/20 rounded-lg px-5 py-2.5 text-sm transition-all">
            Sign in to explore <ArrowRight className="h-4 w-4" />
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

      {/* Features grid */}
      <section className="py-24 border-t border-white/5">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
            <motion.div {...fadeUp}>
              <div className="inline-flex items-center gap-2 text-cyan-400 text-sm font-medium mb-6"><div className="h-px w-8 bg-cyan-400" />CAPABILITIES</div>
              <h2 className="text-4xl sm:text-5xl font-bold text-white mb-6 leading-tight">Everything your team needs to choose wisely</h2>
              <p className="text-slate-400 text-lg leading-relaxed mb-8">DCIG gives enterprise IT and procurement teams the depth of a boutique analyst firm, delivered at the speed of AI — updated daily, without the subscription lag.</p>
              <div className="space-y-3">
                {["No vendor sponsorships or paid placements", "Public data sources, transparent scoring", "AI analysis refreshed continuously", "Custom market builder for your criteria"].map((item) => (
                  <div key={item} className="flex items-center gap-3 text-slate-300">
                    <CheckCircle2 className="h-5 w-5 text-cyan-400 flex-shrink-0" />
                    <span>{item}</span>
                  </div>
                ))}
              </div>
              <div className="mt-10">
                <Link href="/platform">
                  <Button className="bg-gradient-to-r from-cyan-500 to-violet-600 hover:from-cyan-400 hover:to-violet-500 text-white border-0">
                    Explore the Platform <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </Link>
              </div>
            </motion.div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {PLATFORM_FEATURES.map((f, i) => (
                <motion.div key={i} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.08, duration: 0.5 }} className="group bg-slate-900 border border-white/5 hover:border-cyan-500/20 rounded-2xl p-5 transition-all">
                  <div className="flex items-center justify-between mb-3">
                    <div className="p-2 bg-slate-800 rounded-lg">{f.icon}</div>
                    <span className="text-xs font-medium text-slate-500 bg-slate-800 px-2 py-0.5 rounded-full">{f.badge}</span>
                  </div>
                  <h4 className="font-semibold text-white mb-1.5 text-sm">{f.title}</h4>
                  <p className="text-xs text-slate-500 leading-relaxed">{f.desc}</p>
                </motion.div>
              ))}
            </div>
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
              Access Full Intelligence Feed <ArrowRight className="h-4 w-4" />
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
              <p className="text-slate-400 text-lg max-w-xl mx-auto mb-10">Join enterprise IT teams that trust DCIG for unbiased, AI-powered vendor intelligence.</p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <button onClick={() => handlePersonaSelect("buyer")} className="inline-flex items-center justify-center gap-2 bg-gradient-to-r from-cyan-500 to-violet-600 hover:from-cyan-400 hover:to-violet-500 text-white px-8 py-4 rounded-xl font-semibold text-base transition-all shadow-[0_0_40px_rgba(14,165,233,0.25)]">
                  <Users className="h-4 w-4" /> Get Buyer Access
                </button>
                <button onClick={() => handlePersonaSelect("vendor")} className="inline-flex items-center justify-center gap-2 border border-white/15 text-white hover:bg-white/5 hover:border-white/25 px-8 py-4 rounded-xl font-semibold text-base transition-all">
                  <Building2 className="h-4 w-4" /> Get Vendor Access
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/5 py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="text-slate-500 text-sm">© {new Date().getFullYear()} DCIG. All rights reserved.</div>
          <div className="flex items-center gap-6 text-sm text-slate-500">
            <Link href="/platform"><span className="hover:text-white transition-colors cursor-pointer">Platform</span></Link>
            <Link href="/about"><span className="hover:text-white transition-colors cursor-pointer">About</span></Link>
            <Link href="/licensing"><span className="hover:text-white transition-colors cursor-pointer">Licensing</span></Link>
            <Link href="/contact"><span className="hover:text-white transition-colors cursor-pointer">Contact</span></Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

// ─── ROOT ────────────────────────────────────────────────────────────────────

export default function Home() {
  useSeo({
    title: "DCIG — Enterprise IT Vendor Intelligence | See Every Vendor. Know Every Move.",
    description: "AI-native enterprise IT vendor intelligence — independent vendor rankings, feature evaluations, AI-powered market forecasts, news impact analysis, and research reports for technology buyers.",
    path: "/",
  });

  const { isAuthenticated, isLoading: authLoading, isVendorScoped, isAdmin, user, hasFeature } = useAuth();
  const { data: markets, isLoading: marketsLoading } = useQuery<Market[]>({ queryKey: ["/api/markets"] });

  const { data: vendorScope, isLoading: vendorScopeLoading } = useQuery<{ vendor: { name?: string } }>({
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
    if (isVendorScoped) {
      return (
        <VendorDashboard
          user={user}
          myMarkets={myMarkets}
          isLoading={myMarketsLoading}
          hasFeature={hasFeature}
          vendorName={vendorScope?.vendor?.name}
          vendorScopeLoading={vendorScopeLoading}
        />
      );
    }
    return <BuyerDashboard user={user} markets={markets} isLoading={marketsLoading} />;
  }

  return <PublicLanding markets={markets} isLoading={marketsLoading} />;
}
