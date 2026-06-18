import { useState } from "react";
import { motion } from "framer-motion";
import { Link } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { User, Mail, Save, ChevronLeft, Shield, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

export default function MyProfile() {
  const { user } = useAuth();
  const { toast } = useToast();

  const [firstName, setFirstName] = useState(user?.firstName ?? "");
  const [lastName, setLastName]   = useState(user?.lastName ?? "");
  const [email, setEmail]         = useState(user?.email ?? "");

  const save = useMutation({
    mutationFn: () =>
      apiRequest("/api/me/profile", "PATCH", { firstName, lastName, email }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      toast({ title: "Profile updated" });
    },
    onError: (err: any) =>
      toast({ title: "Update failed", description: err.message, variant: "destructive" }),
  });

  const initials = [user?.firstName, user?.lastName]
    .filter(Boolean)
    .map(n => n![0])
    .join("")
    .toUpperCase() || "U";

  const memberSince = user?.createdAt
    ? new Date(user.createdAt).toLocaleDateString("en-GB", { month: "long", year: "numeric" })
    : null;

  return (
    <div className="min-h-screen theme-bg">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-10">

        {/* Back */}
        <Link href="/markets">
          <span className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-300 cursor-pointer mb-8">
            <ChevronLeft className="h-4 w-4" /> Back
          </span>
        </Link>

        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="flex items-center gap-5 mb-10"
        >
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-cyan-500 to-violet-600 flex items-center justify-center text-2xl font-bold text-white flex-shrink-0">
            {initials}
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">
              {user?.firstName} {user?.lastName}
            </h1>
            <div className="flex items-center gap-3 mt-1">
              <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${
                user?.role === "admin"
                  ? "bg-amber-400/15 text-amber-400"
                  : "bg-cyan-400/10 text-cyan-400"
              }`}>
                <Shield className="h-3 w-3" />
                {user?.role === "admin" ? "Admin" : "Member"}
              </span>
              {memberSince && (
                <span className="flex items-center gap-1 text-xs text-slate-500">
                  <Calendar className="h-3 w-3" /> Member since {memberSince}
                </span>
              )}
            </div>
          </div>
        </motion.div>

        {/* Form card */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.1 }}
          className="bg-slate-900 border border-white/5 rounded-2xl p-8"
        >
          <div className="flex items-center gap-2 mb-6">
            <User className="h-5 w-5 text-cyan-400" />
            <h2 className="text-lg font-semibold text-white">Personal Information</h2>
          </div>

          <div className="space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="firstName" className="text-slate-400 text-sm">First Name</Label>
                <Input
                  id="firstName"
                  value={firstName}
                  onChange={e => setFirstName(e.target.value)}
                  className="bg-slate-800 border-white/10 text-white placeholder:text-slate-600 focus:border-cyan-500/50 rounded-xl"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lastName" className="text-slate-400 text-sm">Last Name</Label>
                <Input
                  id="lastName"
                  value={lastName}
                  onChange={e => setLastName(e.target.value)}
                  className="bg-slate-800 border-white/10 text-white placeholder:text-slate-600 focus:border-cyan-500/50 rounded-xl"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-slate-400 text-sm">Email Address</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="bg-slate-800 border-white/10 text-white placeholder:text-slate-600 focus:border-cyan-500/50 rounded-xl pl-10"
                />
              </div>
            </div>

            <div className="pt-2">
              <Button
                onClick={() => save.mutate()}
                disabled={save.isPending}
                className="bg-gradient-to-r from-cyan-500 to-violet-600 hover:from-cyan-400 hover:to-violet-500 text-white border-0"
              >
                <Save className="h-4 w-4 mr-2" />
                {save.isPending ? "Saving…" : "Save Changes"}
              </Button>
            </div>
          </div>
        </motion.div>

        {/* Quick links */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.2 }}
          className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3"
        >
          {[
            { href: "/me/settings", label: "Security & API Keys", desc: "Change password and manage LLM keys" },
            { href: "/me/reports",  label: "My Reports",           desc: "View your saved research reports" },
          ].map(({ href, label, desc }) => (
            <Link key={href} href={href}>
              <div className="bg-slate-900 border border-white/5 hover:border-white/10 rounded-2xl p-5 cursor-pointer transition-all group">
                <p className="text-white font-medium group-hover:text-cyan-300 transition-colors">{label}</p>
                <p className="text-slate-500 text-sm mt-1">{desc}</p>
              </div>
            </Link>
          ))}
        </motion.div>

      </div>
    </div>
  );
}
