import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { BookOpen, FileText, Info, Lightbulb, CheckCircle } from "lucide-react";
import type { ResearchMethodology } from "@shared/schema";

interface ResearchMethodologyProps {
  marketId: string;
}

export default function ResearchMethodology({ marketId }: ResearchMethodologyProps) {
  const { data: methodology, isLoading, error } = useQuery<ResearchMethodology>({
    queryKey: ["/api/markets", marketId, "research-methodology"],
  });

  console.log("ResearchMethodology - marketId:", marketId);
  console.log("ResearchMethodology - isLoading:", isLoading);
  console.log("ResearchMethodology - error:", error);
  console.log("ResearchMethodology - methodology:", methodology);

  if (isLoading) {
    return (
      <Card className="bg-gradient-to-br from-white to-blue-50/30 border-blue-100 shadow-lg">
        <CardHeader className="bg-gradient-to-r from-blue-50 to-indigo-50 border-b border-blue-100">
          <div className="flex items-center gap-3">
            <Skeleton className="w-10 h-10 rounded-lg" />
            <div className="space-y-2">
              <Skeleton className="h-6 w-64" />
              <Skeleton className="h-4 w-96" />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-6">
          <div className="space-y-4">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="h-32 w-full" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="bg-gradient-to-br from-white to-red-50/30 border-red-100 shadow-lg">
        <CardContent className="p-6">
          <div className="text-center py-8">
            <div className="flex items-center justify-center w-12 h-12 bg-red-100 rounded-full mx-auto mb-4">
              <Info className="h-6 w-6 text-red-500" />
            </div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">Unable to Load Methodology</h3>
            <p className="text-gray-500">
              There was an error loading the research methodology. Please try again later.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!methodology || !methodology.content) {
    return (
      <Card className="bg-gradient-to-br from-white to-gray-50/30 border-gray-100 shadow-lg">
        <CardHeader className="bg-gradient-to-r from-gray-50 to-blue-50 border-b border-gray-100">
          <CardTitle className="flex items-center gap-3 text-xl">
            <div className="flex items-center justify-center w-10 h-10 bg-gradient-to-r from-gray-400 to-blue-400 rounded-lg shadow-md">
              <BookOpen className="h-5 w-5 text-white" />
            </div>
            Research Methodology
            <Badge variant="secondary" className="bg-gray-100 text-gray-600 shadow-sm">
              <Info className="h-3 w-3 mr-1" />
              Not Available
            </Badge>
          </CardTitle>
          <CardDescription>
            Research methodology and scoring rationale for this market analysis
          </CardDescription>
        </CardHeader>
        <CardContent className="p-6">
          <div className="text-center py-12">
            <div className="flex items-center justify-center w-16 h-16 bg-gray-100 rounded-full mx-auto mb-4">
              <FileText className="h-8 w-8 text-gray-400" />
            </div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">Methodology Not Available</h3>
            <p className="text-gray-500 max-w-md mx-auto">
              The research methodology for this market has not been published yet. 
              Check back later or contact our research team for more information.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-gradient-to-br from-white to-blue-50/30 border-blue-100 shadow-lg">
      <CardHeader className="bg-gradient-to-r from-blue-50 to-indigo-50 border-b border-blue-100">
        <CardTitle className="flex items-center gap-3 text-xl">
          <div className="flex items-center justify-center w-10 h-10 bg-gradient-to-r from-blue-500 to-indigo-500 rounded-lg shadow-md">
            <BookOpen className="h-5 w-5 text-white" />
          </div>
          Research Methodology
          <Badge variant="secondary" className="bg-green-100 text-green-700 shadow-sm">
            <CheckCircle className="h-3 w-3 mr-1" />
            Published
          </Badge>
        </CardTitle>
        <CardDescription className="flex items-center gap-4 flex-wrap mt-3">
          <span className="text-gray-600 flex items-center gap-2">
            <Info className="h-4 w-4" />
            Research methodology and scoring rationale for this market analysis
          </span>
          <div className="flex items-center gap-3 p-2 bg-white/60 rounded-lg border border-white/40 backdrop-blur-sm">
            <div className="flex items-center gap-1">
              <Lightbulb className="h-4 w-4 text-amber-500" />
              <span className="text-xs font-medium">Transparency in our evaluation process</span>
            </div>
          </div>
        </CardDescription>
      </CardHeader>
      
      <CardContent className="p-6">
        <div className="prose prose-sm max-w-none">
          <div className="bg-white rounded-lg border border-blue-100 p-6 shadow-sm">
            <div className="space-y-4">
              {methodology.content.split('\n').map((paragraph, index) => {
                if (!paragraph.trim()) {
                  return <div key={index} className="h-4" />;
                }
                
                return (
                  <p key={index} className="text-gray-700 leading-relaxed">
                    {paragraph}
                  </p>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer Information */}
        <div className="mt-6 p-4 bg-blue-50 rounded-lg border border-blue-200">
          <div className="flex items-start gap-3">
            <Info className="h-5 w-5 text-blue-500 mt-0.5 flex-shrink-0" />
            <div>
              <h4 className="font-medium text-blue-900 mb-1">About This Methodology</h4>
              <p className="text-sm text-blue-700">
                This methodology document outlines our approach to vendor evaluation, 
                scoring criteria, and research standards to ensure transparency and consistency 
                in our market analysis.
              </p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}