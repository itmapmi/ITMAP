import { useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Save, Eye, FileText, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { Market, ResearchReport, InsertResearchReport } from "@shared/schema";
import ReactQuill from "react-quill";
import "react-quill/dist/quill.snow.css";

interface ReportEditorProps {
  markets: Market[];
  existingReport?: ResearchReport;
  onClose: () => void;
  onSave: () => void;
}

const REPORT_TYPES = [
  { value: "magic-quadrant", label: "Magic Quadrant" },
  { value: "market-analysis", label: "Market Analysis" },
  { value: "vendor-spotlight", label: "Vendor Spotlight" },
  { value: "trend-report", label: "Trend Report" },
  { value: "competitive-analysis", label: "Competitive Analysis" },
  { value: "technology-overview", label: "Technology Overview" },
];

const QUILL_MODULES = {
  toolbar: [
    [{ 'header': [1, 2, 3, 4, 5, 6, false] }],
    ['bold', 'italic', 'underline', 'strike'],
    [{ 'color': [] }, { 'background': [] }],
    [{ 'list': 'ordered'}, { 'list': 'bullet' }],
    [{ 'indent': '-1'}, { 'indent': '+1' }],
    [{ 'align': [] }],
    ['link', 'image'],
    ['blockquote', 'code-block'],
    [{ 'script': 'sub'}, { 'script': 'super' }],
    ['clean']
  ],
};

const QUILL_FORMATS = [
  'header', 'bold', 'italic', 'underline', 'strike',
  'color', 'background', 'list', 'bullet', 'indent',
  'align', 'link', 'image', 'blockquote', 'code-block',
  'script'
];

export default function ReportEditor({ markets, existingReport, onClose, onSave }: ReportEditorProps) {
  const [formData, setFormData] = useState({
    title: existingReport?.title || "",
    description: existingReport?.description || "",
    marketId: existingReport?.marketId || "",
    reportType: existingReport?.reportType || "",
    htmlContent: existingReport?.htmlContent || "",
  });
  const [showPreview, setShowPreview] = useState(false);
  const { toast } = useToast();

  // Save report mutation
  const saveReportMutation = useMutation({
    mutationFn: async (data: InsertResearchReport) => {
      const url = existingReport 
        ? `/api/research-reports/${existingReport.id}`
        : "/api/research-reports";
      const method = existingReport ? "PUT" : "POST";
      
      const response = await fetch(url, {
        method,
        body: JSON.stringify(data),
        headers: {
          'Content-Type': 'application/json',
        },
      });
      
      if (!response.ok) {
        throw new Error(`Failed to ${method === 'PUT' ? 'update' : 'create'} report`);
      }
      
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/markets"] });
      toast({
        title: "Success",
        description: `Research report ${existingReport ? 'updated' : 'created'} successfully`,
      });
      onSave();
    },
    onError: () => {
      toast({
        title: "Error",
        description: `Failed to ${existingReport ? 'update' : 'create'} research report`,
        variant: "destructive",
      });
    },
  });

  const handleSave = () => {
    if (!formData.title || !formData.marketId || !formData.htmlContent) {
      toast({
        title: "Validation Error",
        description: "Please fill in title, market, and content",
        variant: "destructive",
      });
      return;
    }

    saveReportMutation.mutate({
      title: formData.title,
      description: formData.description || null,
      marketId: formData.marketId,
      reportType: formData.reportType || null,
      htmlContent: formData.htmlContent,
      fileUrl: null, // HTML reports don't have file URLs
    });
  };

  const selectedMarket = markets.find(m => m.id === formData.marketId);

  if (showPreview) {
    return (
      <Card className="w-full max-w-6xl mx-auto">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Preview: {formData.title}</CardTitle>
            <CardDescription>How this report will appear to users</CardDescription>
          </div>
          <Button
            variant="outline"
            onClick={() => setShowPreview(false)}
            className="flex items-center gap-2"
          >
            <X className="h-4 w-4" />
            Close Preview
          </Button>
        </CardHeader>
        <CardContent>
          <div className="border rounded-lg p-6 bg-white">
            <div className="prose max-w-none" dangerouslySetInnerHTML={{ __html: formData.htmlContent }} />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-6xl mx-auto">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-5 w-5" />
          {existingReport ? 'Edit Research Report' : 'Create Research Report'}
        </CardTitle>
        <CardDescription>
          {existingReport ? 'Update the research report content' : 'Create a new research report with HTML content'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Basic Information */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="title">Report Title</Label>
            <Input
              id="title"
              value={formData.title}
              onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
              placeholder="Enter report title..."
            />
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="market">Market</Label>
            <Select 
              value={formData.marketId} 
              onValueChange={(value) => setFormData(prev => ({ ...prev, marketId: value }))}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select a market" />
              </SelectTrigger>
              <SelectContent>
                {markets.map((market) => (
                  <SelectItem key={market.id} value={market.id}>
                    {market.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="reportType">Report Type</Label>
            <Select 
              value={formData.reportType} 
              onValueChange={(value) => setFormData(prev => ({ ...prev, reportType: value }))}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select report type" />
              </SelectTrigger>
              <SelectContent>
                {REPORT_TYPES.map((type) => (
                  <SelectItem key={type.value} value={type.value}>
                    {type.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="description">Description</Label>
          <Textarea
            id="description"
            value={formData.description}
            onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
            placeholder="Brief description of the report..."
            rows={3}
          />
        </div>

        {/* HTML Editor */}
        <div className="space-y-2">
          <Label>Report Content</Label>
          <div className="border rounded-lg">
            <ReactQuill
              theme="snow"
              value={formData.htmlContent}
              onChange={(content) => setFormData(prev => ({ ...prev, htmlContent: content }))}
              modules={QUILL_MODULES}
              formats={QUILL_FORMATS}
              style={{ minHeight: '400px' }}
              placeholder="Write your report content here..."
            />
          </div>
          <p className="text-sm text-gray-500">
            Use the toolbar above to format your content. You can add headings, lists, links, images, and more.
          </p>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3 pt-4">
          <Button
            onClick={handleSave}
            disabled={saveReportMutation.isPending}
            className="flex items-center gap-2"
          >
            <Save className="h-4 w-4" />
            {saveReportMutation.isPending ? 'Saving...' : (existingReport ? 'Update Report' : 'Save Report')}
          </Button>
          
          <Button
            variant="outline"
            onClick={() => setShowPreview(true)}
            disabled={!formData.htmlContent}
            className="flex items-center gap-2"
          >
            <Eye className="h-4 w-4" />
            Preview
          </Button>
          
          <Button
            variant="outline"
            onClick={onClose}
            disabled={saveReportMutation.isPending}
          >
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}