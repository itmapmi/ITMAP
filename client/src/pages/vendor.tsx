import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Link } from "wouter";
import { useSeo } from "@/hooks/use-seo";
import { track, trackDwell } from "@/lib/track";
import { Button } from "@/components/ui/button";
import ContactSalesModal from "@/components/contact-sales-modal";
import {
  ArrowRight, Building2, Shield, FileText, MessageSquare, Globe2, TrendingUp, Zap, CheckCircle2, BarChart3, Layers, Target, Lock, Mail
} from "lucide-react";

const fadeUp = {
  initial: { opacity: 0, y: 30 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-80px" },
  transition: { duration: 0.6, ease: [0.25, 0.25, 0, 1] as any },
};

const VENDOR_CAPABILITIES = [
  {
    icon: <Globe2 className="h-7 w-7 text-violet-400" />,
    title: "Markets",
    desc: "Explore every IT market ITMAP covers. See who competes in your space, how positions are changing and where buyers are focusing their attention.",
  },
  {
    icon: <TrendingUp className="h-7 w-7 text-cyan-400" />,
    title: "ITMAP Live Vendor Intelligence",
    desc: "Track your real-time market position across execution and product strength. Monitor score movement, news impact and competitive shifts as they happen.",
  },
  {
    icon: <BarChart3 className="h-7 w-7 text-violet-400" />,
    title: "Lead Generation",
    desc: "Surface buyer-intent signals from companies researching your market. See which organisations are engaging with your category and prioritise outreach.",
  },
  {
    icon: <Layers className="h-7 w-7 text-cyan-400" />,
    title: "Forecast Builder",
    desc: "Build AI-assisted market-size and growth forecasts for your segment. Model scenarios, assumptions and sensitivities to support planning and investor conversations.",
  },
  {
    icon: <Target className="h-7 w-7 text-violet-400" />,
    title: "Market Builder",
    desc: "Create custom evaluations using your own criteria and weights. Demonstrate how your product stacks up against competitors on the dimensions that matter to you.",
  },
  {
    icon: <FileText className="h-7 w-7 text-cyan-400" />,
    title: "RFP Responder",
    desc: "Respond to buyer RFPs faster with AI-generated answers grounded in your product data, feature support and market positioning.",
  },
  {
    icon: <MessageSquare className="h-7 w-7 text-violet-400" />,
    title: "Battlecards",
    desc: "Generate competitive battlecards for every market where you compete. Arm your sales team with head-to-head comparisons, win themes and objection handling.",
  },
  {
    icon: <Shield className="h-7 w-7 text-cyan-400" />,
    title: "Security Intelligence",
    desc: "Monitor CVEs, CISA KEV alerts and EPSS exploit scores across your portfolio and the wider vendor landscape. Stay ahead of security-related buyer questions.",
  },
];

export default function VendorLandingPage() {
  const [showContactModal, setShowContactModal] = useState(false);

  useSeo({
    title: "IT Vendors — ITMAP | Vendor Intelligence & Sales Tools",
    description: "ITMAP vendor intelligence, lead generation, forecast builder, market builder, RFP responder, battlecards and security intelligence for IT vendors.",
    path: "/vendor",
  });

  useEffect(() => {
    track("filter_applied", { metadata: { context: "vendor-landing" } });
    const endDwell = trackDwell({ metadata: { page: "vendor-landing" } });
    return endDwell;
  }, []);

  return (
    <div className="min-h-screen bg-[#1e2130] text-white overflow-x-hidden">
      {/* Hero */}
      <section className="relative py-20 lg:py-28 border-b border-white/5">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_20%_30%,rgba(139,92,246,0.12)_0%,transparent_60%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_80%_70%,rgba(14,165,233,0.08)_0%,transparent_60%)]" />
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
              <div className="inline-flex items-center gap-2 text-violet-400 text-sm font-medium mb-5">
                <div className="h-px w-8 bg-violet-400" />
                FOR IT VENDORS
                <div className="h-px w-8 bg-violet-400" />
              </div>
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold leading-tight mb-6">
                Intelligence and tools built for{" "}
                <span className="bg-gradient-to-r from-violet-400 to-cyan-400 bg-clip-text text-transparent">
                  IT vendors
                </span>
              </h1>
              <p className="text-lg text-slate-400 leading-relaxed mb-8 max-w-xl">
                Live market positioning, lead generation, RFP response, battlecards, security monitoring and custom forecasting — all in one vendor intelligence platform.
              </p>
              <div className="flex flex-col sm:flex-row gap-4">
                <div className="flex flex-col items-center gap-2">
                  <button
                    onClick={() => setShowContactModal(true)}
                    className="inline-flex items-center justify-center gap-2 bg-gradient-to-r from-violet-500 to-cyan-500 hover:from-violet-400 hover:to-cyan-400 text-white border-0 rounded-lg px-6 py-3 h-auto text-base font-semibold transition-all"
                  >
                    Contact Sales <ArrowRight className="h-4 w-4" />
                  </button>
                  <a href="mailto:sales@itmap.ai" className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-cyan-300 transition-colors">
                    <Mail className="h-3.5 w-3.5" /> sales@itmap.ai
                  </a>
                </div>
                <Link href="/markets">
                  <Button variant="outline" className="border-white/10 text-slate-300 hover:text-white hover:border-white/20 bg-transparent px-6 py-3 h-auto text-base">
                    Explore Markets <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </Link>
              </div>
            </motion.div>

            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.6, delay: 0.1 }} className="relative">
              <div className="absolute inset-0 bg-gradient-to-r from-violet-500/20 to-cyan-500/20 rounded-3xl blur-3xl" />
              <div className="relative grid grid-cols-2 gap-4">
                <div className="bg-slate-900/80 border border-white/10 rounded-2xl p-5 backdrop-blur">
                  <TrendingUp className="h-8 w-8 text-violet-400 mb-3" />
                  <div className="text-2xl font-bold text-white mb-1">Live</div>
                  <div className="text-sm text-slate-500">Position tracking</div>
                </div>
                <div className="bg-slate-900/80 border border-white/10 rounded-2xl p-5 backdrop-blur">
                  <BarChart3 className="h-8 w-8 text-cyan-400 mb-3" />
                  <div className="text-2xl font-bold text-white mb-1">Buyer</div>
                  <div className="text-sm text-slate-500">Intent signals</div>
                </div>
                <div className="col-span-2 bg-slate-900/80 border border-white/10 rounded-2xl p-5 backdrop-blur flex items-center justify-between">
                  <div>
                    <div className="text-2xl font-bold text-white mb-1">8</div>
                    <div className="text-sm text-slate-500">Vendor tools</div>
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
            <div className="inline-flex items-center gap-2 text-violet-400 text-sm font-medium mb-4">
              <div className="h-px w-8 bg-violet-400" />VENDOR CAPABILITIES<div className="h-px w-8 bg-violet-400" />
            </div>
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-white mb-4">Everything you need to compete and sell</h2>
            <p className="text-slate-400 text-lg max-w-2xl mx-auto">A complete vendor intelligence and go-to-market toolkit for IT vendors.</p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {VENDOR_CAPABILITIES.map((cap, i) => (
              <motion.div
                key={cap.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.06, duration: 0.5 }}
                className="group bg-slate-900 border border-white/5 hover:border-violet-500/20 rounded-2xl p-6 transition-all"
              >
                <div className="mb-4">{cap.icon}</div>
                <h3 className="text-lg font-bold text-white mb-2">{cap.title}</h3>
                <p className="text-sm text-slate-400 leading-relaxed">{cap.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Contact / Access CTA */}
      <section id="contact" className="py-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center">
            <motion.div {...fadeUp}>
              <div className="inline-flex items-center gap-2 text-cyan-400 text-sm font-medium mb-4">
                <div className="h-px w-8 bg-cyan-400" />GET ACCESS<div className="h-px w-8 bg-cyan-400" />
              </div>
              <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">Talk to our team about vendor access</h2>
              <p className="text-slate-400 text-lg leading-relaxed mb-8">
                Vendor tools are available through ITMAP's vendor programme. Contact sales to learn about access, onboarding and how your team can start using the platform.
              </p>
              <ul className="space-y-3 mb-8">
                {[
                  "Live vendor intelligence and market positioning",
                  "Lead generation and RFP response tools",
                  "Battlecards, forecasting and security monitoring",
                  "Dedicated onboarding and support",
                ].map((item) => (
                  <li key={item} className="flex items-center gap-3 text-slate-300">
                    <CheckCircle2 className="h-5 w-5 text-violet-400 flex-shrink-0" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
              <div className="inline-flex flex-col items-center gap-2">
                <button
                  onClick={() => setShowContactModal(true)}
                  className="inline-flex items-center gap-2 bg-gradient-to-r from-violet-500 to-cyan-500 hover:from-violet-400 hover:to-cyan-400 text-white px-6 py-3 rounded-lg font-semibold transition-all"
                >
                  Contact Sales <ArrowRight className="h-4 w-4" />
                </button>
                <a href="mailto:sales@itmap.ai" className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-cyan-300 transition-colors">
                  <Mail className="h-4 w-4" /> sales@itmap.ai
                </a>
              </div>
            </motion.div>

            <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6, delay: 0.15 }}>
              <div className="bg-slate-900 border border-white/8 rounded-2xl p-8 relative overflow-hidden">
                <div className="absolute top-0 right-0 p-4 opacity-10">
                  <Lock className="h-32 w-32 text-violet-400" />
                </div>
                <div className="relative">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="p-2 rounded-lg bg-violet-500/15 border border-violet-400/20">
                      <Building2 className="h-5 w-5 text-violet-400" />
                    </div>
                    <span className="text-sm font-semibold text-violet-300">Vendor Access</span>
                  </div>
                  <h3 className="text-xl font-bold text-white mb-2">Enterprise-ready vendor tools</h3>
                  <p className="text-slate-400 text-sm leading-relaxed mb-6">
                    Contact sales to discuss your company's needs, see a demo of the vendor platform, and get your team set up.
                  </p>
                  <div className="flex items-center gap-2 text-sm text-slate-500">
                    <Zap className="h-4 w-4 text-cyan-400" />
                    <span>One business day response time</span>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      <ContactSalesModal isOpen={showContactModal} onClose={() => setShowContactModal(false)} />
    </div>
  );
}
