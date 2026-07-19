import { useEffect } from "react";
import { motion } from "framer-motion";
import { Link } from "wouter";
import { useSeo } from "@/hooks/use-seo";
import { track, trackDwell } from "@/lib/track";
import { Button } from "@/components/ui/button";
import { PersonaRegistrationForm } from "@/components/persona-registration-form";
import {
  ArrowRight, Target, Shield, FileText, MessageSquare, Globe2, BarChart3, Eye, Zap, CheckCircle2
} from "lucide-react";

const fadeUp = {
  initial: { opacity: 0, y: 30 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-80px" },
  transition: { duration: 0.6, ease: [0.25, 0.25, 0, 1] as any },
};

const BUYER_CAPABILITIES = [
  {
    icon: <BarChart3 className="h-7 w-7 text-cyan-400" />,
    title: "ITMAP Vendor Evaluation",
    desc: "Interactive execution-vs-product maps position every vendor in your market. Drill into score rationale, compare historical movement and identify leaders vs challengers at a glance.",
  },
  {
    icon: <Target className="h-7 w-7 text-violet-400" />,
    title: "Product Evaluation",
    desc: "Side-by-side feature support matrices across hundreds of capabilities. See which vendors deliver the features you care about and where gaps exist.",
  },
  {
    icon: <Globe2 className="h-7 w-7 text-cyan-400" />,
    title: "Ecosystem Evaluation",
    desc: "Map partner networks, integrations and alliances to understand the full competitive landscape beyond product checklists.",
  },
  {
    icon: <MessageSquare className="h-7 w-7 text-violet-400" />,
    title: "Conversation Platform",
    desc: "Ask natural-language questions about any market or vendor. Our AI analyst synthesises scores, news, features and reports into sourced answers.",
  },
  {
    icon: <Shield className="h-7 w-7 text-cyan-400" />,
    title: "Security Intelligence",
    desc: "Monitor CVEs, CISA KEV alerts and EPSS exploit scores for the vendors in your stack. Get early warning when a supplier's security posture changes.",
  },
  {
    icon: <FileText className="h-7 w-7 text-violet-400" />,
    title: "Create RFPs",
    desc: "Generate vendor-agnostic RFPs from any market's feature set, then run structured evaluations and shortlists in one workflow.",
  },
];

export default function BuyerLandingPage() {
  useSeo({
    title: "Technology Buyers — ITMAP | Free IT Vendor Intelligence",
    description: "Free, unbiased enterprise IT vendor intelligence for technology buyers. Evaluate vendors, products, ecosystems, monitor security vulnerabilities, and create RFPs.",
    path: "/buyer",
  });

  useEffect(() => {
    track("filter_applied", { metadata: { context: "buyer-landing" } });
    const endDwell = trackDwell({ metadata: { page: "buyer-landing" } });
    return endDwell;
  }, []);

  return (
    <div className="min-h-screen bg-[#1e2130] text-white overflow-x-hidden">
      {/* Hero */}
      <section className="relative py-20 lg:py-28 border-b border-white/5">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_20%_30%,rgba(14,165,233,0.12)_0%,transparent_60%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_80%_70%,rgba(124,58,237,0.08)_0%,transparent_60%)]" />
        <div
          className="absolute inset-0 opacity-[0.025]"
          style={{
            backgroundImage: "linear-gradient(rgba(255,255,255,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.6) 1px, transparent 1px)",
            backgroundSize: "60px 60px",
          }}
        />
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center">
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
              <div className="inline-flex items-center gap-2 text-cyan-400 text-sm font-medium mb-5">
                <div className="h-px w-8 bg-cyan-400" />
                FOR TECHNOLOGY BUYERS
                <div className="h-px w-8 bg-cyan-400" />
              </div>
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold leading-tight mb-6">
                Buy enterprise IT with{" "}
                <span className="bg-gradient-to-r from-cyan-400 to-violet-400 bg-clip-text text-transparent">
                  complete confidence
                </span>
              </h1>
              <p className="text-lg text-slate-400 leading-relaxed mb-8 max-w-xl">
                Independent, AI-powered vendor intelligence across markets, products, ecosystems, security and RFP workflows. No sponsorships. No paywalls.
              </p>
              <div className="flex flex-col sm:flex-row gap-4">
                <Link href="/markets">
                  <Button className="bg-gradient-to-r from-cyan-500 to-violet-600 hover:from-cyan-400 hover:to-violet-500 text-white border-0 px-6 py-3 h-auto text-base">
                    Explore Live Markets <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </Link>
                <a href="#register" className="inline-flex items-center justify-center gap-2 border border-white/10 text-slate-300 hover:text-white hover:border-white/20 rounded-lg px-6 py-3 h-auto text-base transition-all">
                  Register Free <Zap className="h-4 w-4" />
                </a>
              </div>
            </motion.div>

            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.6, delay: 0.1 }} className="relative">
              <div className="absolute inset-0 bg-gradient-to-r from-cyan-500/20 to-violet-500/20 rounded-3xl blur-3xl" />
              <div className="relative grid grid-cols-2 gap-4">
                <div className="bg-slate-900/80 border border-white/10 rounded-2xl p-5 backdrop-blur">
                  <Eye className="h-8 w-8 text-cyan-400 mb-3" />
                  <div className="text-2xl font-bold text-white mb-1">40+</div>
                  <div className="text-sm text-slate-500">Scoring dimensions</div>
                </div>
                <div className="bg-slate-900/80 border border-white/10 rounded-2xl p-5 backdrop-blur">
                  <BarChart3 className="h-8 w-8 text-violet-400 mb-3" />
                  <div className="text-2xl font-bold text-white mb-1">100%</div>
                  <div className="text-sm text-slate-500">Independent research</div>
                </div>
                <div className="col-span-2 bg-slate-900/80 border border-white/10 rounded-2xl p-5 backdrop-blur flex items-center justify-between">
                  <div>
                    <div className="text-2xl font-bold text-white mb-1">Free</div>
                    <div className="text-sm text-slate-500">Registration and access</div>
                  </div>
                  <CheckCircle2 className="h-10 w-10 text-emerald-400" />
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* Capabilities */}
      <section className="py-24 border-b border-white/5">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div {...fadeUp} className="text-center mb-16">
            <div className="inline-flex items-center gap-2 text-cyan-400 text-sm font-medium mb-4">
              <div className="h-px w-8 bg-cyan-400" />CAPABILITIES<div className="h-px w-8 bg-cyan-400" />
            </div>
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-white mb-4">Everything you need to evaluate vendors</h2>
            <p className="text-slate-400 text-lg max-w-2xl mx-auto">One platform for market maps, product comparisons, security monitoring and RFP creation.</p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {BUYER_CAPABILITIES.map((cap, i) => (
              <motion.div
                key={cap.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.08, duration: 0.5 }}
                className="group bg-slate-900 border border-white/5 hover:border-cyan-500/20 rounded-2xl p-6 transition-all"
              >
                <div className="mb-4">{cap.icon}</div>
                <h3 className="text-lg font-bold text-white mb-2">{cap.title}</h3>
                <p className="text-sm text-slate-400 leading-relaxed">{cap.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Register CTA */}
      <section id="register" className="py-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-start">
            <motion.div {...fadeUp}>
              <div className="inline-flex items-center gap-2 text-violet-400 text-sm font-medium mb-4">
                <div className="h-px w-8 bg-violet-400" />GET STARTED<div className="h-px w-8 bg-violet-400" />
              </div>
              <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">Start evaluating for free</h2>
              <p className="text-slate-400 text-lg leading-relaxed mb-8">
                Registration is free and access is free. Create your buyer account with a company email and get full access to live market intelligence, RFP tools and security monitoring.
              </p>
              <ul className="space-y-3 mb-8">
                {[
                  "No credit card required",
                  "No vendor sponsorships or paid placements",
                  "Company email required to keep the community enterprise-grade",
                ].map((item) => (
                  <li key={item} className="flex items-center gap-3 text-slate-300">
                    <CheckCircle2 className="h-5 w-5 text-cyan-400 flex-shrink-0" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </motion.div>

            <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6, delay: 0.15 }}>
              <PersonaRegistrationForm persona="buyer" />
            </motion.div>
          </div>
        </div>
      </section>
    </div>
  );
}
