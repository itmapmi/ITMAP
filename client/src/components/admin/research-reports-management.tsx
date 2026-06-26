import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ObjectUploader } from "@/components/ObjectUploader";
import { Skeleton } from "@/components/ui/skeleton";
import { FileText, Download, Trash2, Upload, Calendar, FileIcon, Edit, Plus } from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import ReportEditor from "@/components/admin/report-editor";
import type { Market, ResearchReport } from "@shared/schema";
import type { UploadResult } from "@uppy/core";

export default function ResearchReportsManagement() {
  const [selectedMarketId, setSelectedMarketId] = useState<string>("");
  const [showEditor, setShowEditor] = useState(false);
  const [editingReport, setEditingReport] = useState<ResearchReport | undefined>(undefined);
  const [reportTitle, setReportTitle] = useState<string>("");
  const [reportDate, setReportDate] = useState<string>("");
  const { toast } = useToast();

  // Fetch markets for selection
  const { data: markets, isLoading: marketsLoading } = useQuery<Market[]>({
    queryKey: ["/api/markets"],
  });

  // Fetch research reports for selected market
  const { data: reports, isLoading: reportsLoading } = useQuery<ResearchReport[]>({
    queryKey: ["/api/markets", selectedMarketId, "research-reports"],
    enabled: !!selectedMarketId,
  });

  // Delete report mutation
  const deleteReportMutation = useMutation({
    mutationFn: async (reportId: string) => {
      const response = await fetch(`/api/research-reports/${reportId}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        throw new Error("Failed to delete report");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/markets", selectedMarketId, "research-reports"] });
      toast({
        title: "Success",
        description: "Research report deleted successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to delete research report",
        variant: "destructive",
      });
    },
  });

  const handleGetUploadParameters = async () => {
    const response = await fetch("/api/objects/upload", {
      method: "POST",
    });
    const data = await response.json();
    return {
      method: "PUT" as const,
      url: data.uploadURL,
    };
  };

  const handleUploadComplete = async (result: UploadResult<Record<string, unknown>, Record<string, unknown>>) => {
    if (!selectedMarketId) {
      toast({
        title: "Error",
        description: "Please select a market first",
        variant: "destructive",
      });
      return;
    }

    if (!result.successful || result.successful.length === 0) {
      toast({
        title: "Error",
        description: "No files were uploaded successfully",
        variant: "destructive",
      });
      return;
    }

    const uploadedFile = result.successful[0];
    
    try {
      const response = await fetch("/api/research-reports", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          marketId: selectedMarketId,
          title: reportTitle.trim() || uploadedFile.name,
          description: `Research report for ${markets?.find(m => m.id === selectedMarketId)?.name || "market"}`,
          fileUrl: uploadedFile.uploadURL,
          fileSize: uploadedFile.size,
          mimeType: uploadedFile.type,
          ...(reportDate ? { publishedAt: new Date(`${reportDate}T12:00:00`).toISOString() } : {}),
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to save report");
      }

      queryClient.invalidateQueries({ queryKey: ["/api/markets", selectedMarketId, "research-reports"] });
      setReportTitle("");
      setReportDate("");
      toast({
        title: "Success",
        description: "Research report uploaded successfully",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to save research report",
        variant: "destructive",
      });
    }
  };

  const getFileIcon = (mimeType: string | null) => {
    if (!mimeType) return "📄";
    if (mimeType.includes("pdf")) return "📄";
    if (mimeType.includes("word") || mimeType.includes("document")) return "📝";
    if (mimeType.includes("presentation") || mimeType.includes("powerpoint")) return "📊";
    if (mimeType.includes("sheet") || mimeType.includes("excel")) return "📈";
    return "📄";
  };

  const formatFileSize = (bytes: number) => {
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    if (bytes === 0) return '0 Bytes';
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
  };

  const selectedMarket = markets?.find(m => m.id === selectedMarketId);

  const handleCreateNew = () => {
    setEditingReport(undefined);
    setShowEditor(true);
  };

  const handleEditReport = (report: ResearchReport) => {
    setEditingReport(report);
    setShowEditor(true);
  };

  const handleEditorClose = () => {
    setShowEditor(false);
    setEditingReport(undefined);
  };

  const handleEditorSave = () => {
    setShowEditor(false);
    setEditingReport(undefined);
    queryClient.invalidateQueries({ queryKey: ["/api/markets", selectedMarketId, "research-reports"] });
  };

  if (showEditor) {
    return (
      <ReportEditor
        markets={markets || []}
        existingReport={editingReport}
        onClose={handleEditorClose}
        onSave={handleEditorSave}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Research Reports</h2>
        <p className="text-muted-foreground">
          Upload and manage research reports for each market
        </p>
      </div>

      {/* Market Selection */}
      <Card>
        <CardHeader>
          <CardTitle>Select Market</CardTitle>
          <CardDescription>
            Choose a market to upload research reports for
          </CardDescription>
        </CardHeader>
        <CardContent>
          {marketsLoading ? (
            <Skeleton className="h-10 w-full" />
          ) : (
            <Select value={selectedMarketId} onValueChange={setSelectedMarketId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select a market..." />
              </SelectTrigger>
              <SelectContent>
                {markets?.map((market) => (
                  <SelectItem key={market.id} value={market.id}>
                    {market.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </CardContent>
      </Card>

      {/* Create and Upload Section */}
      {selectedMarketId && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Create HTML Report */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Plus className="h-5 w-5" />
                Create HTML Report
              </CardTitle>
              <CardDescription>
                Create a new research report with rich HTML content for online viewing
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button 
                onClick={handleCreateNew}
                className="w-full"
                variant="outline"
              >
                <div className="flex items-center justify-center gap-2 py-4">
                  <FileText className="h-6 w-6" />
                  <span className="text-lg">Create New Report</span>
                </div>
              </Button>
            </CardContent>
          </Card>

          {/* Upload File Report */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Upload className="h-5 w-5" />
                Upload File Report
              </CardTitle>
              <CardDescription>
                Upload research reports for <strong>{selectedMarket?.name}</strong>. 
                Supported formats: PDF, Excel, ZIP, and Video (max 500MB)
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="report-title">Report Name</Label>
                <Input
                  id="report-title"
                  placeholder="e.g. Q2 2026 Market Outlook"
                  value={reportTitle}
                  onChange={(e) => setReportTitle(e.target.value)}
                  data-testid="input-report-title"
                />
                <p className="text-xs text-muted-foreground">
                  Shown as the report title on the public market page. If left blank, the file name is used.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="report-date">Report Date</Label>
                <Input
                  id="report-date"
                  type="date"
                  value={reportDate}
                  onChange={(e) => setReportDate(e.target.value)}
                  data-testid="input-report-date"
                />
                <p className="text-xs text-muted-foreground">
                  Date displayed with the report. Defaults to today if left blank.
                </p>
              </div>
              <ObjectUploader
                maxNumberOfFiles={1}
                maxFileSize={500 * 1024 * 1024} // 500MB
                onGetUploadParameters={handleGetUploadParameters}
                onComplete={handleUploadComplete}
                buttonClassName="w-full"
              >
                <div className="flex items-center justify-center gap-2 py-4">
                  <FileText className="h-6 w-6" />
                  <span className="text-lg">Upload File Report</span>
                </div>
              </ObjectUploader>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Reports List */}
      {selectedMarketId && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Research Reports for {selectedMarket?.name}
            </CardTitle>
            <CardDescription>
              Manage uploaded research reports
            </CardDescription>
          </CardHeader>
          <CardContent>
            {reportsLoading ? (
              <div className="space-y-4">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="flex items-center justify-between p-4 border rounded-lg">
                    <div className="space-y-2">
                      <Skeleton className="h-4 w-48" />
                      <Skeleton className="h-3 w-32" />
                    </div>
                    <Skeleton className="h-8 w-20" />
                  </div>
                ))}
              </div>
            ) : reports && reports.length > 0 ? (
              <div className="space-y-4">
                {reports.map((report) => (
                  <div
                    key={report.id}
                    className="flex items-center justify-between p-4 border rounded-lg hover:bg-gray-50"
                  >
                    <div className="flex items-start gap-4">
                      <div className="text-2xl">
                        {getFileIcon(report.mimeType)}
                      </div>
                      <div>
                        <h4 className="font-medium">{report.title}</h4>
                        {report.description && (
                          <p className="text-sm text-gray-600 mt-1">
                            {report.description}
                          </p>
                        )}
                        <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
                          <span className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            {report.uploadedAt ? format(new Date(report.uploadedAt), "MMM d, yyyy") : 
                             report.createdAt ? format(new Date(report.createdAt), "MMM d, yyyy") : "Unknown date"}
                          </span>
                          {report.fileSize && (
                            <span className="flex items-center gap-1">
                              <FileIcon className="h-3 w-3" />
                              {formatFileSize(report.fileSize)}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {report.htmlContent && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => window.open(`/report/${report.id}`, "_blank")}
                          className="flex items-center gap-2"
                        >
                          <FileText className="h-4 w-4" />
                          View Online
                        </Button>
                      )}
                      
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleEditReport(report)}
                        className="flex items-center gap-2"
                      >
                        <Edit className="h-4 w-4" />
                        Edit
                      </Button>
                      
                      {report.fileUrl && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => report.fileUrl && window.open(report.fileUrl, "_blank")}
                          className="flex items-center gap-2"
                        >
                          <Download className="h-4 w-4" />
                          Download
                        </Button>
                      )}
                      
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => deleteReportMutation.mutate(report.id)}
                        disabled={deleteReportMutation.isPending}
                        className="flex items-center gap-2 text-red-600 hover:text-red-700"
                      >
                        <Trash2 className="h-4 w-4" />
                        Delete
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-12">
                <FileText className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                <p className="text-lg font-medium text-gray-900 mb-2">No Research Reports</p>
                <p className="text-gray-500">
                  No research reports have been uploaded for this market yet.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {!selectedMarketId && (
        <Card>
          <CardContent className="text-center py-12">
            <FileText className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <p className="text-lg font-medium text-gray-900 mb-2">Select a Market</p>
            <p className="text-gray-500">
              Choose a market from the dropdown above to view and upload research reports.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}