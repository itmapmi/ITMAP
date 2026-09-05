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
import { CompanyProfileLockedPanel, isCompanyEmailRequiredError } from "@/components/company-profile-lock";

export default function ReportViewer() {
  // Registered at both /report/:reportId and its /mobile/report/:reportId
  // mirror (see shared/mobile-paths.ts and App.tsx) — always opened in a new
  // tab/window from research-reports.tsx, so mobileMode drives layout only.
  const [matchDesktop, paramsDesktop] = useRoute("/report/:reportId");
  const [matchMobile, paramsMobile] = useRoute("/mobile/report/:reportId");
  const reportId = paramsDesktop?.reportId ?? paramsMobile?.reportId;
  const mobileMode = !!matchMobile;

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

  if (isCompanyEmailRequiredError(error)) {
    return (
      <div className="min-h-screen bg-gray-50 py-8">
        <CompanyProfileLockedPanel feature="This report" variant={mobileMode ? "mobile" : "light"} className={mobileMode ? "mx-4" : undefined} />
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

  if (mobileMode) {
    // Genuinely different layout, not a squeezed desktop one: a compact
    // sticky header (title + type + date only, description dropped) and a
    // full-width bottom action bar so Close/Download stay reachable by
    // thumb without competing with the header for space.
    return (
      <div className="min-h-screen bg-gray-50 pb-20">
        <div className="bg-white border-b border-gray-200 sticky top-0 z-10 px-4 py-3">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-gray-500 flex-shrink-0" />
            {report.reportType && (
              <Badge variant="secondary" className={`${getReportTypeColor(report.reportType)} border-0 text-[10px] px-1.5 py-0`}>
                {report.reportType}
              </Badge>
            )}
            {report.publishedAt && (
              <span className="text-[11px] text-gray-500 ml-auto flex items-center gap-1 flex-shrink-0">
                <Calendar className="h-3 w-3" />
                {format(new Date(report.publishedAt), 'MMM d, yyyy')}
              </span>
            )}
          </div>
          <h1 className="text-base font-semibold text-gray-900 mt-1.5 leading-snug break-words [overflow-wrap:anywhere]">
            {report.title}
          </h1>
        </div>

        <div className="px-4 py-5">
          {report.htmlContent ? (
            <div
              className="prose prose-sm max-w-none break-words [overflow-wrap:anywhere] overflow-x-hidden
                [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto [&_pre]:overflow-x-auto
                prose-headings:text-gray-900 prose-headings:font-bold
                prose-p:text-gray-700 prose-p:leading-relaxed
                prose-a:text-blue-600 prose-a:no-underline hover:prose-a:underline
                prose-strong:text-gray-900 prose-strong:font-semibold
                prose-ul:text-gray-700 prose-ol:text-gray-700
                prose-li:text-gray-700 prose-li:my-1
                prose-blockquote:border-l-blue-500 prose-blockquote:bg-blue-50 prose-blockquote:py-2 prose-blockquote:px-3
                prose-code:bg-gray-100 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-xs
                prose-pre:bg-gray-900 prose-pre:text-gray-100 prose-pre:text-xs
                prose-img:rounded-lg prose-img:shadow-md
                prose-table:border-collapse prose-table:border prose-table:border-gray-300 prose-table:text-xs
                prose-th:border prose-th:border-gray-300 prose-th:bg-gray-50 prose-th:p-1.5
                prose-td:border prose-td:border-gray-300 prose-td:p-1.5"
              dangerouslySetInnerHTML={{ __html: report.htmlContent }}
            />
          ) : (
            <div className="text-center py-12">
              <FileText className="mx-auto h-10 w-10 text-gray-400 mb-3" />
              <h3 className="text-base font-medium text-gray-900 mb-1">No Content Available</h3>
              <p className="text-sm text-gray-500">
                This report doesn't have online content available.
                {report.fileUrl && " You can download the file instead."}
              </p>
            </div>
          )}
        </div>

        {/* Sticky bottom action bar — thumb-reachable Close/Download */}
        <div className="fixed bottom-0 inset-x-0 bg-white border-t border-gray-200 px-4 py-3 flex items-center gap-2 z-10">
          <Button variant="outline" onClick={handleGoBack} className="flex-1 flex items-center justify-center gap-2" data-testid="button-close-report">
            <ArrowLeft className="h-4 w-4" />
            Close
          </Button>
          {report.fileUrl && (
            <Button onClick={handleDownload} className="flex-1 flex items-center justify-center gap-2" data-testid="button-download-report">
              <Download className="h-4 w-4" />
              Download
            </Button>
          )}
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