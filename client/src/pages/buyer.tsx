import { useEffect } from "react";
import { motion } from "framer-motion";
import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import { useSeo } from "@/hooks/use-seo";
import { track, trackDwell } from "@/lib/track";
import { Button } from "@/components/ui/button";
import { PersonaRegistrationForm } from "@/components/persona-registration-form";
import {
  ArrowRight, Target, Shield, FileText, MessageSquare, Globe2, BarChart3, Eye, Zap, CheckCircle2, Sparkles, Gift
} from "lucide-react";

const fadeUp = {
  initial: { opacity: 0, y: 30 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-80px" },
  transition: { duration: 0.6, ease: [0.25, 0.25, 0, 1] as any },
};

const BUYER_CAPABILITIES = [
  {
    key: "vendorEvaluation",
    icon: <BarChart3 className="h-7 w-7 text-cyan-400" />,
  },
  {
    key: "productEvaluation",
    icon: <Target className="h-7 w-7 text-violet-400" />,
  },
  {
    key: "ecosystemEvaluation",
    icon: <Globe2 className="h-7 w-7 text-cyan-400" />,
  },
  {
    key: "conversationPlatform",
    icon: <MessageSquare className="h-7 w-7 text-violet-400" />,
  },
  {
    key: "securityIntelligence",
    icon: <Shield className="h-7 w-7 text-cyan-400" />,
  },
  {
    key: "createRfps",
    icon: <FileText className="h-7 w-7 text-violet-400" />,
  },
];

export default function BuyerLandingPage() {
  const { t } = useTranslation("buyer");
  useSeo({
    title: t("seo.title"),
    description: t("seo.description"),
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
                {t("hero.eyebrow")}
                <div className="h-px w-8 bg-cyan-400" />
              </div>
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold leading-tight mb-6">
                {t("hero.titleLine1")}{" "}
                <span className="bg-gradient-to-r from-cyan-400 to-violet-400 bg-clip-text text-transparent">
                  {t("hero.titleLine2")}
                </span>
              </h1>
              <p className="text-lg text-slate-400 leading-relaxed mb-8 max-w-xl">
                {t("hero.description")}
              </p>
              <div className="flex flex-col sm:flex-row gap-4">
                <a href="#register" className="inline-flex items-center justify-center gap-2 bg-gradient-to-r from-cyan-500 to-violet-600 hover:from-cyan-400 hover:to-violet-500 text-white border-0 rounded-lg px-6 py-3 h-auto text-base font-semibold transition-all">
                  {t("hero.createAccount")} <Sparkles className="h-4 w-4" />
                </a>
                <Link href="/markets">
                  <Button variant="outline" className="border-white/10 text-slate-300 hover:text-white hover:border-white/20 bg-transparent px-6 py-3 h-auto text-base">
                    {t("hero.exploreMarkets")} <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </Link>
              </div>
            </motion.div>

            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.6, delay: 0.1 }} className="relative">
              <div className="absolute inset-0 bg-gradient-to-r from-cyan-500/20 to-violet-500/20 rounded-3xl blur-3xl" />
              <div className="relative grid grid-cols-2 gap-4">
                <div className="bg-slate-900/80 border border-white/10 rounded-2xl p-5 backdrop-blur">
                  <Eye className="h-8 w-8 text-cyan-400 mb-3" />
                  <div className="text-2xl font-bold text-white mb-1">40+</div>
                  <div className="text-sm text-slate-500">{t("hero.stats.scoringDimensions")}</div>
                </div>
                <div className="bg-slate-900/80 border border-white/10 rounded-2xl p-5 backdrop-blur">
                  <BarChart3 className="h-8 w-8 text-violet-400 mb-3" />
                  <div className="text-2xl font-bold text-white mb-1">100%</div>
                  <div className="text-sm text-slate-500">{t("hero.stats.independentResearch")}</div>
                </div>
                <div className="col-span-2 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl p-5 backdrop-blur flex items-center justify-between">
                  <div>
                    <div className="text-2xl font-bold text-emerald-400 mb-1">{t("hero.stats.freeForever")}</div>
                    <div className="text-sm text-emerald-200/70">{t("hero.stats.noCreditCard")}</div>
                  </div>
                  <Gift className="h-10 w-10 text-emerald-400" />
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
              <div className="h-px w-8 bg-cyan-400" />{t("capabilities.eyebrow")}<div className="h-px w-8 bg-cyan-400" />
            </div>
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-white mb-4">{t("capabilities.title")}</h2>
            <p className="text-slate-400 text-lg max-w-2xl mx-auto">{t("capabilities.description")}</p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {BUYER_CAPABILITIES.map((cap, i) => (
              <motion.div
                key={cap.key}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.08, duration: 0.5 }}
                className="group bg-slate-900 border border-white/5 hover:border-cyan-500/20 rounded-2xl p-6 transition-all"
              >
                <div className="mb-4">{cap.icon}</div>
                <h3 className="text-lg font-bold text-white mb-2">{t(`capabilities.items.${cap.key}.title`)}</h3>
                <p className="text-sm text-slate-400 leading-relaxed">{t(`capabilities.items.${cap.key}.description`)}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Free promise banner */}
      <section className="py-20 bg-emerald-500/5 border-y border-emerald-500/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6 }} className="text-center">
            <div className="inline-flex items-center gap-2 text-emerald-400 text-sm font-medium mb-4">
              <Sparkles className="h-4 w-4" /> {t("freePromise.eyebrow")}
            </div>
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">{t("freePromise.title")}</h2>
            <p className="text-slate-400 text-lg max-w-2xl mx-auto leading-relaxed">
              {t("freePromise.description")}
            </p>
          </motion.div>
        </div>
      </section>

      {/* Register CTA */}
      <section id="register" className="py-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-start">
            <motion.div {...fadeUp}>
              <div className="inline-flex items-center gap-2 text-violet-400 text-sm font-medium mb-4">
                <div className="h-px w-8 bg-violet-400" />{t("registration.eyebrow")}<div className="h-px w-8 bg-violet-400" />
              </div>
              <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">{t("registration.title")}</h2>
              <p className="text-slate-400 text-lg leading-relaxed mb-8">
                {t("registration.description")}
              </p>
              <ul className="space-y-3 mb-8">
                {["noCreditCard", "noSponsorships", "allFeatures", "anyEmail"].map((key) => (
                  <li key={key} className="flex items-center gap-3 text-slate-300">
                    <CheckCircle2 className="h-5 w-5 text-cyan-400 flex-shrink-0" />
                    <span>{t(`registration.benefits.${key}`)}</span>
                  </li>
                ))}
              </ul>
            </motion.div>

            <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6, delay: 0.15 }}>
              <PersonaRegistrationForm />
            </motion.div>
          </div>
        </div>
      </section>
    </div>
  );
}
