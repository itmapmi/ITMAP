import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Info } from "lucide-react";
import MagicQuadrant from "@/components/magic-quadrant";
import type { Market } from "@shared/schema";

export default function GraphicManagement() {
  const [selectedMarketId, setSelectedMarketId] = useState<string>("");

  const { data: markets, isLoading: marketsLoading } = useQuery<Market[]>({
    queryKey: ["/api/markets"],
  });

  const selectedMarket = markets?.find(m => m.id === selectedMarketId);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Vendor Evaluation Graphic Editor</CardTitle>
          <CardDescription>
            Customize vendor label positions for the Vendor Evaluation visualization
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription>
              Select a market below to edit vendor label positions. Drag vendor labels to reposition them on the chart. 
              Changes are saved automatically and will be visible to all users viewing this market.
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
                  <SelectItem value="loading" disabled>
                    Loading markets...
                  </SelectItem>
                ) : markets && markets.length > 0 ? (
                  markets.map(market => (
                    <SelectItem key={market.id} value={market.id}>
                      {market.name}
                    </SelectItem>
                  ))
                ) : (
                  <SelectItem value="no-markets" disabled>
                    No markets available
                  </SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {selectedMarket && (
        <Card>
          <CardHeader>
            <CardTitle>{selectedMarket.name} - Label Positioning</CardTitle>
            <CardDescription>
              Drag vendor labels to your preferred positions. The chart shows the actual vendor positions 
              based on their scores, just like end users see it.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <MagicQuadrant 
              marketId={selectedMarket.id} 
              marketName={selectedMarket.name}
              enableDrag={true}
            />
          </CardContent>
        </Card>
      )}

      {!selectedMarketId && (
        <Card>
          <CardContent className="py-12 text-center text-gray-500">
            Select a market above to begin editing label positions
          </CardContent>
        </Card>
      )}
    </div>
  );
}
