import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Download, Upload, FileSpreadsheet, AlertCircle, CheckCircle2 } from "lucide-react";
import type { Market } from "@shared/schema";

export default function ImportExportAdmin() {
  const [selectedMarketId, setSelectedMarketId] = useState<string>("");
  const [uploading, setUploading] = useState(false);
  const [exportingState, setExportingState] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

  const { data: markets, isLoading: marketsLoading } = useQuery<Market[]>({
    queryKey: ["/api/markets"],
  });

  const handleExport = async () => {
    if (!selectedMarketId) {
      setMessage({ type: 'error', text: 'Please select a market first' });
      return;
    }

    try {
      setExportingState(true);
      setMessage(null);

      const response = await fetch(`/api/markets/${selectedMarketId}/export`, {
        method: 'GET',
        credentials: 'include',
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Export failed');
      }

      // Get the filename from Content-Disposition header or use a default
      const contentDisposition = response.headers.get('Content-Disposition');
      const filenameMatch = contentDisposition?.match(/filename="?(.+)"?/);
      const filename = filenameMatch ? filenameMatch[1] : 'market_export.xlsx';

      // Download the file
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      setMessage({ type: 'success', text: 'Data exported successfully!' });
    } catch (error) {
      console.error('Export error:', error);
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Failed to export data' });
    } finally {
      setExportingState(false);
    }
  };

  const handleImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!selectedMarketId) {
      setMessage({ type: 'error', text: 'Please select a market first' });
      event.target.value = '';
      return;
    }

    try {
      setUploading(true);
      setMessage(null);

      // Convert file to base64
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const base64Data = reader.result as string;
          const base64 = base64Data.split(',')[1];

          const response = await fetch(`/api/markets/${selectedMarketId}/import`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            credentials: 'include',
            body: JSON.stringify({ file: base64 }),
          });

          const data = await response.json();

          if (!response.ok) {
            throw new Error(data.error || 'Import failed');
          }

          setMessage({
            type: 'success',
            text: `Import successful! ${data.stats.vendors} vendors, ${data.stats.scores} scores, ${data.stats.supportLevels} support levels imported.`
          });
        } catch (error) {
          console.error('Import error:', error);
          setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Failed to import data' });
        } finally {
          setUploading(false);
          event.target.value = '';
        }
      };

      reader.onerror = () => {
        setMessage({ type: 'error', text: 'Failed to read file' });
        setUploading(false);
        event.target.value = '';
      };

      reader.readAsDataURL(file);
    } catch (error) {
      console.error('File handling error:', error);
      setMessage({ type: 'error', text: 'Failed to process file' });
      setUploading(false);
      event.target.value = '';
    }
  };

  if (marketsLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  const selectedMarket = markets?.find(m => m.id === selectedMarketId);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold mb-2">Import/Export Market Data</h3>
        <p className="text-sm text-gray-600">
          Export market data to Excel or import data from a pre-filled Excel template. 
          The Excel file contains three sheets: Vendor Evaluation, Product Evaluation, and ISV Ecosystem.
        </p>
      </div>

      {message && (
        <Alert 
          className={message.type === 'success' ? 'border-green-500 bg-green-50' : 'border-red-500 bg-red-50'}
          data-testid={`alert-${message.type}`}
        >
          {message.type === 'success' ? (
            <CheckCircle2 className="h-4 w-4 text-green-600" />
          ) : (
            <AlertCircle className="h-4 w-4 text-red-600" />
          )}
          <AlertDescription className={message.type === 'success' ? 'text-green-800' : 'text-red-800'}>
            {message.text}
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Select Market</CardTitle>
          <CardDescription>Choose the market/technology for which you want to export or import data</CardDescription>
        </CardHeader>
        <CardContent>
          <Select value={selectedMarketId} onValueChange={setSelectedMarketId}>
            <SelectTrigger data-testid="select-market" className="w-full">
              <SelectValue placeholder="Select a market..." />
            </SelectTrigger>
            <SelectContent>
              {markets?.map((market) => (
                <SelectItem 
                  key={market.id} 
                  value={market.id}
                  data-testid={`select-market-option-${market.id}`}
                >
                  {market.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Download className="h-5 w-5" />
              Export Data
            </CardTitle>
            <CardDescription>
              Download market data as an Excel file with three sheets
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="text-sm text-gray-600 space-y-2">
              <p><strong>Sheet 1: Vendor Evaluation</strong></p>
              <p className="text-xs pl-4">Vendors with their execution and viability scores</p>
              <p><strong>Sheet 2: Product Evaluation</strong></p>
              <p className="text-xs pl-4">Vendors with product feature support levels</p>
              <p><strong>Sheet 3: ISV Ecosystem</strong></p>
              <p className="text-xs pl-4">Vendors with ecosystem integration support levels</p>
            </div>
            <Button
              onClick={handleExport}
              disabled={!selectedMarketId || exportingState}
              className="w-full"
              data-testid="button-export"
            >
              {exportingState ? (
                <>Processing...</>
              ) : (
                <>
                  <FileSpreadsheet className="mr-2 h-4 w-4" />
                  Export to Excel
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5" />
              Import Data
            </CardTitle>
            <CardDescription>
              Upload a pre-filled Excel file to populate market data
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="text-sm text-gray-600 space-y-2">
              <p className="font-semibold">Upload Requirements:</p>
              <ul className="text-xs pl-4 list-disc space-y-1">
                <li>Excel file (.xlsx format)</li>
                <li>Must contain all three required sheets</li>
                <li>Vendor names must match existing vendors or will be created</li>
                <li>Support levels should be 0-100 for features</li>
                <li>Scores should be 0-10 for criteria</li>
              </ul>
            </div>
            <div>
              <input
                type="file"
                id="import-file"
                accept=".xlsx,.xls"
                onChange={handleImport}
                disabled={!selectedMarketId || uploading}
                className="hidden"
                data-testid="input-import-file"
              />
              <Button
                onClick={() => document.getElementById('import-file')?.click()}
                disabled={!selectedMarketId || uploading}
                className="w-full"
                variant="outline"
                data-testid="button-import"
              >
                {uploading ? (
                  <>Uploading...</>
                ) : (
                  <>
                    <Upload className="mr-2 h-4 w-4" />
                    Choose File to Import
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {selectedMarket && (
        <Alert data-testid="alert-selected-market">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            <strong>Selected Market:</strong> {selectedMarket.name}
            <br />
            All import/export operations will apply to this market.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
