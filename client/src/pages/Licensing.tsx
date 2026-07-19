import { motion } from "framer-motion";
import { useSeo } from "@/hooks/use-seo";
import { Button } from "@/components/ui/button";
import { Shield, FileText, CheckCircle2, XCircle, ArrowRight, Mail } from "lucide-react";

const fadeUp = {
  initial: { opacity: 0, y: 30 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-80px" },
  transition: { duration: 0.6, ease: [0.25, 0.25, 0, 1] as any },
};

const REQUIRES_LICENSE = [
  "Charts, diagrams, matrices, market maps or other graphics created by ITMAP",
  "Research content: report excerpts, key takeaways, ratings, quotes, summaries or narrative text",
  "Data points or findings unique to ITMAP (even if paraphrased) when used to endorse products or services",
  "Translations of any ITMAP content",
  "Thumbnails or screengrabs of our graphics",
  "Use of ITMAP logos, product marks or badges",
];

const NO_LICENSE = [
  "Linking to public ITMAP pages using article or report titles",
  "Short, purely editorial citations in neutral journalistic contexts (vendors must still obtain a license)",
];

const STEPS = [
  {
    num: "01",
    title: "Submit a request",
    desc: "Email support@itmap.ai with the asset(s) you want to use, the full context (pages, URLs, channels, languages) and intended audience reach.",
    cta: { label: "Email us", href: "mailto:support@itmap.ai" },
  },
  {
    num: "02",
    title: "We scope and quote",
    desc: "Fees depend on asset type, distribution geography, channels, duration and exclusivity. We'll respond within 2 business days.",
    cta: null,
  },
  {
    num: "03",
    title: "Agreement & invoice",
    desc: "We issue a short reprint licence agreement. Once executed and paid, you'll receive approved files and attribution copy.",
    cta: null,
  },
  {
    num: "04",
    title: "Implement & attribute",
    desc: "Publish using our supplied assets, attribution line and optional Licensed Reprint badge.",
    cta: null,
  },
  {
    num: "05",
    title: "Compliance review",
    desc: "For high-visibility placements, we can pre-review to ensure brand and research integrity before go-live.",
    cta: null,
  },
  {
    num: "06",
    title: "Renew or retire",
    desc: "Licences expire at the end of the agreed term. You may renew or remove the content.",
    cta: null,
  },
];

export default function Licensing() {
  useSeo({
    title: "Licensing & Reprints — ITMAP",
    description: "License ITMAP vendor evaluations, market reports, and forecasts for internal use, marketing, sales enablement, or analyst-style reprint rights.",
    path: "/licensing",
  });
  return (
    <div className="min-h-screen bg-[#1e2130] text-white">
      {/* Hero */}
      <section className="relative py-24 overflow-hidden border-b border-white/5">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_30%_50%,rgba(14,165,233,0.08)_0%,transparent_60%)]" />
        <div className="relative max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <div className="inline-flex items-center gap-2 text-cyan-400 text-sm font-medium mb-6">
              <Shield className="h-4 w-4" /> Licensing & Reprints
            </div>
            <h1 className="text-5xl sm:text-6xl font-bold mb-6 leading-tight">
              Third-party use of
              <br />
              <span className="bg-gradient-to-r from-cyan-400 to-violet-400 bg-clip-text text-transparent">ITMAP research</span>
            </h1>
            <p className="text-xl text-slate-400 leading-relaxed max-w-2xl">
              Our research and graphics are protected intellectual property. Here's what requires a licence and how to get one.
            </p>
          </motion.div>
        </div>
      </section>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-16 space-y-10">
        {/* Requires licence */}
        <motion.div {...fadeUp} className="bg-slate-900 border border-white/5 rounded-2xl p-8">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-2 bg-red-400/10 rounded-lg">
              <FileText className="h-5 w-5 text-red-400" />
            </div>
            <h2 className="text-2xl font-bold text-white">What requires a licence?</h2>
          </div>
          <p className="text-slate-400 mb-6 leading-relaxed">
            The following always require a ITMAP reprint licence when used by vendors or for promotional / marketing purposes:
          </p>
          <ul className="space-y-3">
            {REQUIRES_LICENSE.map((item) => (
              <li key={item} className="flex items-start gap-3">
                <XCircle className="h-5 w-5 text-red-400 flex-shrink-0 mt-0.5" />
                <span className="text-slate-300 leading-snug">{item}</span>
              </li>
            ))}
          </ul>
        </motion.div>

        {/* Does not require */}
        <motion.div {...fadeUp} className="bg-slate-900 border border-white/5 rounded-2xl p-8">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-2 bg-emerald-400/10 rounded-lg">
              <CheckCircle2 className="h-5 w-5 text-emerald-400" />
            </div>
            <h2 className="text-2xl font-bold text-white">What does not require a licence?</h2>
          </div>
          <ul className="space-y-3">
            {NO_LICENSE.map((item) => (
              <li key={item} className="flex items-start gap-3">
                <CheckCircle2 className="h-5 w-5 text-emerald-400 flex-shrink-0 mt-0.5" />
                <span className="text-slate-300 leading-snug">{item}</span>
              </li>
            ))}
          </ul>
        </motion.div>

        {/* Process */}
        <motion.div {...fadeUp}>
          <h2 className="text-3xl font-bold text-white mb-8">How the licensing process works</h2>
          <div className="space-y-4">
            {STEPS.map((step, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: -20 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.08, duration: 0.5 }}
                className="flex gap-6 bg-slate-900 border border-white/5 hover:border-cyan-500/20 rounded-2xl p-6 transition-all group"
              >
                <div className="flex-shrink-0 w-12 h-12 bg-gradient-to-br from-cyan-500/15 to-violet-600/15 border border-white/10 rounded-xl flex items-center justify-center">
                  <span className="text-sm font-bold text-cyan-400">{step.num}</span>
                </div>
                <div className="flex-grow">
                  <h3 className="font-semibold text-white mb-2">{step.title}</h3>
                  <p className="text-slate-400 text-sm leading-relaxed">{step.desc}</p>
                  {step.cta && (
                    <a
                      href={step.cta.href}
                      className="inline-flex items-center gap-1.5 text-cyan-400 text-sm font-medium mt-3 hover:text-cyan-300 transition-colors"
                    >
                      {step.cta.label} <ArrowRight className="h-3.5 w-3.5" />
                    </a>
                  )}
                </div>
              </motion.div>
            ))}
          </div>
        </motion.div>

        {/* Contact CTA */}
        <motion.div {...fadeUp} className="relative bg-gradient-to-br from-slate-900 to-slate-950 border border-cyan-500/20 rounded-2xl p-10 text-center overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(14,165,233,0.06)_0%,transparent_70%)]" />
          <div className="relative">
            <Mail className="h-8 w-8 text-cyan-400 mx-auto mb-4" />
            <h3 className="text-xl font-bold text-white mb-2">Questions about licensing?</h3>
            <p className="text-slate-400 mb-6">Our team typically responds within 2 business days.</p>
            <a href="mailto:support@itmap.ai">
              <Button className="bg-gradient-to-r from-cyan-500 to-violet-600 hover:from-cyan-400 hover:to-violet-500 text-white border-0">
                Contact support@itmap.ai <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </a>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
