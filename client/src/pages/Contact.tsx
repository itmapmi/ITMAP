import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Mail, Phone, MapPin, Clock, ArrowRight, MessageSquare } from "lucide-react";

const fadeUp = {
  initial: { opacity: 0, y: 30 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-80px" },
  transition: { duration: 0.6, ease: [0.25, 0.25, 0, 1] as any },
};

const CONTACT_DETAILS = [
  {
    icon: <Mail className="h-5 w-5 text-cyan-400" />,
    label: "Email",
    value: "priyanka@itmap.com",
    href: "mailto:priyanka@itmap.com",
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

export default function Contact() {
  return (
    <div className="min-h-screen bg-[#0a0f1e] text-white">
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
              <MessageSquare className="h-4 w-4" /> Get in Touch
            </div>
            <h1 className="text-5xl sm:text-6xl font-bold leading-tight mb-6">
              Let's talk
              <br />
              <span className="bg-gradient-to-r from-cyan-400 to-violet-400 bg-clip-text text-transparent">intelligence</span>
            </h1>
            <p className="text-xl text-slate-400 max-w-2xl leading-relaxed">
              Whether you're exploring the platform, asking about licensing, or want to discuss your organisation's vendor selection challenges — we'd love to hear from you.
            </p>
          </motion.div>
        </div>
      </section>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
          {/* Form */}
          <motion.div {...fadeUp}>
            <div className="bg-slate-900 border border-white/5 rounded-2xl p-8">
              <h2 className="text-2xl font-bold text-white mb-2">Send us a message</h2>
              <p className="text-slate-500 text-sm mb-8">We typically respond within 1 business day.</p>

              <div className="space-y-5">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="firstName" className="text-slate-400 text-sm">First Name</Label>
                    <Input
                      id="firstName"
                      placeholder="Jane"
                      className="bg-slate-800 border-white/10 text-white placeholder:text-slate-600 focus:border-cyan-500/50 focus:ring-cyan-500/20 rounded-xl"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="lastName" className="text-slate-400 text-sm">Last Name</Label>
                    <Input
                      id="lastName"
                      placeholder="Smith"
                      className="bg-slate-800 border-white/10 text-white placeholder:text-slate-600 focus:border-cyan-500/50 focus:ring-cyan-500/20 rounded-xl"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="email" className="text-slate-400 text-sm">Work Email</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="jane.smith@company.com"
                    className="bg-slate-800 border-white/10 text-white placeholder:text-slate-600 focus:border-cyan-500/50 focus:ring-cyan-500/20 rounded-xl"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="company" className="text-slate-400 text-sm">Company</Label>
                  <Input
                    id="company"
                    placeholder="Acme Corp"
                    className="bg-slate-800 border-white/10 text-white placeholder:text-slate-600 focus:border-cyan-500/50 focus:ring-cyan-500/20 rounded-xl"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="subject" className="text-slate-400 text-sm">Subject</Label>
                  <Input
                    id="subject"
                    placeholder="Platform enquiry / Licensing / Research"
                    className="bg-slate-800 border-white/10 text-white placeholder:text-slate-600 focus:border-cyan-500/50 focus:ring-cyan-500/20 rounded-xl"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="message" className="text-slate-400 text-sm">Message</Label>
                  <Textarea
                    id="message"
                    placeholder="Tell us about your technology intelligence needs, or how we can help..."
                    rows={5}
                    className="bg-slate-800 border-white/10 text-white placeholder:text-slate-600 focus:border-cyan-500/50 focus:ring-cyan-500/20 rounded-xl resize-none"
                  />
                </div>

                <Button
                  className="w-full bg-gradient-to-r from-cyan-500 to-violet-600 hover:from-cyan-400 hover:to-violet-500 text-white border-0 py-6 text-base font-semibold"
                  onClick={() => window.location.href = "mailto:priyanka@itmap.com"}
                >
                  Send Message <ArrowRight className="ml-2 h-4 w-4" />
                </Button>

                <p className="text-xs text-slate-600 text-center">
                  By sending this message you agree to our privacy policy.
                </p>
              </div>
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
                  <p className="text-slate-500 text-xs font-medium uppercase tracking-wider mb-1">{detail.label}</p>
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
                <h3 className="text-lg font-bold text-white mb-3">Exploring a partnership?</h3>
                <p className="text-slate-400 text-sm leading-relaxed mb-6">
                  We work with research firms, IT consultancies and procurement platforms. If you're interested in integrating spectio.ai intelligence into your workflow, let's talk.
                </p>
                <a href="mailto:priyanka@itmap.com?subject=Partnership Enquiry">
                  <Button variant="outline" size="sm" className="border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10 bg-transparent">
                    Explore Partnership <ArrowRight className="ml-2 h-3.5 w-3.5" />
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
