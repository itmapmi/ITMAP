import { useParams, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Play } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function Phase2ReviewPage() {
  const { id } = useParams();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const { data: project } = useQuery({
    queryKey: [`/api/projects/${id}`],
  });

  const { data: vendors = [] } = useQuery({
    queryKey: [`/api/projects/${id}/vendors`],
  });

  const { data: scores = [] } = useQuery({
    queryKey: [`/api/projects/${id}/scores`],
    refetchInterval: 5000,
  });

  const { data: criteriaConfigs = [] } = useQuery({
    queryKey: [`/api/projects/${id}/criteria-config`],
  });

  const startPhase2Mutation = useMutation({
    mutationFn: async () => {
      // Create default Phase 2 config if not exists
      try {
        await apiRequest(`/api/projects/${id}/phase2/config`, {
          method: "POST",
          body: JSON.stringify({
            llmProvider: "openai",
            llmModel: "gpt-4.1-mini",
          }),
        });
      } catch (e) {
        // Config might already exist
      }
      
      return apiRequest(`/api/projects/${id}/phase2/start`, { method: "POST" });
    },
    onSuccess: () => {
      toast({ title: "Phase 2 started", description: "Analyzing commentary to generate scores..." });
      queryClient.invalidateQueries({ queryKey: [`/api/projects/${id}`] });
    },
  });

  const canStartPhase2 = project?.status === "phase1_complete";
  const isPhase2Running = project?.status === "phase2_running";
  const isPhase2Complete = project?.status === "completed";

  const getVendorScore = (vendorId: string, criteriaId: string) => {
    const score = scores.find((s: any) => s.vendorId === vendorId && s.criteriaId === criteriaId);
    return score;
  };

  const getVendorAverage = (vendorId: string) => {
    const vendorScores = scores.filter((s: any) => s.vendorId === vendorId);
    if (vendorScores.length === 0) return 0;
    const sum = vendorScores.reduce((acc: number, s: any) => acc + parseFloat(s.score), 0);
    return (sum / vendorScores.length).toFixed(1);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <Button variant="ghost" onClick={() => setLocation("/")}>
            ← Back to Dashboard
          </Button>
          <h1 className="text-2xl font-bold mt-2">{project?.marketName}</h1>
          <p className="text-sm text-gray-600">Phase 2: Vendor Scoring (0-10 Scale)</p>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        {canStartPhase2 && (
          <Card>
            <CardContent className="py-8 text-center">
              <h3 className="text-lg font-semibold mb-2">Ready to start Phase 2</h3>
              <p className="text-gray-600 mb-4">
                Analyze Phase 1 commentary to generate 0-10 scores for each vendor-criterion combination
              </p>
              <Button onClick={() => startPhase2Mutation.mutate()} size="lg">
                <Play className="w-4 h-4 mr-2" />
                Start Phase 2 Scoring
              </Button>
            </CardContent>
          </Card>
        )}

        {isPhase2Running && (
          <Card>
            <CardContent className="py-6">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold">Phase 2 in progress...</h3>
                  <p className="text-sm text-gray-600">Generating scores from commentary</p>
                </div>
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              </div>
            </CardContent>
          </Card>
        )}

        {(isPhase2Complete || scores.length > 0) && (
          <>
            <Card>
              <CardHeader>
                <CardTitle>Vendor Scores Summary</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left p-2">Vendor</th>
                        {criteriaConfigs.map((config: any) => (
                          <th key={config.id} className="text-center p-2">
                            {config.criteriaId.split("-")[0]}
                          </th>
                        ))}
                        <th className="text-center p-2 font-bold">Avg</th>
                      </tr>
                    </thead>
                    <tbody>
                      {vendors.map((vendor: any) => (
                        <tr key={vendor.id} className="border-b hover:bg-gray-50">
                          <td className="p-2 font-medium">{vendor.name}</td>
                          {criteriaConfigs.map((config: any) => {
                            const score = getVendorScore(vendor.id, config.criteriaId);
                            return (
                              <td key={config.id} className="text-center p-2">
                                {score ? (
                                  <span className={`inline-block px-2 py-1 rounded ${
                                    parseFloat(score.score) >= 8 ? "bg-green-100 text-green-800" :
                                    parseFloat(score.score) >= 6 ? "bg-blue-100 text-blue-800" :
                                    parseFloat(score.score) >= 4 ? "bg-yellow-100 text-yellow-800" :
                                    "bg-red-100 text-red-800"
                                  }`}>
                                    {score.score}
                                  </span>
                                ) : (
                                  <span className="text-gray-400">-</span>
                                )}
                              </td>
                            );
                          })}
                          <td className="text-center p-2 font-bold">
                            {getVendorAverage(vendor.id)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Detailed Scores with Reasoning</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {vendors.map((vendor: any) => (
                  <div key={vendor.id} className="border rounded p-4">
                    <h3 className="font-semibold text-lg mb-3">{vendor.name}</h3>
                    <div className="space-y-2">
                      {criteriaConfigs.map((config: any) => {
                        const score = getVendorScore(vendor.id, config.criteriaId);
                        if (!score) return null;

                        return (
                          <div key={config.id} className="p-3 bg-gray-50 rounded">
                            <div className="flex justify-between items-center mb-2">
                              <span className="font-medium">{config.criteriaId}</span>
                              <span className="text-lg font-bold">{score.score}/10</span>
                            </div>
                            {score.reasoning && (
                              <p className="text-sm text-gray-700">{score.reasoning}</p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </>
        )}
      </main>
    </div>
  );
}
