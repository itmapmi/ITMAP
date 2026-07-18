import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Info, Save, Palette } from "lucide-react";
import MagicQuadrant, { QuadrantSettings } from "@/components/magic-quadrant";
import { apiRequestJson, apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Market } from "@shared/schema";
import { cn } from "@/lib/utils";

const TOP_LABEL_OPTIONS = ["ITMAP Leaders", "ITMAP Top 5", "ITMAP Top 3", "Market Leaders"] as const;

const THEME_OPTIONS: { value: string; label: string; topSwatch: string; bottomSwatch: string }[] = [
  { value: "dark-blue-gold", label: "Navy & Gold", topSwatch: "#1e40af", bottomSwatch: "#f59e0b" },
  { value: "emerald-coral", label: "Emerald & Coral", topSwatch: "#059669", bottomSwatch: "#f97316" },
  { value: "violet-rose", label: "Violet & Rose", topSwatch: "#7c3aed", bottomSwatch: "#f43f5e" },
];

export default function GraphicManagement() {
  const [selectedMarketId, setSelectedMarketId] = useState<string>("");
  const [pendingPositions, setPendingPositions] = useState<{ [vendorId: string]: { x: number; y: number } }>({});
  const [isSaving, setIsSaving] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [pendingSettings, setPendingSettings] = useState<QuadrantSettings>({
    dividerY: 50,
    topLabel: "ITMAP Leaders",
    colorTheme: "dark-blue-gold",
  });
  const { toast } = useToast();

  const { data: markets, isLoading: marketsLoading } = useQuery<Market[]>({
    queryKey: ["/api/markets"],
  });

  const selectedMarket = markets?.find(m => m.id === selectedMarketId);

  useEffect(() => {
    if (!selectedMarket) return;
    setPendingSettings({
      dividerY: selectedMarket.quadrantDividerY != null ? Number(selectedMarket.quadrantDividerY) : 50,
      topLabel: selectedMarket.quadrantTopLabel ?? "ITMAP Leaders",
      colorTheme: selectedMarket.quadrantColorTheme ?? "dark-blue-gold",
    });
  }, [selectedMarket?.id]);

  const handleLabelPositionChange = (vendorId: string, x: number, y: number) => {
    setPendingPositions(prev => ({ ...prev, [vendorId]: { x, y } }));
  };

  const handleSavePositions = async () => {
    if (!selectedMarketId || Object.keys(pendingPositions).length === 0) {
      toast({ title: "No changes to save", description: "Move some vendor labels before saving.", variant: "default" });
      return;
    }
    setIsSaving(true);
    try {
      await Promise.all(
        Object.entries(pendingPositions).map(([vendorId, pos]) =>
          apiRequest(`/api/label-positions`, "POST", { vendorId, marketId: selectedMarketId, labelX: pos.x, labelY: pos.y })
        )
      );
      await queryClient.invalidateQueries({ queryKey: ["/api/markets", selectedMarketId, "label-positions"] });
      setPendingPositions({});
      toast({ title: "Positions Saved", description: `Saved ${Object.keys(pendingPositions).length} label position(s).` });
    } catch {
      toast({ title: "Error", description: "Failed to save label positions.", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveSettings = async () => {
    if (!selectedMarketId) return;
    setIsSavingSettings(true);
    try {
      await apiRequestJson(`/api/admin/markets/${selectedMarketId}/quadrant-settings`, "PATCH", {
        quadrantDividerY: pendingSettings.dividerY,
        quadrantTopLabel: pendingSettings.topLabel,
        quadrantColorTheme: pendingSettings.colorTheme,
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/markets"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/markets", selectedMarketId] }),
      ]);
      toast({ title: "Settings Saved", description: "Chart settings updated for this market." });
    } catch {
      toast({ title: "Error", description: "Failed to save chart settings.", variant: "destructive" });
    } finally {
      setIsSavingSettings(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Vendor Evaluation Graphic Editor</CardTitle>
          <CardDescription>
            Customize the two-band chart appearance and label positions for each market.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription>
              Select a market to configure the chart. Adjust the band divider, top-tier label, and colour theme, then save settings.
              You can also drag vendor labels to reposition them and save those separately.
            </AlertDescription>
          </Alert>

          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700">Select Market</label>
            <Select value={selectedMarketId} onValueChange={setSelectedMarketId}>
              <SelectTrigger data-testid="select-market">
                <SelectValue placeholder="Choose a market to edit..." />
              </SelectTrigger>
              <SelectContent>
                {marketsLoading ? (
                  <SelectItem value="loading" disabled>Loading markets...</SelectItem>
                ) : markets && markets.length > 0 ? (
                  markets.map(market => (
                    <SelectItem key={market.id} value={market.id}>
                      {market.name.replace(/^ITMAP for /i, "")}
                    </SelectItem>
                  ))
                ) : (
                  <SelectItem value="no-markets" disabled>No markets available</SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {selectedMarket && (
        <>
          {/* ── Chart Settings ───────────────────────────────────────────── */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Palette className="h-5 w-5 text-indigo-500" />
                Chart Settings — {selectedMarket.name.replace(/^ITMAP for /i, "")}
              </CardTitle>
              <CardDescription>
                Configure the two-band layout. Changes are previewed live in the editor below.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Top-tier label */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">Top-band label</label>
                <Select
                  value={pendingSettings.topLabel}
                  onValueChange={v => setPendingSettings(s => ({ ...s, topLabel: v }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TOP_LABEL_OPTIONS.map(opt => (
                      <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Divider Y slider */}
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <label className="text-sm font-medium text-gray-700">Divider position</label>
                  <span className="text-sm text-gray-500 tabular-nums">
                    {pendingSettings.dividerY}% viability
                  </span>
                </div>
                <Slider
                  min={0}
                  max={100}
                  step={1}
                  value={[pendingSettings.dividerY]}
                  onValueChange={([v]) => setPendingSettings(s => ({ ...s, dividerY: v }))}
                  className="w-full"
                />
                <div className="flex justify-between text-xs text-gray-400">
                  <span>Narrow top band</span>
                  <span>Wide top band</span>
                </div>
              </div>

              {/* Colour theme swatches */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">Colour theme</label>
                <div className="flex flex-wrap gap-3">
                  {THEME_OPTIONS.map(t => (
                    <button
                      key={t.value}
                      onClick={() => setPendingSettings(s => ({ ...s, colorTheme: t.value }))}
                      className={cn(
                        "flex items-center gap-2 px-3 py-2 rounded-lg border-2 text-sm font-medium transition-all",
                        pendingSettings.colorTheme === t.value
                          ? "border-indigo-500 bg-indigo-50"
                          : "border-gray-200 bg-white hover:border-gray-300"
                      )}
                    >
                      <span className="flex gap-1">
                        <span
                          className="inline-block w-4 h-4 rounded-sm"
                          style={{ background: t.topSwatch }}
                        />
                        <span
                          className="inline-block w-4 h-4 rounded-sm"
                          style={{ background: t.bottomSwatch }}
                        />
                      </span>
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex justify-end">
                <Button onClick={handleSaveSettings} disabled={isSavingSettings}>
                  <Save className="h-4 w-4 mr-2" />
                  {isSavingSettings ? "Saving…" : "Save Chart Settings"}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* ── Label Positioning ─────────────────────────────────────────── */}
          <Card>
            <CardHeader>
              <CardTitle>{selectedMarket.name.replace(/^ITMAP for /i, "")} — Label Positioning</CardTitle>
              <CardDescription>
                Drag vendor labels to your preferred positions, then click "Save Positions" to persist changes.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex justify-between items-center">
                <div className="text-sm text-gray-600">
                  {Object.keys(pendingPositions).length > 0 ? (
                    <span className="font-medium text-blue-600">
                      {Object.keys(pendingPositions).length} unsaved change(s)
                    </span>
                  ) : (
                    <span>No pending changes</span>
                  )}
                </div>
                <Button
                  onClick={handleSavePositions}
                  disabled={isSaving || Object.keys(pendingPositions).length === 0}
                  data-testid="button-save-positions"
                >
                  <Save className="h-4 w-4 mr-2" />
                  {isSaving ? "Saving..." : "Save Positions"}
                </Button>
              </div>
              <MagicQuadrant
                marketId={selectedMarket.id}
                marketName={selectedMarket.name}
                enableDrag={true}
                onLabelPositionChange={handleLabelPositionChange}
                quadrantSettings={pendingSettings}
              />
            </CardContent>
          </Card>
        </>
      )}

      {!selectedMarketId && (
        <Card>
          <CardContent className="py-12 text-center text-gray-500">
            Select a market above to begin editing
          </CardContent>
        </Card>
      )}
    </div>
  );
}
