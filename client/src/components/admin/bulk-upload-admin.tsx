import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Upload, Database, CheckCircle, XCircle, Loader2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

export function BulkUploadAdmin() {
  const [jsonData, setJsonData] = useState("");
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<{
    success: boolean;
    message: string;
    details?: any;
  } | null>(null);

  const handleUpload = async () => {
    if (!jsonData.trim()) {
      setResult({
        success: false,
        message: "Please provide JSON data to upload"
      });
      return;
    }

    try {
      setUploading(true);
      setResult(null);

      const data = JSON.parse(jsonData);
      
      // Validate data structure
      if (!data.categories || !data.features || !data.supportData) {
        throw new Error("JSON must contain categories, features, and supportData arrays");
      }

      const response = await apiRequest("/api/admin/bulk-upload-support-matrix", "POST", data);
      
      setResult({
        success: true,
        message: "Support matrix data uploaded successfully!",
        details: response
      });

      // Clear the textarea after successful upload
      setJsonData("");

    } catch (error) {
      console.error("Upload error:", error);
      setResult({
        success: false,
        message: error instanceof Error ? error.message : "Upload failed"
      });
    } finally {
      setUploading(false);
    }
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const content = e.target?.result as string;
          setJsonData(content);
        } catch (error) {
          setResult({
            success: false,
            message: "Failed to read file"
          });
        }
      };
      reader.readAsText(file);
    }
  };

  const sampleData = {
    categories: [
      {
        name: "AI-based Operations",
        displayOrder: 1
      }
    ],
    features: [
      {
        name: "Predictive analytics for failure detection",
        description: "AI-based Operations - Predictive analytics for failure detection",
        category: "AI-based Operations",
        displayOrder: 1
      }
    ],
    supportData: [
      {
        vendorProduct: "Dell PowerMax 8500",
        featureName: "Predictive analytics for failure detection",
        supportLevel: 3,
        notes: "Partial AI-driven analytics support documented"
      }
    ]
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-gray-900 mb-2">Bulk Upload Support Matrix</h3>
        <p className="text-sm text-gray-600">
          Upload support matrix data in bulk using JSON format. This will create categories, features, and support records.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5" />
              Upload Data
            </CardTitle>
            <CardDescription>
              Paste your JSON data below or upload a JSON file
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Upload JSON File
              </label>
              <input
                type="file"
                accept=".json"
                onChange={handleFileUpload}
                className="block w-full text-sm text-gray-500
                  file:mr-4 file:py-2 file:px-4
                  file:rounded-lg file:border-0
                  file:text-sm file:font-semibold
                  file:bg-blue-50 file:text-blue-700
                  hover:file:bg-blue-100"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                JSON Data
              </label>
              <Textarea
                value={jsonData}
                onChange={(e) => setJsonData(e.target.value)}
                placeholder="Paste your JSON data here..."
                className="min-h-[300px] font-mono text-sm"
              />
            </div>

            <Button 
              onClick={handleUpload} 
              disabled={uploading || !jsonData.trim()}
              className="w-full"
            >
              {uploading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Uploading...
                </>
              ) : (
                <>
                  <Database className="mr-2 h-4 w-4" />
                  Upload Support Matrix Data
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Data Format & Example</CardTitle>
            <CardDescription>
              Your JSON should follow this structure
            </CardDescription>
          </CardHeader>
          <CardContent>
            <pre className="bg-gray-50 p-4 rounded-lg text-sm overflow-x-auto">
              {JSON.stringify(sampleData, null, 2)}
            </pre>
            
            <div className="mt-4 space-y-2 text-sm text-gray-600">
              <p><strong>Support Levels:</strong></p>
              <ul className="list-disc list-inside space-y-1">
                <li>0 = No support (○)</li>
                <li>1 = Limited support (◔)</li>
                <li>2 = Partial support (◑)</li>
                <li>3 = Good support (◕)</li>
                <li>4 = Full support (●)</li>
              </ul>
            </div>
          </CardContent>
        </Card>
      </div>

      {result && (
        <Alert className={result.success ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50"}>
          <div className="flex items-center gap-2">
            {result.success ? (
              <CheckCircle className="h-4 w-4 text-green-600" />
            ) : (
              <XCircle className="h-4 w-4 text-red-600" />
            )}
            <AlertDescription className={result.success ? "text-green-800" : "text-red-800"}>
              {result.message}
              {result.details && (
                <div className="mt-2">
                  <strong>Details:</strong>
                  <ul className="list-disc list-inside mt-1">
                    {result.details.created && (
                      <>
                        <li>Categories created: {result.details.created.categories}</li>
                        <li>Features created: {result.details.created.features}</li>
                        <li>Support records updated: {result.details.created.supportRecords}</li>
                      </>
                    )}
                  </ul>
                </div>
              )}
            </AlertDescription>
          </div>
        </Alert>
      )}
    </div>
  );
}