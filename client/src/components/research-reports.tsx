import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Download, FileText } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import type { ResearchReport } from "@shared/schema";

interface ResearchReportsProps {
  marketId: string;
}

export default function ResearchReports({ marketId }: ResearchReportsProps) {
  const { data: reports, isLoading } = useQuery<ResearchReport[]>({
    queryKey: ["/api/markets", marketId, "reports"],
  });

  const getReportTypeColor = (type: string | null) => {
    if (!type) return "bg-gray-100 text-gray-800";
    
    switch (type.toLowerCase()) {
      case "quarterly":
        return "bg-green-100 text-green-800";
      case "annual":
        return "bg-blue-100 text-blue-800";
      case "special":
        return "bg-yellow-100 text-yellow-800";
      default:
        return "bg-primary-100 text-primary-800";
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Research Reports</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="border border-gray-200 rounded-lg p-6">
                <div className="flex items-center justify-between mb-4">
                  <Skeleton className="w-20 h-6" />
                  <Skeleton className="w-8 h-8" />
                </div>
                <Skeleton className="h-6 w-3/4 mb-2" />
                <Skeleton className="h-16 w-full mb-4" />
                <div className="flex items-center justify-between">
                  <Skeleton className="w-24 h-4" />
                  <Skeleton className="w-24 h-8" />
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Research Reports</CardTitle>
      </CardHeader>
      <CardContent>
        {!reports || reports.length === 0 ? (
          <div className="text-center py-8">
            <FileText className="mx-auto h-12 w-12 text-gray-400 mb-4" />
            <p className="text-gray-500">No research reports available.</p>
            <p className="text-sm text-gray-400 mt-2">Research reports will appear here once they are published.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {reports.map(report => (
              <div key={report.id} className="bg-white border border-gray-200 rounded-lg p-6 hover:shadow-md transition-shadow">
                <div className="flex items-center justify-between mb-4">
                  <Badge className={getReportTypeColor(report.reportType)}>
                    {report.reportType || "Report"}
                  </Badge>
                  <FileText className="h-6 w-6 text-red-500" />
                </div>
                
                <h5 className="text-lg font-medium text-gray-900 mb-2">
                  {report.title}
                </h5>
                
                <p className="text-gray-600 text-sm mb-4 line-clamp-3">
                  {report.description || "Comprehensive market analysis and vendor insights."}
                </p>
                
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-500">
                    Published: {report.publishedAt ? 
                      new Date(report.publishedAt).toLocaleDateString() : 
                      'Recently'
                    }
                  </span>
                  <Button size="sm" className="bg-primary-600 hover:bg-primary-700">
                    <Download className="mr-2 h-4 w-4" />
                    Download
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
