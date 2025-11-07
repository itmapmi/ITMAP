import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Plus, Trash2, Play, BarChart3 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function DashboardPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const { data: user } = useQuery({ queryKey: ["/api/auth/user"] });
  const { data: projects = [], isLoading } = useQuery({
    queryKey: ["/api/projects"],
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      apiRequest(`/api/projects/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      toast({ title: "Project deleted" });
    },
  });

  const logoutMutation = useMutation({
    mutationFn: () => apiRequest("/api/auth/logout", { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
    },
  });

  const getStatusBadge = (status: string) => {
    const colors: Record<string, string> = {
      draft: "bg-gray-100 text-gray-800",
      phase1_running: "bg-blue-100 text-blue-800",
      phase1_complete: "bg-green-100 text-green-800",
      phase2_running: "bg-purple-100 text-purple-800",
      completed: "bg-green-100 text-green-800",
      failed: "bg-red-100 text-red-800",
    };

    return (
      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${colors[status] || colors.draft}`}>
        {status.replace(/_/g, " ").toUpperCase()}
      </span>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold">Research Agent</h1>
            <p className="text-sm text-gray-600">Welcome, {user?.name}</p>
          </div>
          <Button variant="outline" onClick={() => logoutMutation.mutate()}>
            Logout
          </Button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-semibold">Research Projects</h2>
          <Button onClick={() => setLocation("/projects/new")}>
            <Plus className="w-4 h-4 mr-2" />
            New Project
          </Button>
        </div>

        {isLoading ? (
          <div className="text-center py-12">Loading projects...</div>
        ) : projects.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-gray-600 mb-4">No projects yet. Create your first research project to get started.</p>
              <Button onClick={() => setLocation("/projects/new")}>
                <Plus className="w-4 h-4 mr-2" />
                Create Project
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {projects.map((project: any) => (
              <Card key={project.id} className="hover:shadow-lg transition-shadow">
                <CardHeader>
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <CardTitle className="text-lg">{project.marketName}</CardTitle>
                      <CardDescription className="mt-2">
                        {getStatusBadge(project.status)}
                      </CardDescription>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => deleteMutation.mutate(project.id)}
                    >
                      <Trash2 className="w-4 h-4 text-red-500" />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex gap-2">
                    {project.status === "draft" && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1"
                        onClick={() => setLocation(`/projects/${project.id}`)}
                      >
                        Configure
                      </Button>
                    )}
                    {(project.status === "phase1_complete" || project.status === "phase1_running") && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1"
                        onClick={() => setLocation(`/projects/${project.id}/phase1`)}
                      >
                        <Play className="w-4 h-4 mr-1" />
                        Phase 1
                      </Button>
                    )}
                    {(project.status === "phase2_complete" || project.status === "phase2_running" || project.status === "completed") && (
                      <Button
                        size="sm"
                        className="flex-1"
                        onClick={() => setLocation(`/projects/${project.id}/phase2`)}
                      >
                        <BarChart3 className="w-4 h-4 mr-1" />
                        Results
                      </Button>
                    )}
                  </div>
                  <p className="text-xs text-gray-500">
                    Created {new Date(project.createdAt).toLocaleDateString()}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
