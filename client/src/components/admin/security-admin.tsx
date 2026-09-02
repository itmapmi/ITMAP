import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ShieldCheck, KeyRound } from "lucide-react";

export function SecurityAdmin() {
  const { user, setPassword, isSettingPassword } = useAuth();
  const { toast } = useToast();

  const hasPassword = !!(user as any)?.hasPassword;

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setSuccess(false);

    if (newPassword.length < 8) {
      setFormError("Password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setFormError("Passwords do not match.");
      return;
    }

    try {
      await setPassword({
        currentPassword: hasPassword ? currentPassword : undefined,
        newPassword,
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setSuccess(true);
      toast({ title: hasPassword ? "Password updated" : "Password set" });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not update password.");
    }
  };

  return (
    <div className="space-y-6 max-w-xl">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" />
            Admin Login Password
          </CardTitle>
          <CardDescription>
            {hasPassword
              ? "Your admin account requires this password to sign in, in addition to your email."
              : "Your admin account currently signs in with just your email, like every other account. " +
                "Set a password below to require it on every future admin login — this closes the gap " +
                "where anyone who learns your email address could sign in as you."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {formError && (
              <Alert variant="destructive">
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            )}
            {success && (
              <Alert>
                <AlertDescription>
                  {hasPassword ? "Password updated." : "Password set — you'll need it next time you sign in."}
                </AlertDescription>
              </Alert>
            )}

            {hasPassword && (
              <div className="space-y-1.5">
                <Label htmlFor="current-password">Current password</Label>
                <Input
                  id="current-password"
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                />
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="new-password">{hasPassword ? "New password" : "Password"}</Label>
              <Input
                id="new-password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
                minLength={8}
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="confirm-password">Confirm {hasPassword ? "new " : ""}password</Label>
              <Input
                id="confirm-password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                minLength={8}
                required
              />
            </div>

            <Button type="submit" disabled={isSettingPassword}>
              <KeyRound className="h-4 w-4 mr-1.5" />
              {isSettingPassword ? "Saving…" : hasPassword ? "Update password" : "Set password"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
