import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { useSeo } from "@/hooks/use-seo";
import { Button } from "@/components/ui/button";
import { Check, Mail, ArrowRight, Users, Building2 } from "lucide-react";

const fadeUp = {
  initial: { opacity: 0, y: 30 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-80px" },
  transition: { duration: 0.6, ease: [0.25, 0.25, 0, 1] as any },
};

const PLAN_KEYS = [
  { key: "end-user", i18nKey: "endUser", icon: Users, highlight: false },
  { key: "vendor", i18nKey: "vendor", icon: Building2, highlight: true },
] as const;

export default function Pricing() {
  const { t } = useTranslation("pricing");
  useSeo({
    title: t("seo.title"),
    description: t("seo.description"),
    path: "/pricing",
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
              <Mail className="h-4 w-4" /> {t("hero.eyebrow")}
            </div>
            <h1 className="text-5xl sm:text-6xl font-bold mb-6 leading-tight">
              {t("hero.titleLine1")}
              <br />
              <span className="bg-gradient-to-r from-cyan-400 to-violet-400 bg-clip-text text-transparent">{t("hero.titleLine2")}</span>
            </h1>
            <p className="text-xl text-slate-400 leading-relaxed max-w-2xl">
              {t("hero.subtitle")}
            </p>
          </motion.div>
        </div>
      </section>

      {/* Plans */}
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="grid md:grid-cols-2 gap-8">
          {PLAN_KEYS.map((plan, i) => {
            const Icon = plan.icon;
            const features = t(`plans.${plan.i18nKey}.features`, { returnObjects: true }) as string[];
            return (
              <motion.div
                key={plan.key}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-80px" }}
                transition={{ duration: 0.6, delay: i * 0.1 }}
                className={`relative rounded-2xl p-8 border flex flex-col ${
                  plan.highlight
                    ? "bg-gradient-to-br from-slate-900 to-slate-950 border-cyan-500/30"
                    : "bg-slate-900 border-white/5"
                }`}
              >
                {plan.highlight && (
                  <div className="absolute -top-3 left-8 px-3 py-1 rounded-full bg-gradient-to-r from-cyan-500 to-violet-600 text-xs font-semibold text-white">
                    {t(`plans.${plan.i18nKey}.badge`)}
                  </div>
                )}
                <div className="flex items-center gap-3 mb-6">
                  <div className="p-2.5 bg-cyan-400/10 rounded-lg">
                    <Icon className="h-5 w-5 text-cyan-400" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-white">{t(`plans.${plan.i18nKey}.name`)}</h2>
                    <p className="text-sm text-slate-400">{t(`plans.${plan.i18nKey}.audience`)}</p>
                  </div>
                </div>

                <div className="mb-6">
                  <span className="text-4xl font-bold text-white">{t(`plans.${plan.i18nKey}.price`)}</span>
                  <span className="text-slate-400 ml-1">{t(`plans.${plan.i18nKey}.unit`)}</span>
                </div>

                <ul className="space-y-3 mb-8 flex-grow">
                  {features.map((feature) => (
                    <li key={feature} className="flex items-start gap-3">
                      <Check className="h-5 w-5 text-cyan-400 flex-shrink-0 mt-0.5" />
                      <span className="text-slate-300 leading-snug">{feature}</span>
                    </li>
                  ))}
                </ul>

                <a href="mailto:Sales@itmap.ai" className="mt-auto">
                  <Button
                    className={`w-full ${
                      plan.highlight
                        ? "bg-gradient-to-r from-cyan-500 to-violet-600 hover:from-cyan-400 hover:to-violet-500 text-white border-0"
                        : "bg-slate-800 hover:bg-slate-700 text-white border border-white/10"
                    }`}
                  >
                    {t("contactSales")} <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </a>
              </motion.div>
            );
          })}
        </div>

        {/* Contact CTA */}
        <motion.div
          {...fadeUp}
          className="relative bg-gradient-to-br from-slate-900 to-slate-950 border border-cyan-500/20 rounded-2xl p-10 text-center overflow-hidden mt-16"
        >
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(14,165,233,0.06)_0%,transparent_70%)]" />
          <div className="relative">
            <Mail className="h-8 w-8 text-cyan-400 mx-auto mb-4" />
            <h3 className="text-xl font-bold text-white mb-2">{t("cta.heading")}</h3>
            <p className="text-slate-400 mb-6">{t("cta.body")}</p>
            <a href="mailto:Sales@itmap.ai">
              <Button className="bg-gradient-to-r from-cyan-500 to-violet-600 hover:from-cyan-400 hover:to-violet-500 text-white border-0">
                {t("cta.buttonPrefix")} Sales@itmap.ai <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </a>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
