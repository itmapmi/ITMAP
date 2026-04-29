import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Key,
  Plus,
  Copy,
  Trash2,
  CheckCircle2,
  XCircle,
  Globe,
  ShieldCheck,
  Clock,
} from "lucide-react";
import type { Market } from "@shared/schema";

interface ApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  allowedMarketIds: string[] | null;
  isActive: boolean;
  lastUsedAt: string | null;
  createdAt: string;
  rawKey?: string;
}

export function ApiKeysAdmin() {
  const { toast } = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [selectedMarkets, setSelectedMarkets] = useState<string[]>([]);
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [copiedKeyId, setCopiedKeyId] = useState<string | null>(null);

  const { data: apiKeys = [], isLoading } = useQuery<ApiKey[]>({
    queryKey: ["/api/admin/api-keys"],
  });

  const { data: markets = [] } = useQuery<Market[]>({
    queryKey: ["/api/markets"],
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("/api/admin/api-keys", "POST", {
        name: newKeyName.trim(),
        allowedMarketIds: selectedMarkets.length > 0 ? selectedMarkets : null,
      });
      return res.json() as Promise<ApiKey>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/api-keys"] });
      setRevealedKey(data.rawKey ?? null);
      setNewKeyName("");
      setSelectedMarkets([]);
      setCreateOpen(false);
      toast({ title: "API key created" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to create key", description: err.message, variant: "destructive" });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const res = await apiRequest(`/api/admin/api-keys/${id}`, "PATCH", { isActive });
      return res.json() as Promise<ApiKey>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/api-keys"] });
    },
    onError: (err: Error) => {
      toast({ title: "Update failed", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest(`/api/admin/api-keys/${id}`, "DELETE");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/api-keys"] });
      toast({ title: "API key deleted" });
    },
    onError: (err: Error) => {
      toast({ title: "Delete failed", description: err.message, variant: "destructive" });
    },
  });

  const copyToClipboard = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKeyId(id);
      setTimeout(() => setCopiedKeyId(null), 2000);
      toast({ title: "Copied to clipboard" });
    } catch {
      toast({ title: "Copy failed", variant: "destructive" });
    }
  };

  const formatRelative = (date: string | null | undefined) => {
    if (!date) return "Never";
    const d = new Date(date);
    const diff = Date.now() - d.getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return "Just now";
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  };

  const marketName = (id: string) => markets.find((m) => m.id === id)?.name ?? id;

  const activeCount = apiKeys.filter((k) => k.isActive).length;

  return (
    <div className="space-y-6">
      {/* ── Header stats ─────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="rounded-lg border bg-card p-3">
          <p className="text-xs text-muted-foreground">Total keys</p>
          <p className="text-2xl font-semibold mt-0.5">{apiKeys.length}</p>
        </div>
        <div className="rounded-lg border bg-card p-3">
          <p className="text-xs text-muted-foreground">Active</p>
          <p className="text-2xl font-semibold mt-0.5 text-green-600">{activeCount}</p>
        </div>
        <div className="rounded-lg border bg-card p-3">
          <p className="text-xs text-muted-foreground">Revoked</p>
          <p className="text-2xl font-semibold mt-0.5">{apiKeys.length - activeCount}</p>
        </div>
      </div>

      {/* ── API reference card ───────────────────────────────── */}
      <Card className="border-blue-100 bg-blue-50/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-blue-600" />
            Partner API Reference
          </CardTitle>
        </CardHeader>
        <CardContent className="text-xs space-y-2 text-muted-foreground">
          <p>Partners authenticate by passing their key as a <code className="bg-white border rounded px-1 py-0.5">Bearer</code> token or <code className="bg-white border rounded px-1 py-0.5">X-Api-Key</code> header.</p>
          <div className="grid sm:grid-cols-3 gap-2 pt-1">
            <div className="bg-white rounded border p-2">
              <p className="font-medium text-foreground mb-0.5">List markets</p>
              <code className="break-all">GET /api/external/v1/markets</code>
            </div>
            <div className="bg-white rounded border p-2">
              <p className="font-medium text-foreground mb-0.5">Chat</p>
              <code className="break-all">POST /api/external/v1/chat</code>
              <p className="mt-1 text-[10px]">Body: market_id, message, session_id?</p>
            </div>
            <div className="bg-white rounded border p-2">
              <p className="font-medium text-foreground mb-0.5">Session history</p>
              <code className="break-all">GET /api/external/v1/sessions/:id</code>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Keys table ───────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Key className="h-4 w-4" />
                API Keys
              </CardTitle>
              <CardDescription>
                Each partner company gets one key. Keys are hashed and cannot be recovered after creation.
              </CardDescription>
            </div>
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4 mr-1.5" />
              New Key
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-10 text-sm text-muted-foreground">Loading…</div>
          ) : apiKeys.length === 0 ? (
            <div className="text-center py-12 text-sm text-muted-foreground">
              <Key className="h-8 w-8 mx-auto mb-3 opacity-30" />
              <p>No API keys yet.</p>
              <p className="mt-1">Create one for each partner company that needs access.</p>
            </div>
          ) : (
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Partner / Name</TableHead>
                    <TableHead className="w-36">Key prefix</TableHead>
                    <TableHead>Markets</TableHead>
                    <TableHead className="w-24">Last used</TableHead>
                    <TableHead className="w-20">Status</TableHead>
                    <TableHead className="w-20 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {apiKeys.map((key) => (
                    <TableRow key={key.id}>
                      <TableCell className="font-medium">{key.name}</TableCell>
                      <TableCell>
                        <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
                          {key.keyPrefix}…
                        </code>
                      </TableCell>
                      <TableCell>
                        {!key.allowedMarketIds || key.allowedMarketIds.length === 0 ? (
                          <span className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Globe className="h-3 w-3" />
                            All markets
                          </span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {key.allowedMarketIds.map((mid) => (
                              <Badge key={mid} variant="secondary" className="text-xs">
                                {marketName(mid)}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          {formatRelative(key.lastUsedAt)}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Switch
                          checked={key.isActive}
                          disabled={toggleMutation.isPending}
                          onCheckedChange={(checked) =>
                            toggleMutation.mutate({ id: key.id, isActive: checked })
                          }
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                              <Trash2 className="h-3.5 w-3.5 text-destructive" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete API Key</AlertDialogTitle>
                              <AlertDialogDescription>
                                This will permanently revoke <strong>{key.name}</strong>'s access.
                                Any requests using this key will immediately start returning 401 errors.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                onClick={() => deleteMutation.mutate(key.id)}
                              >
                                Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Create key dialog ────────────────────────────────── */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Create API Key</DialogTitle>
            <DialogDescription>
              The full key is shown only once after creation — copy it immediately and share it securely with the partner.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="key-name">Partner / key name</Label>
              <Input
                id="key-name"
                placeholder="e.g. Acme Corp Slack Bot"
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>
                Market access
                <span className="ml-1.5 text-xs text-muted-foreground font-normal">
                  (leave all unselected for full access)
                </span>
              </Label>
              <div className="border rounded-lg divide-y max-h-52 overflow-y-auto">
                {markets.map((market) => (
                  <label
                    key={market.id}
                    className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-muted/50"
                  >
                    <input
                      type="checkbox"
                      className="rounded"
                      checked={selectedMarkets.includes(market.id)}
                      onChange={(e) => {
                        setSelectedMarkets((prev) =>
                          e.target.checked
                            ? [...prev, market.id]
                            : prev.filter((id) => id !== market.id)
                        );
                      }}
                    />
                    <span className="text-sm">{market.name}</span>
                  </label>
                ))}
              </div>
              {selectedMarkets.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  {selectedMarkets.length} market{selectedMarkets.length !== 1 ? "s" : ""} selected
                </p>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!newKeyName.trim() || createMutation.isPending}
              onClick={() => createMutation.mutate()}
            >
              {createMutation.isPending ? "Creating…" : "Create Key"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Revealed key dialog ──────────────────────────────── */}
      <Dialog open={!!revealedKey} onOpenChange={() => setRevealedKey(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-600" />
              API Key Created
            </DialogTitle>
            <DialogDescription>
              Copy this key now — it will never be shown again. Store it securely before closing.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div className="bg-muted rounded-lg p-3 font-mono text-sm break-all border">
              {revealedKey}
            </div>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => copyToClipboard(revealedKey!, "revealed")}
            >
              {copiedKeyId === "revealed" ? (
                <>
                  <CheckCircle2 className="h-4 w-4 mr-2 text-green-600" />
                  Copied!
                </>
              ) : (
                <>
                  <Copy className="h-4 w-4 mr-2" />
                  Copy to clipboard
                </>
              )}
            </Button>
          </div>

          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 space-y-1">
            <p className="font-medium">Share with your partner securely:</p>
            <p>Use a password manager, encrypted message, or your company's secret vault. Never paste it in Slack or email.</p>
          </div>

          <DialogFooter>
            <Button onClick={() => setRevealedKey(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
