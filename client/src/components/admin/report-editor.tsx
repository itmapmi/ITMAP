import { useState, useEffect, useRef } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Save, Eye, FileText, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import type { Market, ResearchReport, InsertResearchReport } from "@shared/schema";
import { Editor } from "@tinymce/tinymce-react";

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

export default function ReportEditor({ markets, existingReport, onClose, onSave }: ReportEditorProps) {
  const [formData, setFormData] = useState({
    title: existingReport?.title || "",
    description: existingReport?.description || "",
    marketId: existingReport?.marketId || "",
    reportType: existingReport?.reportType || "",
    htmlContent: existingReport?.htmlContent || "",
  });

  // Update form data when existingReport changes
  useEffect(() => {
    if (existingReport) {
      setFormData({
        title: existingReport.title || "",
        description: existingReport.description || "",
        marketId: existingReport.marketId || "",
        reportType: existingReport.reportType || "",
        htmlContent: existingReport.htmlContent || "",
      });
    }
  }, [existingReport]);

  const [showPreview, setShowPreview] = useState(false);
  const editorRef = useRef<any>(null);
  const { toast } = useToast();

  // Fetch TinyMCE API key
  const { data: tinymceConfig } = useQuery<{ apiKey: string }>({
    queryKey: ["/api/config/tinymce"],
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  // Handle editor content change
  const handleEditorChange = (content: string) => {
    setFormData(prev => ({ ...prev, htmlContent: content }));
  };

  // Save report mutation
  const saveReportMutation = useMutation({
    mutationFn: async (data: InsertResearchReport) => {
      const url = existingReport 
        ? `/api/research-reports/${existingReport.id}`
        : "/api/research-reports";
      const method = existingReport ? "PUT" : "POST";
      
      console.log(`Making ${method} request to ${url} with data:`, data);
      
      const response = await fetch(url, {
        method,
        body: JSON.stringify(data),
        headers: {
          'Content-Type': 'application/json',
        },
      });
      
      console.log(`Response status: ${response.status}`, response.statusText);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Error response:`, errorText);
        throw new Error(`Failed to ${method === 'PUT' ? 'update' : 'create'} report: ${errorText}`);
      }
      
      const result = await response.json();
      console.log('Success response:', result);
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/markets"] });
      if (existingReport?.marketId) {
        queryClient.invalidateQueries({ queryKey: ["/api/markets", existingReport.marketId, "research-reports"] });
      }
      toast({
        title: "Success",
        description: `Research report ${existingReport ? 'updated' : 'created'} successfully`,
      });
      onSave();
    },
    onError: (error: any) => {
      console.error("Save report error:", error);
      toast({
        title: "Error",
        description: `Failed to ${existingReport ? 'update' : 'create'} research report: ${error.message || 'Unknown error'}`,
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

    const saveData = {
      title: formData.title,
      description: formData.description || null,
      marketId: formData.marketId,
      reportType: formData.reportType || null,
      htmlContent: formData.htmlContent,
      fileUrl: null, // HTML reports don't have file URLs
    };

    console.log('About to save with data:', saveData);
    console.log('Existing report:', existingReport);

    saveReportMutation.mutate(saveData);
  };

  const selectedMarket = markets.find(m => m.id === formData.marketId);

  // TinyMCE configuration
  const editorConfig = {
    height: 400,
    menubar: true,
    promotion: false, // Disable promotion messages
    branding: false, // Remove "Powered by TinyMCE" branding
    license_key: 'gpl', // Use GPL license to avoid domain restrictions
    setup: (editor: any) => {
      // Hide any setup dialogs or overlays
      editor.on('init', () => {
        // Remove any setup overlays that might appear
        const setupOverlay = document.querySelector('.tox-dialog-wrap');
        if (setupOverlay) {
          setupOverlay.remove();
        }
      });
    },
    plugins: [
      'advlist', 'autolink', 'lists', 'link', 'image', 'charmap', 'preview',
      'anchor', 'searchreplace', 'visualblocks', 'code', 'fullscreen',
      'insertdatetime', 'media', 'table', 'help', 'wordcount', 'paste'
    ],
    toolbar: 
      'undo redo | blocks | bold italic forecolor | alignleft aligncenter ' +
      'alignright alignjustify | bullist numlist outdent indent | ' +
      'removeformat | table tabledelete | tableprops tablerowprops tablecellprops | ' +
      'tableinsertrowbefore tableinsertrowafter tabledeleterow | ' +
      'tableinsertcolbefore tableinsertcolafter tabledeletecol | ' +
      'image link media | code fullscreen preview | help',
    content_style: 'body { font-family:Helvetica,Arial,sans-serif; font-size:14px }',
    paste_data_images: true,
    automatic_uploads: true,
    file_picker_types: 'image',
    images_upload_handler: async (blobInfo: any, progress: any): Promise<string> => {
      return new Promise(async (resolve, reject) => {
        try {
          // Get upload URL from backend
          const uploadResponse = await fetch('/api/objects/upload', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
          });
          const { uploadURL } = await uploadResponse.json();

          // Upload image to object storage
          await fetch(uploadURL, {
            method: 'PUT',
            body: blobInfo.blob(),
          });

          // Return the object URL
          const objectUrl = uploadURL.split('?')[0];
          const objectPath = `/objects/${objectUrl.split('/').slice(-2).join('/')}`;
          resolve(objectPath);
        } catch (error) {
          console.error('Image upload failed:', error);
          reject('Image upload failed');
        }
      });
    }
  };

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
              placeholder="Enter report title..."
              value={formData.title}
              onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
              className="w-full"
            />
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="market">Market</Label>
            <Select 
              value={formData.marketId} 
              onValueChange={(value) => setFormData(prev => ({ ...prev, marketId: value }))}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select a market..." />
              </SelectTrigger>
              <SelectContent>
                {markets.map(market => (
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
                <SelectValue placeholder="Select report type..." />
              </SelectTrigger>
              <SelectContent>
                {REPORT_TYPES.map(type => (
                  <SelectItem key={type.value} value={type.value}>
                    {type.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="description">Description (optional)</Label>
            <Input
              id="description"
              placeholder="Brief description of the report..."
              value={formData.description}
              onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
              className="w-full"
            />
          </div>
        </div>

        {/* Rich Text Editor */}
        <div className="space-y-2">
          <Label>Report Content</Label>
          <div className="border rounded-lg">
            <Editor
              onInit={(evt, editor) => {
                editorRef.current = editor;
                console.log('TinyMCE initialized successfully');
                // Hide any setup dialogs after initialization
                setTimeout(() => {
                  const setupDialog = document.querySelector('.tox-dialog-wrap');
                  if (setupDialog) {
                    setupDialog.remove();
                  }
                }, 1000);
              }}
              initialValue={formData.htmlContent}
              init={{
                ...editorConfig,
                // Use self-hosted version without API key requirements
                base_url: '/tinymce',
                suffix: '.min',
              }}
              onEditorChange={handleEditorChange}
              onLoadError={(error) => {
                console.error('TinyMCE load error:', error);
              }}
            />
          </div>
          <p className="text-sm text-gray-500">
            Use the toolbar above to format your content. You can add headings, lists, links, images, tables, and more.
          </p>
        </div>

        {/* Action Buttons */}
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