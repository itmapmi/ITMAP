import { motion } from "framer-motion";
import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import { useSeo } from "@/hooks/use-seo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Shield, Zap, Eye, Globe2, ArrowRight, CheckCircle2, Brain, Mail, MapPin, Clock, MessageSquare } from "lucide-react";

const fadeUp = {
  initial: { opacity: 0, y: 30 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-80px" },
  transition: { duration: 0.6, ease: [0.25, 0.25, 0, 1] as any },
};

const VALUES = [
  {
    icon: <Shield className="h-6 w-6 text-cyan-400" />,
  },
  {
    icon: <Eye className="h-6 w-6 text-violet-400" />,
  },
  {
    icon: <Zap className="h-6 w-6 text-cyan-400" />,
  },
  {
    icon: <Brain className="h-6 w-6 text-violet-400" />,
  },
];

const CONTACT_DETAILS = [
  {
    icon: <Mail className="h-5 w-5 text-cyan-400" />,
    value: "sales@itmap.ai",
    href: "mailto:sales@itmap.ai",
    color: "from-cyan-500/15 to-cyan-400/5",
  },
  {
    icon: <MapPin className="h-5 w-5 text-cyan-400" />,
    value: "Jewellery & Gemplex 3, DMCC, Dubai, UAE",
    href: null,
    color: "from-cyan-500/15 to-cyan-400/5",
  },
  {
    icon: <Clock className="h-5 w-5 text-violet-400" />,
    value: "Mon – Fri: 9:00 AM – 6:00 PM GST",
    href: null,
    color: "from-violet-500/15 to-violet-400/5",
  },
];

export default function About() {
  const { t } = useTranslation("about");
  useSeo({
    title: t("seo.title"),
    description: t("seo.description"),
    path: "/about",
  });
  return (
    <div className="min-h-screen bg-[#1e2130] text-white">
      {/* Hero */}
      <section className="relative py-28 overflow-hidden border-b border-white/5">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_30%_40%,rgba(14,165,233,0.1)_0%,transparent_60%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_70%_60%,rgba(124,58,237,0.08)_0%,transparent_60%)]" />
        <div className="relative max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <div className="inline-flex items-center gap-2 text-cyan-400 text-sm font-medium mb-6">
              <Globe2 className="h-4 w-4" /> {t("hero.eyebrow")}
            </div>
            <h1 className="text-5xl sm:text-6xl lg:text-7xl font-bold leading-[1.08] mb-8">
              {t("hero.titleLine1")}
              <br />
              <span className="bg-gradient-to-r from-cyan-400 to-violet-400 bg-clip-text text-transparent">{t("hero.titleLine2")}</span>
            </h1>
            <p className="text-xl text-slate-400 max-w-2xl mx-auto leading-relaxed">
              {t("hero.subtitle")}
            </p>
          </motion.div>
        </div>
      </section>

      {/* Mission */}
      <section className="py-24 border-b border-white/5">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
            <motion.div {...fadeUp}>
              <div className="inline-flex items-center gap-2 text-cyan-400 text-sm font-medium mb-6">
                <div className="h-px w-8 bg-cyan-400" /> {t("mission.eyebrow")}
              </div>
              <h2 className="text-4xl font-bold text-white mb-6 leading-tight">
                {t("mission.heading")}
              </h2>
              <p className="text-slate-400 text-lg leading-relaxed mb-6">
                {t("mission.paragraph1")}
              </p>
              <p className="text-slate-400 text-lg leading-relaxed mb-8">
                {t("mission.paragraph2")}
              </p>
              <Link href="/platform">
                <Button className="bg-gradient-to-r from-cyan-500 to-violet-600 hover:from-cyan-400 hover:to-violet-500 text-white border-0">
                  {t("mission.button")} <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, x: 30 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6 }}
              className="space-y-4"
            >
              {[
                { label: t("mission.metrics.independence.label"), pct: 100, color: "from-cyan-500 to-cyan-400", note: t("mission.metrics.independence.note") },
                { label: t("mission.metrics.dataCurrency.label"), pct: 97, color: "from-cyan-500 to-violet-500", note: t("mission.metrics.dataCurrency.note") },
                { label: t("mission.metrics.sourceTransparency.label"), pct: 100, color: "from-violet-500 to-violet-400", note: t("mission.metrics.sourceTransparency.note") },
                { label: t("mission.metrics.coverageBreadth.label"), pct: 85, color: "from-cyan-400 to-violet-500", note: t("mission.metrics.coverageBreadth.note") },
              ].map((item) => (
                <div key={item.label} className="bg-slate-900 border border-white/5 rounded-2xl p-5">
                  <div className="flex items-center justify-between mb-3">
                    <span className="font-medium text-white">{item.label}</span>
                    <div className="text-right">
                      <span className="text-xl font-bold text-white">{item.pct}%</span>
                      <p className="text-xs text-slate-500">{item.note}</p>
                    </div>
                  </div>
                  <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                    <motion.div
                      className={`h-full bg-gradient-to-r ${item.color} rounded-full`}
                      initial={{ width: 0 }}
                      whileInView={{ width: `${item.pct}%` }}
                      viewport={{ once: true }}
                      transition={{ duration: 1, delay: 0.2, ease: "easeOut" }}
                    />
                  </div>
                </div>
              ))}
            </motion.div>
          </div>
        </div>
      </section>

      {/* Values */}
      <section className="py-24 border-b border-white/5">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div {...fadeUp} className="text-center mb-16">
            <div className="inline-flex items-center gap-2 text-violet-400 text-sm font-medium mb-4">
              <div className="h-px w-8 bg-violet-400" /> {t("values.eyebrow")}
            </div>
            <h2 className="text-4xl sm:text-5xl font-bold text-white">
              {t("values.heading")}
            </h2>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {VALUES.map((v, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1, duration: 0.5 }}
                className="bg-slate-900 border border-white/5 hover:border-white/10 rounded-2xl p-8 transition-all"
              >
                <div className="p-3 bg-slate-800 rounded-xl w-fit mb-5">{v.icon}</div>
                <h3 className="text-xl font-bold text-white mb-3">{t(`values.items.${i}.title`)}</h3>
                <p className="text-slate-400 leading-relaxed">{t(`values.items.${i}.description`)}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Team */}
      <section className="py-24 border-b border-white/5">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div {...fadeUp} className="max-w-2xl">
            <div className="inline-flex items-center gap-2 text-cyan-400 text-sm font-medium mb-6">
              <div className="h-px w-8 bg-cyan-400" /> {t("team.eyebrow")}
            </div>
            <h2 className="text-4xl font-bold text-white mb-6 leading-tight">
              {t("team.heading")}
            </h2>
            <p className="text-slate-400 text-lg leading-relaxed mb-8">
              {t("team.description")}
            </p>
            <ul className="space-y-3">
              {(t("team.highlights", { returnObjects: true }) as string[]).map((highlight) => (
                <li key={highlight} className="flex items-start gap-3 text-slate-300">
                  <CheckCircle2 className="h-5 w-5 text-cyan-400 flex-shrink-0 mt-0.5" />
                  <span>{highlight}</span>
                </li>
              ))}
            </ul>
          </motion.div>
        </div>
      </section>

      {/* Contact */}
      <section className="py-24 border-b border-white/5">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div {...fadeUp} className="text-center mb-16">
            <div className="inline-flex items-center gap-2 text-cyan-400 text-sm font-medium mb-4">
              <MessageSquare className="h-4 w-4" /> {t("contact.eyebrow")}
            </div>
            <h2 className="text-4xl sm:text-5xl font-bold text-white mb-4">
              {t("contact.heading")}
            </h2>
            <p className="text-slate-400 max-w-xl mx-auto">
              {t("contact.description")}
            </p>
          </motion.div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
            {/* Form */}
            <motion.div {...fadeUp}>
              <div className="bg-slate-900 border border-white/5 rounded-2xl p-8">
                <h3 className="text-2xl font-bold text-white mb-2">{t("contact.form.heading")}</h3>
                <p className="text-slate-500 text-sm mb-8">{t("contact.form.responseTime")}</p>
                <div className="space-y-5">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="firstName" className="text-slate-400 text-sm">{t("contact.form.firstName")}</Label>
                      <Input id="firstName" placeholder={t("contact.form.firstNamePlaceholder")} className="bg-slate-800 border-white/10 text-white placeholder:text-slate-600 focus:border-cyan-500/50 focus:ring-cyan-500/20 rounded-xl" />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="lastName" className="text-slate-400 text-sm">{t("contact.form.lastName")}</Label>
                      <Input id="lastName" placeholder={t("contact.form.lastNamePlaceholder")} className="bg-slate-800 border-white/10 text-white placeholder:text-slate-600 focus:border-cyan-500/50 focus:ring-cyan-500/20 rounded-xl" />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="email" className="text-slate-400 text-sm">{t("contact.form.workEmail")}</Label>
                    <Input id="email" type="email" placeholder={t("contact.form.emailPlaceholder")} className="bg-slate-800 border-white/10 text-white placeholder:text-slate-600 focus:border-cyan-500/50 focus:ring-cyan-500/20 rounded-xl" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="company" className="text-slate-400 text-sm">{t("contact.form.company")}</Label>
                    <Input id="company" placeholder={t("contact.form.companyPlaceholder")} className="bg-slate-800 border-white/10 text-white placeholder:text-slate-600 focus:border-cyan-500/50 focus:ring-cyan-500/20 rounded-xl" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="subject" className="text-slate-400 text-sm">{t("contact.form.subject")}</Label>
                    <Input id="subject" placeholder={t("contact.form.subjectPlaceholder")} className="bg-slate-800 border-white/10 text-white placeholder:text-slate-600 focus:border-cyan-500/50 focus:ring-cyan-500/20 rounded-xl" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="message" className="text-slate-400 text-sm">{t("contact.form.message")}</Label>
                    <Textarea id="message" placeholder={t("contact.form.messagePlaceholder")} rows={5} className="bg-slate-800 border-white/10 text-white placeholder:text-slate-600 focus:border-cyan-500/50 focus:ring-cyan-500/20 rounded-xl resize-none" />
                  </div>
                  <Button
                    className="w-full bg-gradient-to-r from-cyan-500 to-violet-600 hover:from-cyan-400 hover:to-violet-500 text-white border-0 py-6 text-base font-semibold"
                    onClick={() => window.location.href = "mailto:sales@itmap.ai"}
                  >
                    {t("contact.form.sendMessage")} <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                  <p className="text-xs text-slate-600 text-center">{t("contact.form.privacyPrefix")} <Link href="/privacy-policy" className="text-cyan-500 hover:text-cyan-400">{t("contact.form.privacyPolicy")}</Link>.</p>
                </div>
              </div>
            </motion.div>

            {/* Contact details */}
            <div className="space-y-5">
              {CONTACT_DETAILS.map((detail, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, x: 20 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.1, duration: 0.5 }}
                  className="flex items-center gap-5 bg-slate-900 border border-white/5 hover:border-white/10 rounded-2xl p-6 transition-all"
                >
                  <div className={`p-3 bg-gradient-to-br ${detail.color} border border-white/5 rounded-xl flex-shrink-0`}>
                    {detail.icon}
                  </div>
                  <div>
                <p className="text-slate-500 text-xs font-medium uppercase tracking-wider mb-1">{t(`contact.details.labels.${i}`)}</p>
                    {detail.href ? (
                      <a href={detail.href} className="text-white font-medium hover:text-cyan-300 transition-colors">{detail.value}</a>
                    ) : (
                      <p className="text-white font-medium">{detail.value}</p>
                    )}
                  </div>
                </motion.div>
              ))}

              <motion.div
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: 0.4, duration: 0.5 }}
                className="relative bg-gradient-to-br from-slate-900 to-slate-950 border border-cyan-500/20 rounded-2xl p-8 overflow-hidden"
              >
                <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(14,165,233,0.07)_0%,transparent_60%)]" />
                <div className="relative">
                  <h3 className="text-lg font-bold text-white mb-3">{t("contact.partnership.heading")}</h3>
                  <p className="text-slate-400 text-sm leading-relaxed mb-6">
                    {t("contact.partnership.description")}
                  </p>
                  <a href="mailto:sales@itmap.ai?subject=Partnership Enquiry">
                    <Button variant="outline" size="sm" className="border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10 bg-transparent">
                      {t("contact.partnership.button")} <ArrowRight className="ml-2 h-3.5 w-3.5" />
                    </Button>
                  </a>
                </div>
              </motion.div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-24">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <motion.div {...fadeUp}>
            <h2 className="text-4xl font-bold text-white mb-6">
              {t("cta.heading")}
            </h2>
            <p className="text-slate-400 text-lg mb-10 max-w-xl mx-auto">
              {t("cta.description")}
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link href="/register">
                <Button size="lg" className="bg-gradient-to-r from-cyan-500 to-violet-600 hover:from-cyan-400 hover:to-violet-500 text-white border-0 px-10">
                  {t("cta.getFreeAccess")} <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
              <Link href="/markets">
                <Button variant="outline" size="lg" className="border-white/10 text-slate-300 hover:text-white bg-transparent px-10">
                  {t("cta.exploreMarkets")}
                </Button>
              </Link>
            </div>
          </motion.div>
        </div>
      </section>
    </div>
  );
}
