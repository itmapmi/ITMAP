import { motion } from "framer-motion";
import { Link } from "wouter";
import { useSeo } from "@/hooks/use-seo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Shield, Zap, Eye, Users, Globe2, ArrowRight, CheckCircle2, Database, Brain, Mail, Phone, MapPin, Clock, MessageSquare } from "lucide-react";

const fadeUp = {
  initial: { opacity: 0, y: 30 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-80px" },
  transition: { duration: 0.6, ease: [0.25, 0.25, 0, 1] as any },
};

const VALUES = [
  {
    icon: <Shield className="h-6 w-6 text-cyan-400" />,
    title: "Radical Independence",
    desc: "We accept zero vendor payments, sponsorships or paid placements. Every score is determined purely by data and methodology.",
  },
  {
    icon: <Eye className="h-6 w-6 text-violet-400" />,
    title: "Total Transparency",
    desc: "Every vendor evaluation exposes its sources, criteria and weights. Nothing is hidden. Everything is verifiable.",
  },
  {
    icon: <Zap className="h-6 w-6 text-cyan-400" />,
    title: "Real-Time Precision",
    desc: "Market intelligence that reflects today — not last quarter. Our AI processes news, releases and signals continuously.",
  },
  {
    icon: <Brain className="h-6 w-6 text-violet-400" />,
    title: "AI-Native Methodology",
    desc: "Built from the ground up around large language models — not retrofitted. AI is at the core of every analysis we produce.",
  },
];

const TEAM_VALUES = [
  "40+ years of combined enterprise IT experience",
  "Former analysts from leading research firms",
  "Deep operational expertise in infrastructure, cloud and data protection",
  "Technologists who've lived the vendor selection challenge firsthand",
];

const CONTACT_DETAILS = [
  {
    icon: <Mail className="h-5 w-5 text-cyan-400" />,
    label: "Email",
    value: "priyanka@spectio.ai",
    href: "mailto:priyanka@spectio.ai",
    color: "from-cyan-500/15 to-cyan-400/5",
  },
  {
    icon: <Phone className="h-5 w-5 text-violet-400" />,
    label: "Phone",
    value: "+971-569221785",
    href: "tel:+971569221785",
    color: "from-violet-500/15 to-violet-400/5",
  },
  {
    icon: <MapPin className="h-5 w-5 text-cyan-400" />,
    label: "Office",
    value: "Jewellery & Gemplex 3, DMCC, Dubai, UAE",
    href: null,
    color: "from-cyan-500/15 to-cyan-400/5",
  },
  {
    icon: <Clock className="h-5 w-5 text-violet-400" />,
    label: "Business Hours",
    value: "Mon – Fri: 9:00 AM – 6:00 PM GST",
    href: null,
    color: "from-violet-500/15 to-violet-400/5",
  },
];

export default function About() {
  useSeo({
    title: "About spectio.ai — Independent AI-Powered Vendor Intelligence",
    description: "Learn about spectio.ai's mission to deliver unbiased, real-time enterprise IT vendor intelligence — faster and more transparent than traditional analyst firms.",
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
              <Globe2 className="h-4 w-4" /> About spectio.ai
            </div>
            <h1 className="text-5xl sm:text-6xl lg:text-7xl font-bold leading-[1.08] mb-8">
              Built to cut through
              <br />
              <span className="bg-gradient-to-r from-cyan-400 to-violet-400 bg-clip-text text-transparent">the analyst noise</span>
            </h1>
            <p className="text-xl text-slate-400 max-w-2xl mx-auto leading-relaxed">
              spectio.ai was created by enterprise IT practitioners who were tired of paying for research that had already been paid for by the vendors they were supposed to be evaluating.
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
                <div className="h-px w-8 bg-cyan-400" /> OUR MISSION
              </div>
              <h2 className="text-4xl font-bold text-white mb-6 leading-tight">
                Giving enterprise buyers the intelligence they deserve
              </h2>
              <p className="text-slate-400 text-lg leading-relaxed mb-6">
                For too long, enterprise technology research has been a product sold to vendors first, and to buyers second. Gartner Magic Quadrants, Forrester Waves, IDC MarketScapes — all funded, in part, by the very companies they rank.
              </p>
              <p className="text-slate-400 text-lg leading-relaxed mb-8">
                spectio.ai is different. We believe procurement teams, CIOs and IT architects deserve intelligence that is provably unbiased — built on public data, scored by AI, and never for sale to vendors.
              </p>
              <Link href="/platform">
                <Button className="bg-gradient-to-r from-cyan-500 to-violet-600 hover:from-cyan-400 hover:to-violet-500 text-white border-0">
                  See How We Analyze <ArrowRight className="ml-2 h-4 w-4" />
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
                { label: "Independence", pct: 100, color: "from-cyan-500 to-cyan-400", note: "Zero vendor funding" },
                { label: "Data Currency", pct: 97, color: "from-cyan-500 to-violet-500", note: "Updated daily" },
                { label: "Source Transparency", pct: 100, color: "from-violet-500 to-violet-400", note: "All sources disclosed" },
                { label: "Coverage Breadth", pct: 85, color: "from-cyan-400 to-violet-500", note: "6+ markets, growing" },
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
              <div className="h-px w-8 bg-violet-400" /> OUR VALUES
            </div>
            <h2 className="text-4xl sm:text-5xl font-bold text-white">
              Principles we won't compromise
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
                <h3 className="text-xl font-bold text-white mb-3">{v.title}</h3>
                <p className="text-slate-400 leading-relaxed">{v.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Team */}
      <section className="py-24 border-b border-white/5">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
            <motion.div {...fadeUp}>
              <div className="inline-flex items-center gap-2 text-cyan-400 text-sm font-medium mb-6">
                <div className="h-px w-8 bg-cyan-400" /> THE TEAM
              </div>
              <h2 className="text-4xl font-bold text-white mb-6 leading-tight">
                Practitioners building for practitioners
              </h2>
              <p className="text-slate-400 text-lg leading-relaxed mb-8">
                spectio.ai is built by a team of enterprise IT veterans who've led technology selection projects from both sides of the table — as IT leaders making decisions, and as technologists building the platforms being evaluated.
              </p>
              <ul className="space-y-3">
                {TEAM_VALUES.map((t) => (
                  <li key={t} className="flex items-start gap-3 text-slate-300">
                    <CheckCircle2 className="h-5 w-5 text-cyan-400 flex-shrink-0 mt-0.5" />
                    <span>{t}</span>
                  </li>
                ))}
              </ul>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6 }}
              className="relative bg-gradient-to-br from-slate-900 to-slate-950 border border-white/10 rounded-3xl p-10 overflow-hidden"
            >
              <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,rgba(14,165,233,0.08)_0%,transparent_60%)]" />
              <div className="relative">
                <div className="flex items-center gap-3 mb-8">
                  <div className="flex -space-x-2">
                    {["P", "A", "S", "R"].map((l, i) => (
                      <div key={i} className="w-10 h-10 rounded-full bg-gradient-to-br from-cyan-500/30 to-violet-500/30 border-2 border-slate-900 flex items-center justify-center text-sm font-bold text-cyan-400">
                        {l}
                      </div>
                    ))}
                  </div>
                  <div>
                    <p className="text-white font-semibold">Core Team</p>
                    <p className="text-slate-500 text-sm">Dubai · Global</p>
                  </div>
                </div>

                <blockquote className="text-slate-300 text-lg leading-relaxed italic mb-6">
                  "We were tired of paying six figures for research that told us what vendors had already paid to say. So we built the alternative."
                </blockquote>

                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-gradient-to-br from-cyan-500 to-violet-600 flex items-center justify-center text-sm font-bold text-white">P</div>
                  <div>
                    <p className="text-white font-medium text-sm">Priyanka</p>
                    <p className="text-slate-500 text-xs">Founder, spectio.ai</p>
                  </div>
                </div>

                <div className="mt-8 pt-8 border-t border-white/5 flex items-center gap-4">
                  <div className="flex items-center gap-2 text-slate-500 text-sm">
                    <Database className="h-4 w-4 text-cyan-400" />
                    Dubai, UAE (DMCC)
                  </div>
                  <div className="flex items-center gap-2 text-slate-500 text-sm">
                    <Users className="h-4 w-4 text-violet-400" />
                    +971-569221785
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* Contact */}
      <section className="py-24 border-b border-white/5">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div {...fadeUp} className="text-center mb-16">
            <div className="inline-flex items-center gap-2 text-cyan-400 text-sm font-medium mb-4">
              <MessageSquare className="h-4 w-4" /> GET IN TOUCH
            </div>
            <h2 className="text-4xl sm:text-5xl font-bold text-white mb-4">
              Let's talk intelligence
            </h2>
            <p className="text-slate-400 max-w-xl mx-auto">
              Whether you're exploring the platform, asking about licensing, or want to discuss your organisation's vendor selection challenges — we'd love to hear from you.
            </p>
          </motion.div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
            {/* Form */}
            <motion.div {...fadeUp}>
              <div className="bg-slate-900 border border-white/5 rounded-2xl p-8">
                <h3 className="text-2xl font-bold text-white mb-2">Send us a message</h3>
                <p className="text-slate-500 text-sm mb-8">We typically respond within 1 business day.</p>
                <div className="space-y-5">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="firstName" className="text-slate-400 text-sm">First Name</Label>
                      <Input id="firstName" placeholder="Jane" className="bg-slate-800 border-white/10 text-white placeholder:text-slate-600 focus:border-cyan-500/50 focus:ring-cyan-500/20 rounded-xl" />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="lastName" className="text-slate-400 text-sm">Last Name</Label>
                      <Input id="lastName" placeholder="Smith" className="bg-slate-800 border-white/10 text-white placeholder:text-slate-600 focus:border-cyan-500/50 focus:ring-cyan-500/20 rounded-xl" />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="email" className="text-slate-400 text-sm">Work Email</Label>
                    <Input id="email" type="email" placeholder="jane.smith@company.com" className="bg-slate-800 border-white/10 text-white placeholder:text-slate-600 focus:border-cyan-500/50 focus:ring-cyan-500/20 rounded-xl" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="company" className="text-slate-400 text-sm">Company</Label>
                    <Input id="company" placeholder="Acme Corp" className="bg-slate-800 border-white/10 text-white placeholder:text-slate-600 focus:border-cyan-500/50 focus:ring-cyan-500/20 rounded-xl" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="subject" className="text-slate-400 text-sm">Subject</Label>
                    <Input id="subject" placeholder="Platform enquiry / Licensing / Research" className="bg-slate-800 border-white/10 text-white placeholder:text-slate-600 focus:border-cyan-500/50 focus:ring-cyan-500/20 rounded-xl" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="message" className="text-slate-400 text-sm">Message</Label>
                    <Textarea id="message" placeholder="Tell us about your technology intelligence needs, or how we can help..." rows={5} className="bg-slate-800 border-white/10 text-white placeholder:text-slate-600 focus:border-cyan-500/50 focus:ring-cyan-500/20 rounded-xl resize-none" />
                  </div>
                  <Button
                    className="w-full bg-gradient-to-r from-cyan-500 to-violet-600 hover:from-cyan-400 hover:to-violet-500 text-white border-0 py-6 text-base font-semibold"
                    onClick={() => window.location.href = "mailto:priyanka@spectio.ai"}
                  >
                    Send Message <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                  <p className="text-xs text-slate-600 text-center">By sending this message you agree to our privacy policy.</p>
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
                    <p className="text-slate-500 text-xs font-medium uppercase tracking-wider mb-1">{detail.label}</p>
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
                  <h3 className="text-lg font-bold text-white mb-3">Exploring a partnership?</h3>
                  <p className="text-slate-400 text-sm leading-relaxed mb-6">
                    We work with research firms, IT consultancies and procurement platforms. If you're interested in integrating spectio.ai intelligence into your workflow, let's talk.
                  </p>
                  <a href="mailto:priyanka@spectio.ai?subject=Partnership Enquiry">
                    <Button variant="outline" size="sm" className="border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10 bg-transparent">
                      Explore Partnership <ArrowRight className="ml-2 h-3.5 w-3.5" />
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
              Ready to see differently?
            </h2>
            <p className="text-slate-400 text-lg mb-10 max-w-xl mx-auto">
              Join the growing number of enterprise IT leaders choosing intelligence without an agenda.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link href="/register">
                <Button size="lg" className="bg-gradient-to-r from-cyan-500 to-violet-600 hover:from-cyan-400 hover:to-violet-500 text-white border-0 px-10">
                  Get Free Access <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
              <Link href="/markets">
                <Button variant="outline" size="lg" className="border-white/10 text-slate-300 hover:text-white bg-transparent px-10">
                  Explore Markets
                </Button>
              </Link>
            </div>
          </motion.div>
        </div>
      </section>
    </div>
  );
}
