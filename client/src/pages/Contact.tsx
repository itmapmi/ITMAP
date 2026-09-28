import { useState } from "react";
import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { useSeo } from "@/hooks/use-seo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Mail, MapPin, Clock, ArrowRight, MessageSquare } from "lucide-react";
import { apiRequestJson } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";

const fadeUp = {
  initial: { opacity: 0, y: 30 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-80px" },
  transition: { duration: 0.6, ease: [0.25, 0.25, 0, 1] as any },
};

const CONTACT_DETAILS = [
  {
    icon: <Mail className="h-5 w-5 text-cyan-400" />,
    labelKey: "details.email",
    value: "sales@itmap.ai",
    href: "mailto:sales@itmap.ai",
    color: "from-cyan-500/15 to-cyan-400/5",
  },
  {
    icon: <MapPin className="h-5 w-5 text-cyan-400" />,
    labelKey: "details.office",
    value: "Jewellery & Gemplex 3, DMCC, Dubai, UAE",
    href: null,
    color: "from-cyan-500/15 to-cyan-400/5",
  },
  {
    icon: <Clock className="h-5 w-5 text-violet-400" />,
    labelKey: "details.businessHours",
    value: "Mon – Fri: 9:00 AM – 6:00 PM GST",
    href: null,
    color: "from-violet-500/15 to-violet-400/5",
  },
];

export default function Contact() {
  const { t } = useTranslation("contact");
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    firstName: "",
    lastName: "",
    email: "",
    company: "",
    subject: "",
    message: "",
    website: "",
  });

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsSubmitting(true);
    try {
      await apiRequestJson("/api/contact-messages", "POST", {
        ...formData,
        source: "contact_page",
      });
      toast({
        title: t("form.success.title"),
        description: t("form.success.description"),
      });
      setFormData({
        firstName: "",
        lastName: "",
        email: "",
        company: "",
        subject: "",
        message: "",
        website: "",
      });
    } catch (error) {
      toast({
        title: t("form.error.title"),
        description: error instanceof Error
          ? error.message.replace(/^\d+:\s*/, "").replace(/^{"error":"|"}$/g, "")
          : t("form.error.description"),
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  useSeo({
    title: t("seo.title"),
    description: t("seo.description"),
    path: "/contact",
  });
  return (
    <div className="min-h-screen bg-[#1e2130] text-white">
      {/* Hero */}
      <section className="relative py-24 overflow-hidden border-b border-white/5">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_30%_50%,rgba(14,165,233,0.09)_0%,transparent_60%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_70%_30%,rgba(124,58,237,0.07)_0%,transparent_60%)]" />
        <div className="relative max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <div className="inline-flex items-center gap-2 text-cyan-400 text-sm font-medium mb-6">
              <MessageSquare className="h-4 w-4" /> {t("hero.eyebrow")}
            </div>
            <h1 className="text-5xl sm:text-6xl font-bold leading-tight mb-6">
              {t("hero.titleLine1")}
              <br />
              <span className="bg-gradient-to-r from-cyan-400 to-violet-400 bg-clip-text text-transparent">{t("hero.titleLine2")}</span>
            </h1>
            <p className="text-xl text-slate-400 max-w-2xl leading-relaxed">
              {t("hero.subtitle")}
            </p>
          </motion.div>
        </div>
      </section>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
          {/* Form */}
          <motion.div {...fadeUp}>
            <div className="bg-slate-900 border border-white/5 rounded-2xl p-8">
              <h2 className="text-2xl font-bold text-white mb-2">{t("form.title")}</h2>
              <p className="text-slate-500 text-sm mb-8">{t("form.responseTime")}</p>

              <form onSubmit={handleSubmit} className="space-y-5">
                <div className="absolute -left-[10000px] h-px w-px overflow-hidden" aria-hidden="true">
                  <Label htmlFor="contact-page-website">{t("form.fields.website")}</Label>
                  <Input
                    id="contact-page-website"
                    name="website"
                    tabIndex={-1}
                    autoComplete="off"
                    value={formData.website}
                    onChange={(e) => setFormData({ ...formData, website: e.target.value })}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="firstName" className="text-slate-400 text-sm">{t("form.fields.firstName")}</Label>
                    <Input
                      id="firstName"
                      placeholder={t("form.placeholders.firstName")}
                      value={formData.firstName}
                      onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                      autoComplete="given-name"
                      className="bg-slate-800 border-white/10 text-white placeholder:text-slate-600 focus:border-cyan-500/50 focus:ring-cyan-500/20 rounded-xl"
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="lastName" className="text-slate-400 text-sm">{t("form.fields.lastName")}</Label>
                    <Input
                      id="lastName"
                      placeholder={t("form.placeholders.lastName")}
                      value={formData.lastName}
                      onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                      autoComplete="family-name"
                      className="bg-slate-800 border-white/10 text-white placeholder:text-slate-600 focus:border-cyan-500/50 focus:ring-cyan-500/20 rounded-xl"
                      required
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="email" className="text-slate-400 text-sm">{t("form.fields.email")}</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder={t("form.placeholders.email")}
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    autoComplete="email"
                    className="bg-slate-800 border-white/10 text-white placeholder:text-slate-600 focus:border-cyan-500/50 focus:ring-cyan-500/20 rounded-xl"
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="company" className="text-slate-400 text-sm">{t("form.fields.company")}</Label>
                  <Input
                    id="company"
                    placeholder={t("form.placeholders.company")}
                    value={formData.company}
                    onChange={(e) => setFormData({ ...formData, company: e.target.value })}
                    autoComplete="organization"
                    className="bg-slate-800 border-white/10 text-white placeholder:text-slate-600 focus:border-cyan-500/50 focus:ring-cyan-500/20 rounded-xl"
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="subject" className="text-slate-400 text-sm">{t("form.fields.subject")}</Label>
                  <Input
                    id="subject"
                    placeholder={t("form.placeholders.subject")}
                    value={formData.subject}
                    onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
                    className="bg-slate-800 border-white/10 text-white placeholder:text-slate-600 focus:border-cyan-500/50 focus:ring-cyan-500/20 rounded-xl"
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="message" className="text-slate-400 text-sm">{t("form.fields.message")}</Label>
                  <Textarea
                    id="message"
                    placeholder={t("form.placeholders.message")}
                    rows={5}
                    value={formData.message}
                    onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                    className="bg-slate-800 border-white/10 text-white placeholder:text-slate-600 focus:border-cyan-500/50 focus:ring-cyan-500/20 rounded-xl resize-none"
                    required
                  />
                </div>

                <Button
                  type="submit"
                  className="w-full bg-gradient-to-r from-cyan-500 to-violet-600 hover:from-cyan-400 hover:to-violet-500 text-white border-0 py-6 text-base font-semibold"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? t("form.sending") : t("form.sendMessage")} <ArrowRight className="ml-2 h-4 w-4" />
                </Button>

                <p className="text-xs text-slate-600 text-center">
                  {t("form.privacyPrefix")} <Link href="/privacy-policy" className="text-cyan-500 hover:text-cyan-400">{t("form.privacyPolicy")}</Link>.
                </p>
              </form>
            </div>
          </motion.div>

          {/* Details */}
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
                  <p className="text-slate-500 text-xs font-medium uppercase tracking-wider mb-1">{t(detail.labelKey)}</p>
                  {detail.href ? (
                    <a
                      href={detail.href}
                      className="text-white font-medium hover:text-cyan-300 transition-colors"
                    >
                      {detail.value}
                    </a>
                  ) : (
                    <p className="text-white font-medium">{detail.value}</p>
                  )}
                </div>
              </motion.div>
            ))}

            {/* Additional card */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.4, duration: 0.5 }}
              className="relative bg-gradient-to-br from-slate-900 to-slate-950 border border-cyan-500/20 rounded-2xl p-8 overflow-hidden"
            >
              <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(14,165,233,0.07)_0%,transparent_60%)]" />
              <div className="relative">
                <h3 className="text-lg font-bold text-white mb-3">{t("partnership.title")}</h3>
                <p className="text-slate-400 text-sm leading-relaxed mb-6">
                  {t("partnership.description")}
                </p>
                <a href="mailto:support@itmap.ai?subject=Partnership Enquiry">
                  <Button variant="outline" size="sm" className="border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10 bg-transparent">
                    {t("partnership.button")} <ArrowRight className="ml-2 h-3.5 w-3.5" />
                  </Button>
                </a>
              </div>
            </motion.div>
          </div>
        </div>
      </div>
    </div>
  );
}
