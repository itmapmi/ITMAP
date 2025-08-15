import { useState, useEffect, useRef } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Save, Eye, FileText, X, Bold, Italic, List, AlignLeft, AlignCenter, Type, Image, Upload } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import type { Market, ResearchReport, InsertResearchReport } from "@shared/schema";
// Using custom HTML editor instead of TinyMCE

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
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  // Handle editor content change
  const handleEditorChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setFormData(prev => ({ ...prev, htmlContent: e.target.value }));
  };

  // Insert HTML formatting at cursor position
  const insertHtml = (openTag: string, closeTag: string = '') => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selectedText = textarea.value.substring(start, end);
    const newText = openTag + selectedText + closeTag;
    
    const beforeText = textarea.value.substring(0, start);
    const afterText = textarea.value.substring(end);
    
    const newValue = beforeText + newText + afterText;
    setFormData(prev => ({ ...prev, htmlContent: newValue }));
    
    // Restore cursor position
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + openTag.length, start + openTag.length + selectedText.length);
    }, 0);
  };

  // Handle image upload
  const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      // Create FormData for file upload
      const formData = new FormData();
      formData.append('file', file);

      // Upload to object storage
      const response = await fetch('/api/objects/upload', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error('Failed to upload image');
      }

      const { url } = await response.json();
      
      // Insert image HTML at cursor position
      const altText = file.name.split('.')[0];
      const imageHtml = `<img src="${url}" alt="${altText}" style="max-width: 100%; height: auto;" />`;
      insertHtml(imageHtml);

      toast({
        title: "Success",
        description: "Image uploaded and inserted into report",
      });
    } catch (error) {
      console.error('Image upload error:', error);
      toast({
        title: "Error",
        description: "Failed to upload image. Please try again.",
        variant: "destructive",
      });
    }

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Trigger file input
  const triggerImageUpload = () => {
    fileInputRef.current?.click();
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

        {/* HTML Rich Text Editor */}
        <div className="space-y-2">
          <Label>Report Content</Label>
          <div className="border rounded-lg">
            {/* Formatting Toolbar */}
            <div className="flex flex-wrap gap-1 p-2 border-b bg-gray-50 dark:bg-gray-800">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => insertHtml('<h1>', '</h1>')}
                className="flex items-center gap-1"
              >
                <Type className="h-3 w-3" />
                H1
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => insertHtml('<h2>', '</h2>')}
                className="flex items-center gap-1"
              >
                <Type className="h-3 w-3" />
                H2
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => insertHtml('<strong>', '</strong>')}
              >
                <Bold className="h-3 w-3" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => insertHtml('<em>', '</em>')}
              >
                <Italic className="h-3 w-3" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => insertHtml('<ul>\n  <li>', '</li>\n</ul>')}
              >
                <List className="h-3 w-3" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => insertHtml('<p style="text-align: center;">', '</p>')}
              >
                <AlignCenter className="h-3 w-3" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => insertHtml('<p style="text-align: left;">', '</p>')}
              >
                <AlignLeft className="h-3 w-3" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => insertHtml('<table border="1">\n  <tr>\n    <th>Header 1</th>\n    <th>Header 2</th>\n  </tr>\n  <tr>\n    <td>', '</td>\n    <td>Cell 2</td>\n  </tr>\n</table>')}
                className="text-xs"
              >
                Table
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => insertHtml('<a href="', '">Link Text</a>')}
                className="text-xs"
              >
                Link
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={triggerImageUpload}
                className="flex items-center gap-1"
              >
                <Image className="h-3 w-3" />
                Image
              </Button>
            </div>
            
            {/* Hidden file input for image upload */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleImageUpload}
              className="hidden"
            />
            
            {/* HTML Content Textarea */}
            <Textarea
              ref={textareaRef}
              value={formData.htmlContent}
              onChange={handleEditorChange}
              placeholder="Write your HTML content here. Use the toolbar buttons above to add formatting..."
              className="min-h-[400px] border-0 focus-visible:ring-0 focus-visible:ring-offset-0 font-mono text-sm"
              style={{ resize: 'vertical' }}
            />
          </div>
          <p className="text-sm text-gray-500">
            Use the toolbar buttons above to insert HTML formatting. You can write HTML directly or use the buttons to add headings, bold text, lists, tables, links, and images. Click the Image button to upload and insert pictures into your report.
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