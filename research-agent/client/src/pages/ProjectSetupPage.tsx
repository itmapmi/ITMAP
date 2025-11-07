import { useState, useEffect } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Trash2, Plus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const DEFAULT_CRITERIA = [
  { name: "Product Capabilities", description: "Core features and functionality" },
  { name: "ISV Ecosystem", description: "Third-party integrations and partnerships" },
  { name: "Innovation", description: "R&D investment and product roadmap" },
  { name: "Pricing Strategy", description: "Pricing model and cost-effectiveness" },
  { name: "Partner Strategy", description: "Partner network and channel approach" },
  { name: "Revenue", description: "Financial performance and market share" },
  { name: "Business Model", description: "Go-to-market strategy" },
  { name: "Customer Experience", description: "Support and customer satisfaction" },
];

export default function ProjectSetupPage() {
  const { id } = useParams();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const isNew = id === "new";

  const [marketName, setMarketName] = useState("");
  const [vendors, setVendors] = useState<Array<{ name: string; website: string }>>([]);
  const [newVendor, setNewVendor] = useState({ name: "", website: "" });

  const { data: project } = useQuery({
    queryKey: [`/api/projects/${id}`],
    enabled: !isNew,
  });

  const { data: existingVendors = [] } = useQuery({
    queryKey: [`/api/projects/${id}/vendors`],
    enabled: !isNew,
  });

  useEffect(() => {
    if (project) {
      setMarketName(project.marketName);
    }
  }, [project]);

  useEffect(() => {
    if (existingVendors.length > 0) {
      setVendors(existingVendors);
    }
  }, [existingVendors]);

  const createProjectMutation = useMutation({
    mutationFn: async (data: any) => apiRequest("/api/projects", {
      method: "POST",
      body: JSON.stringify(data),
    }),
    onSuccess: (newProject) => {
      return newProject.id;
    },
  });

  const addVendorsMutation = useMutation({
    mutationFn: async ({ projectId, vendors }: { projectId: string; vendors: any[] }) => {
      for (const vendor of vendors) {
        await apiRequest(`/api/projects/${projectId}/vendors`, {
          method: "POST",
          body: JSON.stringify(vendor),
        });
      }
    },
  });

  const setupCriteriaMutation = useMutation({
    mutationFn: async (projectId: string) => {
      const systemCriteria: any[] = await apiRequest("/api/criteria");
      
      for (let i = 0; i < systemCriteria.length; i++) {
        await apiRequest(`/api/projects/${projectId}/criteria-config`, {
          method: "POST",
          body: JSON.stringify({
            criteriaId: systemCriteria[i].id,
            customPrompt: null,
            llmProvider: "openai",
            llmModel: "gpt-4.1-mini",
            enabled: true,
            displayOrder: i + 1,
          }),
        });
      }
    },
  });

  const handleAddVendor = () => {
    if (newVendor.name) {
      setVendors([...vendors, newVendor]);
      setNewVendor({ name: "", website: "" });
    }
  };

  const handleRemoveVendor = (index: number) => {
    setVendors(vendors.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    if (!marketName || vendors.length === 0) {
      toast({
        variant: "destructive",
        title: "Missing information",
        description: "Please provide market name and at least one vendor",
      });
      return;
    }

    try {
      let projectId = id;

      if (isNew) {
        const newProject = await createProjectMutation.mutateAsync({
          marketName,
          status: "draft",
        });
        projectId = newProject.id;
      }

      await addVendorsMutation.mutateAsync({ projectId: projectId!, vendors });
      await setupCriteriaMutation.mutateAsync(projectId!);

      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      toast({ title: "Project saved successfully" });
      setLocation(`/projects/${projectId}/phase1`);
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Save failed",
        description: error.message,
      });
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <Button variant="ghost" onClick={() => setLocation("/")}>
            ← Back to Dashboard
          </Button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        <div>
          <h1 className="text-2xl font-bold">
            {isNew ? "New Research Project" : "Edit Project"}
          </h1>
          <p className="text-gray-600 mt-1">
            Configure your market research project for vendor evaluation, product analysis, and ecosystem assessment
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Market Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="market">Market Name *</Label>
              <Input
                id="market"
                placeholder="e.g., Enterprise Backup, AI-Powered Analytics"
                value={marketName}
                onChange={(e) => setMarketName(e.target.value)}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Vendors</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {vendors.map((vendor, index) => (
              <div key={index} className="flex gap-2 items-center p-3 bg-gray-50 rounded">
                <div className="flex-1">
                  <div className="font-medium">{vendor.name}</div>
                  <div className="text-sm text-gray-600">{vendor.website || "No website"}</div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => handleRemoveVendor(index)}
                >
                  <Trash2 className="w-4 h-4 text-red-500" />
                </Button>
              </div>
            ))}

            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <Input
                  placeholder="Vendor name"
                  value={newVendor.name}
                  onChange={(e) => setNewVendor({ ...newVendor, name: e.target.value })}
                />
                <Input
                  placeholder="Website URL (optional)"
                  value={newVendor.website}
                  onChange={(e) => setNewVendor({ ...newVendor, website: e.target.value })}
                />
              </div>
              <Button variant="outline" onClick={handleAddVendor} className="w-full">
                <Plus className="w-4 h-4 mr-2" />
                Add Vendor
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Evaluation Criteria (8 Standard Criteria)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3">
              {DEFAULT_CRITERIA.map((criteria, index) => (
                <div key={index} className="p-3 bg-gray-50 rounded">
                  <div className="font-medium text-sm">{criteria.name}</div>
                  <div className="text-xs text-gray-600 mt-1">{criteria.description}</div>
                </div>
              ))}
            </div>
            <p className="text-sm text-gray-600 mt-4">
              You can customize prompts and LLM selection for each criterion in Phase 1
            </p>
          </CardContent>
        </Card>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setLocation("/")}>
            Cancel
          </Button>
          <Button onClick={handleSave}>
            Save & Continue to Phase 1
          </Button>
        </div>
      </main>
    </div>
  );
}
