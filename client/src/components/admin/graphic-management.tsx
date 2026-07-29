import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MarketSelector } from "@/components/admin/market-selector";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Info, Save } from "lucide-react";
import MagicQuadrant from "@/components/magic-quadrant";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Market } from "@shared/schema";

export default function GraphicManagement() {
  const [selectedMarketId, setSelectedMarketId] = useState<string>("");
  const [pendingPositions, setPendingPositions] = useState<{ [vendorId: string]: { x: number; y: number } }>({});
  const [isSaving, setIsSaving] = useState(false);
  const { toast } = useToast();

  const { data: markets } = useQuery<Market[]>({
    queryKey: ["/api/markets"],
  });

  const selectedMarket = markets?.find(m => m.id === selectedMarketId);

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

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Vendor Evaluation Graphic Editor</CardTitle>
          <CardDescription>
            Drag vendor labels to reposition them on the chart, then save.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription>
              Select a market to configure the chart. Drag vendor labels to reposition them and save.
            </AlertDescription>
          </Alert>

          <div className="space-y-2">
            <MarketSelector
              markets={markets}
              selectedMarketId={selectedMarketId}
              onMarketChange={setSelectedMarketId}
              marketPlaceholder="Choose a market to edit…"
              stripPrefix
            />
          </div>
        </CardContent>
      </Card>

      {selectedMarket && (
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
            />
          </CardContent>
        </Card>
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
