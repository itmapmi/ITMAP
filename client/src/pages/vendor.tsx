import { useEffect } from "react";
import { motion } from "framer-motion";
import { Link } from "wouter";
import { useSeo } from "@/hooks/use-seo";
import { track, trackDwell } from "@/lib/track";
import { Button } from "@/components/ui/button";
import { PersonaRegistrationForm } from "@/components/persona-registration-form";
import {
  ArrowRight, Building2, Shield, FileText, MessageSquare, Globe2, TrendingUp, Zap, CheckCircle2, Users
} from "lucide-react";

const fadeUp = {
  initial: { opacity: 0, y: 30 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-80px" },
  transition: { duration: 0.6, ease: [0.25, 0.25, 0, 1] as any },
};

const VENDOR_CAPABILITIES = [
  {
    icon: <TrendingUp className="h-7 w-7 text-violet-400" />,
    title: "Market Position Tracking",
    desc: "See how your company ranks against competitors on execution and product strength. Track movement over time and understand the drivers behind every score.",
  },
  {
    icon: <Building2 className="h-7 w-7 text-cyan-400" />,
    title: "Product & Ecosystem Profiles",
    desc: "Keep your product capabilities and partner ecosystem accurately represented. Compare against market leaders and identify whitespace opportunities.",
  },
  {
    icon: <MessageSquare className="h-7 w-7 text-violet-400" />,
    title: "News & Signal Intelligence",
    desc: "Monitor news and AI-scored signals that affect your market position. React faster to competitive moves, CVEs, funding rounds and product launches.",
  },
  {
    icon: <Shield className="h-7 w-7 text-cyan-400" />,
    title: "Security Intelligence",
    desc: "Track vulnerabilities, CISA KEV alerts and EPSS scores across your product portfolio and the wider vendor landscape.",
  },
  {
    icon: <FileText className="h-7 w-7 text-violet-400" />,
    title: "RFP Responder",
    desc: "Respond to buyer RFPs with AI-generated answers grounded in your product data, feature support and market positioning.",
  },
  {
    icon: <Globe2 className="h-7 w-7 text-cyan-400" />,
    title: "Lead Generation & Battle Cards",
    desc: "Access buyer-intent signals and generate competitive battle cards for every market where you compete.",
  },
];

export default function VendorLandingPage() {
  useSeo({
    title: "IT Vendors — ITMAP | Free Market Intelligence & RFP Tools",
    description: "Free vendor intelligence hub for IT vendors. Track market position, monitor news and security signals, respond to RFPs and generate battle cards.",
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
                Own your market{" "}
                <span className="bg-gradient-to-r from-violet-400 to-cyan-400 bg-clip-text text-transparent">
                  position
                </span>
              </h1>
              <p className="text-lg text-slate-400 leading-relaxed mb-8 max-w-xl">
                Free market intelligence, RFP response tools, security monitoring and competitive battle cards — built for IT vendors who want to stay ahead.
              </p>
              <div className="flex flex-col sm:flex-row gap-4">
                <a href="#register" className="inline-flex items-center justify-center gap-2 bg-gradient-to-r from-violet-500 to-cyan-500 hover:from-violet-400 hover:to-cyan-400 text-white border-0 rounded-lg px-6 py-3 h-auto text-base font-semibold transition-all">
                  Register Free <Zap className="h-4 w-4" />
                </a>
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
                  <Users className="h-8 w-8 text-cyan-400 mb-3" />
                  <div className="text-2xl font-bold text-white mb-1">Buyer</div>
                  <div className="text-sm text-slate-500">Intent signals</div>
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
            <div className="inline-flex items-center gap-2 text-violet-400 text-sm font-medium mb-4">
              <div className="h-px w-8 bg-violet-400" />CAPABILITIES<div className="h-px w-8 bg-violet-400" />
            </div>
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-white mb-4">Intelligence built for vendors</h2>
            <p className="text-slate-400 text-lg max-w-2xl mx-auto">Track your position, respond to opportunities, monitor security and competitive signals.</p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {VENDOR_CAPABILITIES.map((cap, i) => (
              <motion.div
                key={cap.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.08, duration: 0.5 }}
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

      {/* Register CTA */}
      <section id="register" className="py-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-start">
            <motion.div {...fadeUp}>
              <div className="inline-flex items-center gap-2 text-cyan-400 text-sm font-medium mb-4">
                <div className="h-px w-8 bg-cyan-400" />GET STARTED<div className="h-px w-8 bg-cyan-400" />
              </div>
              <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">Start tracking your market for free</h2>
              <p className="text-slate-400 text-lg leading-relaxed mb-8">
                Registration is free and access is free. Create your vendor account with a company email and get full access to market intelligence, RFP tools and lead signals.
              </p>
              <ul className="space-y-3 mb-8">
                {[
                  "No credit card required",
                  "Monitor your market position and news signals",
                  "Company email required to keep the community enterprise-grade",
                ].map((item) => (
                  <li key={item} className="flex items-center gap-3 text-slate-300">
                    <CheckCircle2 className="h-5 w-5 text-violet-400 flex-shrink-0" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </motion.div>

            <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6, delay: 0.15 }}>
              <PersonaRegistrationForm persona="vendor" />
            </motion.div>
          </div>
        </div>
      </section>
    </div>
  );
}
