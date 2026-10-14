import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

const fields = [
  ["firstName", "First name"], ["lastName", "Last name"],
  ["companyName", "Company name"], ["designation", "Designation"],
  ["companyEmail", "Work email"], ["industry", "Industry (optional)"],
] as const;
type Key = typeof fields[number][0];
type Profile = { id: string; email: string | null; companyEmailVerified: boolean } & Record<Key, string | null>;

export function EditLeadProfileDialog({ user }: { user: Profile }) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<Key, string>>({
    firstName: "", lastName: "", companyName: "", designation: "", companyEmail: "", industry: "",
  });
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const save = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/lead-gen/leads/${user.id}/profile`, {
        method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Could not save profile");
      return body;
    },
    onSuccess: (body) => {
      queryClient.setQueryData(["/api/lead-gen/leads", user.id], (previous: any) =>
        previous ? { ...previous, user: body.user } : previous);
      queryClient.invalidateQueries({ predicate: (query) => {
        const key = String(query.queryKey[0] ?? "");
        return key.startsWith("/api/lead-gen") || key.startsWith("/api/admin/users") ||
          key === "/api/auth/user" || key === "/api/me/company-profile";
      } });
      setOpen(false);
      toast({ title: "Profile saved", description: "Sign-in email and access permissions were not changed." });
    },
    onError: (err: Error) => setError(err.message),
  });
  const startEdit = () => {
    setValues({
      firstName: user.firstName ?? "", lastName: user.lastName ?? "",
      companyName: user.companyName ?? "", designation: user.designation ?? "",
      companyEmail: user.companyEmail ?? "", industry: user.industry ?? "",
    });
    setError(null);
    setOpen(true);
  };
  const changedEmail = values.companyEmail.trim().toLowerCase() !== (user.companyEmail ?? "").trim().toLowerCase();
  return (
    <>
      <Button variant="outline" size="sm" onClick={startEdit} data-testid="button-edit-lead-profile"
        className="border-white/10 bg-slate-900/60 text-slate-200 hover:text-white">
        <Pencil className="mr-1.5 h-3.5 w-3.5" /> Edit profile
      </Button>
      <Dialog open={open} onOpenChange={(next) => { if (!save.isPending) setOpen(next); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto border-white/10 bg-slate-950 text-white">
          <DialogHeader>
            <DialogTitle>Edit user profile</DialogTitle>
            <DialogDescription className="text-slate-400">
              Confirm this is the correct account before copying LinkedIn form details. Names alone are not a reliable match.
            </DialogDescription>
          </DialogHeader>
          <p className="break-all text-sm text-slate-400">Sign-in email (unchanged): {user.email ?? "Not provided by LinkedIn"}</p>
          <form onSubmit={(event) => { event.preventDefault(); setError(null); save.mutate(); }} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {fields.map(([key, label]) => (
                <div key={key} className="space-y-1.5">
                  <Label htmlFor={`lead-edit-${key}`}>{label}</Label>
                  <Input id={`lead-edit-${key}`} type={key === "companyEmail" ? "email" : "text"}
                    value={values[key]} maxLength={key === "companyEmail" ? 254 : 120}
                    disabled={save.isPending} data-testid={`input-lead-${key}`}
                    onChange={(event) => setValues((previous) => ({ ...previous, [key]: event.target.value }))}
                    className="border-white/10 bg-slate-900 text-white" />
                </div>
              ))}
            </div>
            <p className="text-xs text-slate-400">
              Saving does not verify a work email or send an email.
              {changedEmail && user.companyEmailVerified && " Changing or clearing this work email will remove its verified status."}
            </p>
            {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" disabled={save.isPending} onClick={() => setOpen(false)}
                className="border-white/10 bg-slate-900">Cancel</Button>
              <Button type="submit" disabled={save.isPending} data-testid="button-save-lead-profile">
                {save.isPending ? "Saving…" : "Save profile"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
