import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Mail, ArrowRight, Building2 } from "lucide-react";
import SpectioLogo from "@/components/spectio-logo";

interface ContactSalesModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function ContactSalesModal({ isOpen, onClose }: ContactSalesModalProps) {
  const { toast } = useToast();
  const [formData, setFormData] = useState({
    firstName: "",
    lastName: "",
    email: "",
    company: "",
    message: "",
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    // Build a mailto link with the form details so the user's email client opens.
    const subject = encodeURIComponent("ITMAP Vendor Access Enquiry");
    const body = encodeURIComponent(
      `Name: ${formData.firstName} ${formData.lastName}\nCompany: ${formData.company}\nEmail: ${formData.email}\n\nMessage:\n${formData.message}`
    );
    window.location.href = `mailto:sales@itmap.ai?subject=${subject}&body=${body}`;

    toast({
      title: "Message ready",
      description: "Your email client has opened with the enquiry details.",
    });

    setIsSubmitting(false);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[500px] bg-slate-900 border-white/8 text-white">
        <DialogHeader>
          <div className="flex justify-center mb-4">
            <SpectioLogo variant="dark" size="md" />
          </div>
          <div className="flex items-center justify-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-semibold mx-auto w-fit bg-violet-500/15 text-violet-300 border border-violet-400/20">
            <Building2 className="h-3 w-3" />
            Vendor Access
          </div>
          <DialogTitle className="text-center text-xl text-white">
            Contact Sales
          </DialogTitle>
        </DialogHeader>

        <div className="text-center text-sm text-slate-400 mb-4">
          Tell us about your company and the ITMAP vendor tools you're interested in.
          Our team will get back to you within one business day.
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="contact-firstName" className="text-slate-300">First Name</Label>
              <Input
                id="contact-firstName"
                placeholder="Jane"
                value={formData.firstName}
                onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                className="bg-white/5 border-white/10 text-white placeholder:text-slate-500"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="contact-lastName" className="text-slate-300">Last Name</Label>
              <Input
                id="contact-lastName"
                placeholder="Smith"
                value={formData.lastName}
                onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                className="bg-white/5 border-white/10 text-white placeholder:text-slate-500"
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="contact-email" className="text-slate-300">Work email</Label>
            <Input
              id="contact-email"
              type="email"
              placeholder="you@company.com"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              className="bg-white/5 border-white/10 text-white placeholder:text-slate-500"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="contact-company" className="text-slate-300">Company</Label>
            <Input
              id="contact-company"
              placeholder="Acme Corp"
              value={formData.company}
              onChange={(e) => setFormData({ ...formData, company: e.target.value })}
              className="bg-white/5 border-white/10 text-white placeholder:text-slate-500"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="contact-message" className="text-slate-300">Message</Label>
            <Textarea
              id="contact-message"
              placeholder="Tell us about your market and the tools you're interested in..."
              rows={4}
              value={formData.message}
              onChange={(e) => setFormData({ ...formData, message: e.target.value })}
              className="bg-white/5 border-white/10 text-white placeholder:text-slate-500 resize-none"
            />
          </div>

          <Button
            type="submit"
            className="w-full bg-gradient-to-r from-violet-500 to-cyan-500 hover:from-violet-400 hover:to-cyan-400 text-white border-0 font-semibold"
            disabled={isSubmitting}
          >
            <Mail className="mr-2 h-4 w-4" />
            {isSubmitting ? "Opening email…" : "Contact Sales"}
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
