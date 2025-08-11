import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Download, FileText, Calendar, ExternalLink } from "lucide-react";
import { format } from "date-fns";
import type { ResearchReport } from "@shared/schema";

interface ResearchReportsProps {
  marketId: string;
}

export default function ResearchReports({ marketId }: ResearchReportsProps) {
  const { data: reports, isLoading, error } = useQuery<ResearchReport[]>({
    queryKey: ["/api/markets", marketId, "research-reports"],
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Research Reports</CardTitle>
          <CardDescription>Market analysis and research documentation</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="border border-gray-200 rounded-lg p-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <Skeleton className="h-6 w-3/4 mb-2" />
                    <Skeleton className="h-4 w-full mb-2" />
                    <div className="flex gap-2">
                      <Skeleton className="h-5 w-20" />
                      <Skeleton className="h-5 w-24" />
                    </div>
                  </div>
                  <Skeleton className="h-9 w-24" />
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Research Reports</CardTitle>
          <CardDescription>Market analysis and research documentation</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <FileText className="mx-auto h-12 w-12 text-gray-400 mb-4" />
            <p className="text-gray-500">Failed to load research reports</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!reports || reports.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Research Reports</CardTitle>
          <CardDescription>Market analysis and research documentation</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-12">
            <FileText className="mx-auto h-12 w-12 text-gray-400 mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No Reports Available</h3>
            <p className="text-gray-500 mb-6">
              No research reports have been published for this market yet.
            </p>
            <p className="text-sm text-gray-400">
              Reports will appear here once they are uploaded by administrators.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const getReportTypeColor = (type: string | null) => {
    if (!type) return 'bg-gray-100 text-gray-800';
    switch (type.toLowerCase()) {
      case 'magic-quadrant': return 'bg-blue-100 text-blue-800';
      case 'market-analysis': return 'bg-green-100 text-green-800';
      case 'vendor-spotlight': return 'bg-purple-100 text-purple-800';
      case 'trend-report': return 'bg-orange-100 text-orange-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const handleDownload = (report: ResearchReport) => {
    if (report.fileUrl) {
      // Create a temporary link and trigger download
      const link = document.createElement('a');
      link.href = report.fileUrl;
      link.download = `${report.title}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  const handleExternalLink = (url: string) => {
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Research Reports</CardTitle>
        <CardDescription>
          Market analysis and research documentation ({reports.length} report{reports.length !== 1 ? 's' : ''})
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {reports.map((report) => (
            <div 
              key={report.id} 
              className="border border-gray-200 rounded-lg p-6 hover:shadow-md transition-shadow"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-start gap-3 mb-3">
                    <FileText className="h-6 w-6 text-gray-600 mt-1 flex-shrink-0" />
                    <div className="flex-1">
                      <h3 className="text-lg font-semibold text-gray-900 mb-2">
                        {report.title}
                      </h3>
                      
                      {report.description && (
                        <p className="text-gray-600 mb-3 leading-relaxed">
                          {report.description}
                        </p>
                      )}

                      <div className="flex flex-wrap gap-2 mb-3">
                        <Badge 
                          variant="secondary" 
                          className={`${getReportTypeColor(report.reportType)} border-0`}
                        >
                          {report.reportType}
                        </Badge>
                        
                        {report.publishedAt && (
                          <div className="flex items-center gap-1 text-sm text-gray-500">
                            <Calendar className="h-4 w-4" />
                            {format(new Date(report.publishedAt), 'MMM d, yyyy')}
                          </div>
                        )}
                      </div>

                      {report.fileSize && (
                        <p className="text-sm text-gray-500">
                          <span className="font-medium">Size:</span> {Math.round(report.fileSize / 1024)} KB
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex flex-col gap-2 ml-4">
                  {report.htmlContent && (
                    <Button
                      onClick={() => window.open(`/report/${report.id}`, "_blank")}
                      variant="default"
                      size="sm"
                      className="flex items-center gap-2"
                    >
                      <FileText className="h-4 w-4" />
                      View Online
                    </Button>
                  )}
                  
                  {report.fileUrl && (
                    <Button
                      onClick={() => handleDownload(report)}
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
            </div>
          ))}
        </div>

        {/* Summary stats */}
        <div className="mt-8 pt-6 border-t border-gray-200">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-center">
            <div>
              <div className="text-2xl font-bold text-gray-900">{reports.length}</div>
              <div className="text-sm text-gray-600">Total Reports</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-gray-900">
                {new Set(reports.map(r => r.reportType)).size}
              </div>
              <div className="text-sm text-gray-600">Report Types</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-gray-900">
                {reports.filter(r => r.publishedAt && 
                  new Date(r.publishedAt) > new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
                ).length}
              </div>
              <div className="text-sm text-gray-600">Recent (90 days)</div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}