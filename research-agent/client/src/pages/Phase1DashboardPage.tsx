import { useParams, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Play, ChevronRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function Phase1DashboardPage() {
  const { id } = useParams();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const { data: project } = useQuery({
    queryKey: [`/api/projects/${id}`],
  });

  const { data: vendors = [] } = useQuery({
    queryKey: [`/api/projects/${id}/vendors`],
  });

  const { data: evaluations = [] } = useQuery({
    queryKey: [`/api/projects/${id}/evaluations`],
    refetchInterval: 5000, // Poll every 5 seconds
  });

  const { data: criteriaConfigs = [] } = useQuery({
    queryKey: [`/api/projects/${id}/criteria-config`],
  });

  const startPhase1Mutation = useMutation({
    mutationFn: () => apiRequest(`/api/projects/${id}/phase1/start`, { method: "POST" }),
    onSuccess: () => {
      toast({ title: "Phase 1 started", description: "Generating vendor commentary..." });
      queryClient.invalidateQueries({ queryKey: [`/api/projects/${id}`] });
    },
  });

  const canStartPhase1 = project?.status === "draft" || project?.status === "failed";
  const isPhase1Running = project?.status === "phase1_running";
  const isPhase1Complete = project?.status === "phase1_complete";

  const getEvaluationStatus = (vendorId: string, criteriaId: string) => {
    const eval = evaluations.find((e: any) => e.vendorId === vendorId && e.criteriaId === criteriaId);
    return eval?.status || "pending";
  };

  const getEvaluationData = (vendorId: string, criteriaId: string) => {
    return evaluations.find((e: any) => e.vendorId === vendorId && e.criteriaId === criteriaId);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
          <div>
            <Button variant="ghost" onClick={() => setLocation("/")}>
              ← Back to Dashboard
            </Button>
            <h1 className="text-2xl font-bold mt-2">{project?.marketName}</h1>
            <p className="text-sm text-gray-600">Phase 1: Vendor Evaluation</p>
          </div>
          {isPhase1Complete && (
            <Button onClick={() => setLocation(`/projects/${id}/phase2`)}>
              Continue to Phase 2
              <ChevronRight className="w-4 h-4 ml-2" />
            </Button>
          )}
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        {canStartPhase1 && (
          <Card>
            <CardContent className="py-8 text-center">
              <h3 className="text-lg font-semibold mb-2">Ready to start Phase 1</h3>
              <p className="text-gray-600 mb-4">
                Generate 200-word commentary for each vendor across {criteriaConfigs.length} evaluation criteria
              </p>
              <Button onClick={() => startPhase1Mutation.mutate()} size="lg">
                <Play className="w-4 h-4 mr-2" />
                Start Phase 1 Evaluation
              </Button>
            </CardContent>
          </Card>
        )}

        {isPhase1Running && (
          <Card>
            <CardContent className="py-6">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold">Phase 1 in progress...</h3>
                  <p className="text-sm text-gray-600">
                    Generating commentary for {vendors.length} vendors across {criteriaConfigs.length} criteria
                  </p>
                </div>
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="space-y-4">
          {criteriaConfigs.map((config: any) => (
            <Card key={config.id}>
              <CardHeader>
                <CardTitle className="text-lg">
                  {config.criteriaId} - Using {config.llmModel}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {vendors.map((vendor: any) => {
                  const status = getEvaluationStatus(vendor.id, config.criteriaId);
                  const evalData = getEvaluationData(vendor.id, config.criteriaId);

                  return (
                    <div key={vendor.id} className="border rounded p-4">
                      <div className="flex justify-between items-start mb-2">
                        <div>
                          <div className="font-medium">{vendor.name}</div>
                          <div className="text-xs text-gray-500">{vendor.website}</div>
                        </div>
                        <span className={`text-xs px-2 py-1 rounded ${
                          status === "completed" ? "bg-green-100 text-green-800" :
                          status === "running" ? "bg-blue-100 text-blue-800" :
                          status === "failed" ? "bg-red-100 text-red-800" :
                          "bg-gray-100 text-gray-800"
                        }`}>
                          {status}
                        </span>
                      </div>

                      {evalData?.commentary && (
                        <div className="mt-3 p-3 bg-gray-50 rounded text-sm">
                          <p>{evalData.commentary}</p>
                          {evalData.sources && evalData.sources.length > 0 && (
                            <div className="mt-2 text-xs text-gray-600">
                              <strong>Sources:</strong>
                              {evalData.sources.map((source: any, idx: number) => (
                                <div key={idx}>• {source.title}</div>
                              ))}
                            </div>
                          )}
                          <div className="mt-2 text-xs text-gray-500">
                            Word count: {evalData.wordCount}
                          </div>
                        </div>
                      )}

                      {evalData?.errorMessage && (
                        <div className="mt-2 text-sm text-red-600">
                          Error: {evalData.errorMessage}
                        </div>
                      )}
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          ))}
        </div>
      </main>
    </div>
  );
}
