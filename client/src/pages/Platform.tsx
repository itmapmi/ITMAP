import { useEffect } from "react";
import { motion } from "framer-motion";
import { Link } from "wouter";
import { useSeo } from "@/hooks/use-seo";
import { track, trackDwell } from "@/lib/track";
import { Button } from "@/components/ui/button";
import {
  Zap, Search, Brain, Database, ArrowRight, GitBranch, ChevronRight,
  Eye, Target, Newspaper, FileText, LineChart, ClipboardList, TrendingUp,
  Shield, MessageSquare, CheckCircle2, Sparkles, LayoutGrid
} from "lucide-react";
import PlatformVendorGraphic from "@/components/platform-vendor-graphic";

const fadeUp = {
  initial: { opacity: 0, y: 30 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-80px" },
  transition: { duration: 0.6, ease: [0.25, 0.25, 0, 1] as any },
};

const BUYER_TOOLS = [
  {
    icon: <Eye className="h-5 w-5 text-cyan-400" />,
    title: "Vendor Evaluation Maps",
    desc: "Interactive quadrant visualizations positioning vendors across execution and product strength.",
  },
  {
    icon: <Target className="h-5 w-5 text-violet-400" />,
    title: "Feature Support Matrix",
    desc: "Side-by-side comparison across hundreds of product capabilities and dimensions.",
  },
  {
    icon: <Newspaper className="h-5 w-5 text-cyan-400" />,
    title: "News & Intelligence Feed",
    desc: "AI-scored news, funding, product launches, and market signals with impact ratings.",
  },
  {
    icon: <FileText className="h-5 w-5 text-violet-400" />,
    title: "Research Reports",
    desc: "Deep-dive market and vendor reports, continuously updated and exportable as PDFs.",
  },
  {
    icon: <LineChart className="h-5 w-5 text-cyan-400" />,
    title: "Market Builder",
    desc: "Define custom criteria and weights to generate a ranking tailored to your needs.",
  },
  {
    icon: <Database className="h-5 w-5 text-violet-400" />,
    title: "Datasheets",
    desc: "Compare vendor datasheets, specifications, and feature claims in one place.",
  },
  {
    icon: <ClipboardList className="h-5 w-5 text-cyan-400" />,
    title: "RFP Builder",
    desc: "Generate RFPs from market data, scoring criteria, and vendor requirements.",
  },
  {
    icon: <TrendingUp className="h-5 w-5 text-violet-400" />,
    title: "Forecast Builder",
    desc: "Model market trajectories and forecast vendor positioning over time.",
  },
  {
    icon: <MessageSquare className="h-5 w-5 text-cyan-400" />,
    title: "Battle Cards",
    desc: "Competitive positioning cards to compare vendors for internal decision-making.",
  },
  {
    icon: <Shield className="h-5 w-5 text-violet-400" />,
    title: "CVE Intelligence",
    desc: "Security vulnerability tracking and risk signals for evaluated vendors.",
  },
  {
    icon: <CheckCircle2 className="h-5 w-5 text-cyan-400" />,
    title: "Fact Review",
    desc: "Collaborate on flagging and verifying research facts with the ITMAP team.",
  },
  {
    icon: <Sparkles className="h-5 w-5 text-violet-400" />,
    title: "AI Chat",
    desc: "Conversational assistant that answers questions about any market or vendor.",
  },
];

const HOW_STEPS = [
  {
    icon: <Database className="h-5 w-5" />,
    title: "Continuous Data Ingestion",
    desc: "Our pipeline monitors thousands of public sources: vendor websites, press releases, GitHub repositories, SEC filings, job postings, patent databases and news feeds.",
  },
  {
    icon: <Brain className="h-5 w-5" />,
    title: "LLM-Powered Scoring",
    desc: "Large language models evaluate each data point against our 40+ dimension scoring rubric. Scores are weighted, validated and aggregated into vendor positions.",
  },
  {
    icon: <GitBranch className="h-5 w-5" />,
    title: "Structured Output",
    desc: "Results are structured into a normalised data model covering scores, feature support flags, news impact events and narrative insights — all queryable by users.",
  },
  {
    icon: <Search className="h-5 w-5" />,
    title: "Expert Review Layer",
    desc: "Our team of IT practitioners reviews model outputs for accuracy, applies domain corrections and ensures the research reflects real-world operational reality.",
  },
];

export default function Platform() {
  useSeo({
    title: "ITMAP | AI-native vendor selection",
    description: "Explore the ITMAP platform: vendor scoring, feature evaluations, market forecasts, news intelligence, and conversational AI — all in one enterprise-grade workspace.",
    path: "/platform",
  });

  useEffect(() => {
    track("filter_applied", { metadata: { context: "platform" } });
    const endDwell = trackDwell({ metadata: { page: "platform" } });
    return endDwell;
  }, []);

  return (
    <div className="min-h-screen bg-[#1e2130] text-white">
      {/* Hero */}
      <section className="relative py-28 overflow-hidden border-b border-white/5">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_20%_40%,rgba(14,165,233,0.1)_0%,transparent_60%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_80%_60%,rgba(124,58,237,0.08)_0%,transparent_60%)]" />
        <div
          className="absolute inset-0 opacity-[0.025]"
          style={{
            backgroundImage: "linear-gradient(rgba(255,255,255,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.6) 1px, transparent 1px)",
            backgroundSize: "60px 60px",
          }}
        />
        <div className="relative max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <div className="inline-flex items-center gap-2 text-cyan-400 text-sm font-medium mb-6">
              <Zap className="h-4 w-4" /> The Platform
            </div>
            <h1 className="text-5xl sm:text-6xl lg:text-7xl font-bold leading-[1.08] mb-8">
              Intelligence infrastructure
              <br />
              <span className="bg-gradient-to-r from-cyan-400 to-violet-400 bg-clip-text text-transparent">
                built for buyers
              </span>
            </h1>
            <p className="text-xl text-slate-400 max-w-2xl mx-auto leading-relaxed mb-10">
              Six deeply integrated capabilities — from vendor maps to custom evaluation frameworks — built around one principle: give enterprise buyers the truth about technology.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link href="/markets">
                <Button size="lg" className="bg-gradient-to-r from-cyan-500 to-violet-600 hover:from-cyan-400 hover:to-violet-500 text-white border-0 px-10">
                  Explore a Market <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
              <Link href="/register">
                <Button variant="outline" size="lg" className="border-white/15 text-white hover:bg-white/5 bg-transparent px-10">
                  Get Free Access
                </Button>
              </Link>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Vendor Evaluation Graphic */}
      <section className="py-24 border-b border-white/5">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.6 }}
          >
            <PlatformVendorGraphic />
          </motion.div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-24 border-b border-white/5">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-start">
            <motion.div {...fadeUp}>
              <div className="inline-flex items-center gap-2 text-violet-400 text-sm font-medium mb-6">
                <div className="h-px w-8 bg-violet-400" /> METHODOLOGY
              </div>
              <h2 className="text-4xl font-bold text-white mb-6 leading-tight">
                How we produce research you can trust
              </h2>
              <p className="text-slate-400 text-lg leading-relaxed">
                Our methodology is designed to eliminate bias at every stage — from data ingestion through scoring to publication. Every decision in the pipeline is documented and auditable.
              </p>
            </motion.div>

            <div className="space-y-5">
              {HOW_STEPS.map((step, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, x: 20 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.1, duration: 0.5 }}
                  className="flex gap-5 bg-slate-900 border border-white/5 rounded-2xl p-6 hover:border-white/10 transition-all"
                >
                  <div className="flex-shrink-0 w-10 h-10 bg-gradient-to-br from-cyan-500/20 to-violet-600/20 border border-white/10 rounded-xl flex items-center justify-center text-cyan-400">
                    {step.icon}
                  </div>
                  <div>
                    <div className="flex items-center gap-3 mb-2">
                      <span className="text-xs font-bold text-slate-600">0{i + 1}</span>
                      <h4 className="font-semibold text-white">{step.title}</h4>
                    </div>
                    <p className="text-slate-400 text-sm leading-relaxed">{step.desc}</p>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Differentiation */}
      <section className="py-24 border-b border-white/5 bg-slate-900/30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div {...fadeUp} className="text-center mb-16">
            <div className="inline-flex items-center gap-2 text-cyan-400 text-sm font-medium mb-4">
              <div className="h-px w-8 bg-cyan-400" /> VS TRADITIONAL ANALYSTS
            </div>
            <h2 className="text-4xl sm:text-5xl font-bold text-white mb-4">
              The alternative to analyst-as-usual
            </h2>
          </motion.div>

          <div className="overflow-hidden rounded-2xl border border-white/5">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/5">
                  <th className="text-left p-5 text-slate-500 text-sm font-medium w-1/3">Criteria</th>
                  <th className="text-center p-5 text-slate-500 text-sm font-medium w-1/3 border-l border-white/5">Traditional Analysts</th>
                  <th className="text-center p-5 text-sm font-medium w-1/3 border-l border-white/5 bg-gradient-to-r from-cyan-500/5 to-violet-500/5">
                    <span className="bg-gradient-to-r from-cyan-400 to-violet-400 bg-clip-text text-transparent font-semibold">ITMAP</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {[
                  ["Vendor influence", "Paid placements & sponsorships", "Zero — never"],
                  ["Update frequency", "Quarterly or annual", "Continuous (daily)"],
                  ["Source transparency", "Opaque methodology", "Full source disclosure"],
                  ["Research depth", "Broad coverage, shallow data", "Deep scoring with drill-down"],
                  ["Access cost", "Six figures / year", "Affordable tiered access"],
                  ["Customisation", "None", "Custom market builder"],
                  ["News impact tracking", "Manual, infrequent", "AI-scored, real-time"],
                ].map(([criterion, traditional, spectio], i) => (
                  <tr key={i} className="border-b border-white/5 last:border-0">
                    <td className="p-5 text-slate-300 text-sm font-medium">{criterion}</td>
                    <td className="p-5 text-slate-500 text-sm text-center border-l border-white/5">{traditional}</td>
                    <td className="p-5 text-sm text-center border-l border-white/5 bg-gradient-to-r from-cyan-500/5 to-violet-500/5">
                      <span className="text-cyan-400 font-medium">{spectio}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Buyer Tools */}
      <section className="py-24 border-b border-white/5">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div {...fadeUp} className="text-center mb-16">
            <div className="inline-flex items-center gap-2 text-cyan-400 text-sm font-medium mb-4">
              <LayoutGrid className="h-4 w-4" /> INCLUDED FOR BUYERS
            </div>
            <h2 className="text-4xl sm:text-5xl font-bold text-white mb-4">
              Every tool a Technology Buyer needs
            </h2>
            <p className="text-slate-400 text-lg max-w-2xl mx-auto">
              All of these capabilities are unlocked for Technology Buyers and end users — no tiers, no paywalls, no vendor influence.
            </p>
          </motion.div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {BUYER_TOOLS.map((tool, i) => (
              <motion.div
                key={tool.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.04, duration: 0.4 }}
                className="bg-slate-900 border border-white/5 rounded-2xl p-5 hover:border-white/15 hover:bg-slate-800/50 transition-all"
              >
                <div className="p-2.5 bg-white/5 border border-white/5 rounded-xl w-fit mb-4">
                  {tool.icon}
                </div>
                <h3 className="text-base font-semibold text-white mb-2">{tool.title}</h3>
                <p className="text-slate-400 text-sm leading-relaxed">{tool.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-24">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <motion.div {...fadeUp}>
            <div className="relative bg-gradient-to-br from-slate-900 to-slate-950 border border-white/10 rounded-3xl p-14 overflow-hidden">
              <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(14,165,233,0.07)_0%,transparent_70%)]" />
              <div className="relative">
                <h2 className="text-4xl font-bold text-white mb-6">
                  Experience it for yourself
                </h2>
                <p className="text-slate-400 text-lg mb-10 max-w-xl mx-auto">
                  Free access to all markets, vendor maps and feature matrices. No credit card required.
                </p>
                <div className="flex flex-col sm:flex-row gap-4 justify-center">
                  <Link href="/register">
                    <Button size="lg" className="bg-gradient-to-r from-cyan-500 to-violet-600 hover:from-cyan-400 hover:to-violet-500 text-white border-0 px-10">
                      Get Free Access <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                  </Link>
                  <Link href="/markets">
                    <Button variant="outline" size="lg" className="border-white/15 text-white hover:bg-white/5 bg-transparent px-10">
                      Browse Markets <ChevronRight className="ml-1 h-4 w-4" />
                    </Button>
                  </Link>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </section>
    </div>
  );
}
