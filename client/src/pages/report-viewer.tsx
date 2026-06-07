import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRoute } from "wouter";
import { track, trackDwell } from "@/lib/track";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Download, Calendar, ArrowLeft, FileText } from "lucide-react";
import { format } from "date-fns";
import type { ResearchReport } from "@shared/schema";

export default function ReportViewer() {
  const [match, params] = useRoute("/report/:reportId");
  const reportId = params?.reportId;

  const { data: report, isLoading, error } = useQuery<ResearchReport>({
    queryKey: ["/api/research-reports", reportId],
    enabled: !!reportId,
  });

  // Track market research intent when the user opens a report.
  useEffect(() => {
    if (!report) return;
    track("market_viewed", { marketId: report.marketId, metadata: { context: "report_viewer", reportId: report.id, reportType: report.reportType } });
    const endDwell = trackDwell({ marketId: report.marketId, metadata: { reportId: report.id } });
    return endDwell;
  }, [report?.id]);

  const getReportTypeColor = (type: string | null) => {
    if (!type) return 'bg-gray-100 text-gray-800';
    switch (type.toLowerCase()) {
      case 'magic-quadrant': return 'bg-blue-100 text-blue-800';
      case 'market-analysis': return 'bg-green-100 text-green-800';
      case 'vendor-spotlight': return 'bg-purple-100 text-purple-800';
      case 'trend-report': return 'bg-orange-100 text-orange-800';
      case 'competitive-analysis': return 'bg-red-100 text-red-800';
      case 'technology-overview': return 'bg-indigo-100 text-indigo-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const handleDownload = () => {
    if (report?.fileUrl) {
      const link = document.createElement('a');
      link.href = report.fileUrl;
      link.download = `${report.title}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  const handleGoBack = () => {
    window.close();
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 py-8">
        <div className="max-w-4xl mx-auto px-4">
          <Card>
            <CardHeader className="space-y-4">
              <Skeleton className="h-8 w-3/4" />
              <Skeleton className="h-4 w-full" />
              <div className="flex gap-2">
                <Skeleton className="h-6 w-20" />
                <Skeleton className="h-6 w-24" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {[...Array(5)].map((_, i) => (
                  <Skeleton key={i} className="h-4 w-full" />
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="min-h-screen bg-gray-50 py-8">
        <div className="max-w-4xl mx-auto px-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-red-600">
                <FileText className="h-6 w-6" />
                Report Not Found
              </CardTitle>
              <CardDescription>
                The requested research report could not be found or you don't have permission to view it.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button onClick={handleGoBack} className="flex items-center gap-2">
                <ArrowLeft className="h-4 w-4" />
                Go Back
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header with report info */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleGoBack}
                className="flex items-center gap-2"
              >
                <ArrowLeft className="h-4 w-4" />
                Close
              </Button>
              <div className="h-6 w-px bg-gray-300" />
              <FileText className="h-5 w-5 text-gray-600" />
              <h1 className="text-lg font-semibold text-gray-900 truncate">
                {report.title}
              </h1>
            </div>
            
            <div className="flex items-center gap-3">
              {report.reportType && (
                <Badge 
                  variant="secondary" 
                  className={`${getReportTypeColor(report.reportType)} border-0`}
                >
                  {report.reportType}
                </Badge>
              )}
              
              {report.fileUrl && (
                <Button
                  onClick={handleDownload}
                  variant="outline"
                  size="sm"
                  className="flex items-center gap-2"
                >
                  <Download className="h-4 w-4" />
                  Download
                </Button>
              )}
            </div>
          </div>
          
          {/* Report metadata */}
          <div className="flex items-center gap-4 mt-3 text-sm text-gray-600">
            {report.publishedAt && (
              <div className="flex items-center gap-1">
                <Calendar className="h-4 w-4" />
                Published {format(new Date(report.publishedAt), 'MMMM d, yyyy')}
              </div>
            )}
            {report.description && (
              <span className="hidden md:block">•</span>
            )}
            {report.description && (
              <span className="hidden md:block truncate">
                {report.description}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Report content */}
      <div className="max-w-4xl mx-auto px-4 py-8">
        <Card>
          <CardContent className="p-8">
            {report.htmlContent ? (
              <div 
                className="prose prose-lg max-w-none
                  prose-headings:text-gray-900 prose-headings:font-bold
                  prose-p:text-gray-700 prose-p:leading-relaxed
                  prose-a:text-blue-600 prose-a:no-underline hover:prose-a:underline
                  prose-strong:text-gray-900 prose-strong:font-semibold
                  prose-ul:text-gray-700 prose-ol:text-gray-700
                  prose-li:text-gray-700 prose-li:my-1
                  prose-blockquote:border-l-blue-500 prose-blockquote:bg-blue-50 prose-blockquote:py-2 prose-blockquote:px-4
                  prose-code:bg-gray-100 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-sm
                  prose-pre:bg-gray-900 prose-pre:text-gray-100
                  prose-img:rounded-lg prose-img:shadow-md
                  prose-table:border-collapse prose-table:border prose-table:border-gray-300
                  prose-th:border prose-th:border-gray-300 prose-th:bg-gray-50 prose-th:p-2
                  prose-td:border prose-td:border-gray-300 prose-td:p-2"
                dangerouslySetInnerHTML={{ __html: report.htmlContent }}
              />
            ) : (
              <div className="text-center py-12">
                <FileText className="mx-auto h-12 w-12 text-gray-400 mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">No Content Available</h3>
                <p className="text-gray-500">
                  This report doesn't have online content available. 
                  {report.fileUrl && " You can download the file instead."}
                </p>
                {report.fileUrl && (
                  <Button
                    onClick={handleDownload}
                    className="mt-4 flex items-center gap-2 mx-auto"
                  >
                    <Download className="h-4 w-4" />
                    Download Report
                  </Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}