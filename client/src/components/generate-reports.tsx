import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { FileText, Download, Settings, Zap, BarChart3, Users, Calendar } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { Vendor } from "@shared/schema";

interface GenerateReportsProps {
  marketId: string;
}

interface ReportConfig {
  title: string;
  description: string;
  reportType: string;
  includedVendors: string[];
  includeVendorEvaluation: boolean;
  includeProductCapabilities: boolean;
  includeEcosystemSupport: boolean;
  includeVendorNews: boolean;
  includeMethodology: boolean;
  customSections: string[];
}

const REPORT_TYPES = [
  { value: 'vendor-analysis', label: 'Vendor Analysis Report', icon: Users, description: 'Comprehensive vendor comparison and positioning analysis' },
  { value: 'market-overview', label: 'Market Overview Report', icon: BarChart3, description: 'High-level market landscape and trends' },
  { value: 'executive-summary', label: 'Executive Summary', icon: FileText, description: 'Concise executive briefing with key insights' },
  { value: 'custom-report', label: 'Custom Report', icon: Settings, description: 'Fully customizable report with selected sections' }
];

export default function GenerateReports({ marketId }: GenerateReportsProps) {
  const { toast } = useToast();
  const [reportConfig, setReportConfig] = useState<ReportConfig>({
    title: '',
    description: '',
    reportType: '',
    includedVendors: [],
    includeVendorEvaluation: true,
    includeProductCapabilities: true,
    includeEcosystemSupport: false,
    includeVendorNews: false,
    includeMethodology: false,
    customSections: []
  });

  const { data: vendors, isLoading: vendorsLoading } = useQuery<Vendor[]>({
    queryKey: ["/api/markets", marketId, "vendors"],
  });

  const generateReportMutation = useMutation({
    mutationFn: async (config: ReportConfig) => {
      const response = await apiRequest(`/api/markets/${marketId}/generate-report`, 'POST', config);
      return response.blob();
    },
    onSuccess: (blob) => {
      // Download the generated report
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${reportConfig.title || 'Market Report'}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      
      toast({
        title: "Report Generated Successfully",
        description: `Your ${reportConfig.reportType} report has been downloaded.`,
      });
    },
    onError: () => {
      toast({
        title: "Report Generation Failed",
        description: "There was an error generating your report. Please try again.",
        variant: "destructive",
      });
    }
  });

  const handleVendorToggle = (vendorId: string) => {
    setReportConfig(prev => ({
      ...prev,
      includedVendors: prev.includedVendors.includes(vendorId)
        ? prev.includedVendors.filter(id => id !== vendorId)
        : [...prev.includedVendors, vendorId]
    }));
  };

  const handleGenerateReport = () => {
    if (!reportConfig.title || !reportConfig.reportType) {
      toast({
        title: "Missing Information",
        description: "Please provide a report title and select a report type.",
        variant: "destructive",
      });
      return;
    }
    
    generateReportMutation.mutate(reportConfig);
  };

  const selectedReportType = REPORT_TYPES.find(type => type.value === reportConfig.reportType);

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-6 w-6 text-blue-600" />
            Generate Reports
          </CardTitle>
          <CardDescription>
            Create custom market research reports with your selected vendors and analysis sections
          </CardDescription>
        </CardHeader>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Configuration Panel */}
        <div className="lg:col-span-2 space-y-6">
          {/* Basic Information */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Report Configuration</CardTitle>
              <CardDescription>Set up your report details and preferences</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="report-title">Report Title</Label>
                <Input
                  id="report-title"
                  placeholder="e.g., Cloud Storage Vendor Analysis Q4 2024"
                  value={reportConfig.title}
                  onChange={(e) => setReportConfig(prev => ({ ...prev, title: e.target.value }))}
                  data-testid="input-report-title"
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="report-description">Description (Optional)</Label>
                <Textarea
                  id="report-description"
                  placeholder="Brief description of the report purpose and scope"
                  value={reportConfig.description}
                  onChange={(e) => setReportConfig(prev => ({ ...prev, description: e.target.value }))}
                  data-testid="textarea-report-description"
                />
              </div>

              <div className="space-y-2">
                <Label>Report Type</Label>
                <Select
                  value={reportConfig.reportType}
                  onValueChange={(value) => setReportConfig(prev => ({ ...prev, reportType: value }))}
                >
                  <SelectTrigger data-testid="select-report-type">
                    <SelectValue placeholder="Select report type" />
                  </SelectTrigger>
                  <SelectContent>
                    {REPORT_TYPES.map((type) => (
                      <SelectItem key={type.value} value={type.value}>
                        <div className="flex items-center gap-2">
                          <type.icon className="h-4 w-4" />
                          {type.label}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                
                {selectedReportType && (
                  <p className="text-sm text-gray-600">{selectedReportType.description}</p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Vendor Selection */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Vendor Selection</CardTitle>
              <CardDescription>Choose which vendors to include in your report</CardDescription>
            </CardHeader>
            <CardContent>
              {vendorsLoading ? (
                <div className="text-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
                  <p className="text-gray-500 mt-2">Loading vendors...</p>
                </div>
              ) : vendors && vendors.length > 0 ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">
                      {reportConfig.includedVendors.length} of {vendors.length} vendors selected
                    </span>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setReportConfig(prev => ({ ...prev, includedVendors: vendors.map(v => v.id) }))}
                        data-testid="button-select-all-vendors"
                      >
                        Select All
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setReportConfig(prev => ({ ...prev, includedVendors: [] }))}
                        data-testid="button-clear-vendors"
                      >
                        Clear
                      </Button>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {vendors.map((vendor) => (
                      <div
                        key={vendor.id}
                        className="flex items-center space-x-3 p-3 border rounded-lg hover:bg-gray-50"
                      >
                        <Checkbox
                          id={`vendor-${vendor.id}`}
                          checked={reportConfig.includedVendors.includes(vendor.id)}
                          onCheckedChange={() => handleVendorToggle(vendor.id)}
                          data-testid={`checkbox-vendor-${vendor.id}`}
                        />
                        <Label htmlFor={`vendor-${vendor.id}`} className="flex-1 cursor-pointer">
                          {vendor.name}
                        </Label>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="text-center py-8">
                  <Users className="mx-auto h-12 w-12 text-gray-400 mb-4" />
                  <p className="text-gray-500">No vendors available for this market</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Content Sections */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Content Sections</CardTitle>
              <CardDescription>Select which analysis sections to include</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3">
                <div className="flex items-center space-x-3">
                  <Checkbox
                    id="include-vendor-evaluation"
                    checked={reportConfig.includeVendorEvaluation}
                    onCheckedChange={(checked) => 
                      setReportConfig(prev => ({ ...prev, includeVendorEvaluation: checked as boolean }))
                    }
                    data-testid="checkbox-vendor-evaluation"
                  />
                  <Label htmlFor="include-vendor-evaluation" className="flex-1 cursor-pointer">
                    <div>
                      <div className="font-medium">Vendor Evaluation</div>
                      <div className="text-sm text-gray-600">Magic quadrant positioning and competitive analysis</div>
                    </div>
                  </Label>
                </div>

                <div className="flex items-center space-x-3">
                  <Checkbox
                    id="include-product-capabilities"
                    checked={reportConfig.includeProductCapabilities}
                    onCheckedChange={(checked) => 
                      setReportConfig(prev => ({ ...prev, includeProductCapabilities: checked as boolean }))
                    }
                    data-testid="checkbox-product-capabilities"
                  />
                  <Label htmlFor="include-product-capabilities" className="flex-1 cursor-pointer">
                    <div>
                      <div className="font-medium">Product Capabilities</div>
                      <div className="text-sm text-gray-600">Feature comparison and support matrix</div>
                    </div>
                  </Label>
                </div>

                <div className="flex items-center space-x-3">
                  <Checkbox
                    id="include-ecosystem-support"
                    checked={reportConfig.includeEcosystemSupport}
                    onCheckedChange={(checked) => 
                      setReportConfig(prev => ({ ...prev, includeEcosystemSupport: checked as boolean }))
                    }
                    data-testid="checkbox-ecosystem-support"
                  />
                  <Label htmlFor="include-ecosystem-support" className="flex-1 cursor-pointer">
                    <div>
                      <div className="font-medium">Ecosystem Support</div>
                      <div className="text-sm text-gray-600">Third-party integrations and partnerships</div>
                    </div>
                  </Label>
                </div>

                <div className="flex items-center space-x-3">
                  <Checkbox
                    id="include-vendor-news"
                    checked={reportConfig.includeVendorNews}
                    onCheckedChange={(checked) => 
                      setReportConfig(prev => ({ ...prev, includeVendorNews: checked as boolean }))
                    }
                    data-testid="checkbox-vendor-news"
                  />
                  <Label htmlFor="include-vendor-news" className="flex-1 cursor-pointer">
                    <div>
                      <div className="font-medium">Recent Vendor News</div>
                      <div className="text-sm text-gray-600">Latest announcements and market developments</div>
                    </div>
                  </Label>
                </div>

                <div className="flex items-center space-x-3">
                  <Checkbox
                    id="include-methodology"
                    checked={reportConfig.includeMethodology}
                    onCheckedChange={(checked) => 
                      setReportConfig(prev => ({ ...prev, includeMethodology: checked as boolean }))
                    }
                    data-testid="checkbox-methodology"
                  />
                  <Label htmlFor="include-methodology" className="flex-1 cursor-pointer">
                    <div>
                      <div className="font-medium">Research Methodology</div>
                      <div className="text-sm text-gray-600">Evaluation criteria and scoring methodology</div>
                    </div>
                  </Label>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Preview and Actions */}
        <div className="space-y-6">
          {/* Report Preview */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Report Preview</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {reportConfig.title && (
                <div>
                  <div className="font-medium text-gray-900">{reportConfig.title}</div>
                  {reportConfig.description && (
                    <div className="text-sm text-gray-600 mt-1">{reportConfig.description}</div>
                  )}
                </div>
              )}

              {selectedReportType && (
                <div className="flex items-center gap-2">
                  <selectedReportType.icon className="h-4 w-4 text-blue-600" />
                  <Badge variant="secondary">{selectedReportType.label}</Badge>
                </div>
              )}

              <Separator />

              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">Vendors:</span>
                  <span className="font-medium">{reportConfig.includedVendors.length}</span>
                </div>
                
                <div className="flex justify-between">
                  <span className="text-gray-600">Sections:</span>
                  <span className="font-medium">
                    {[
                      reportConfig.includeVendorEvaluation && 'Vendor Evaluation',
                      reportConfig.includeProductCapabilities && 'Product Capabilities',
                      reportConfig.includeEcosystemSupport && 'Ecosystem Support',
                      reportConfig.includeVendorNews && 'Vendor News',
                      reportConfig.includeMethodology && 'Methodology'
                    ].filter(Boolean).length}
                  </span>
                </div>

                <div className="flex justify-between">
                  <span className="text-gray-600">Generated:</span>
                  <span className="font-medium flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    {new Date().toLocaleDateString()}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Generate Button */}
          <Card>
            <CardContent className="pt-6">
              <Button
                onClick={handleGenerateReport}
                disabled={generateReportMutation.isPending || !reportConfig.title || !reportConfig.reportType}
                className="w-full"
                size="lg"
                data-testid="button-generate-report"
              >
                {generateReportMutation.isPending ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                    Generating...
                  </>
                ) : (
                  <>
                    <Download className="mr-2 h-4 w-4" />
                    Generate Report
                  </>
                )}
              </Button>
              
              <p className="text-xs text-gray-500 text-center mt-2">
                Report will be generated as a PDF file
              </p>
            </CardContent>
          </Card>

          {/* Quick Templates */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Quick Templates</CardTitle>
              <CardDescription>Pre-configured report templates</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start"
                onClick={() => setReportConfig(prev => ({
                  ...prev,
                  title: 'Executive Summary Report',
                  reportType: 'executive-summary',
                  includeVendorEvaluation: true,
                  includeProductCapabilities: true,
                  includeEcosystemSupport: false,
                  includeVendorNews: false,
                  includeMethodology: false
                }))}
                data-testid="button-template-executive"
              >
                <FileText className="mr-2 h-4 w-4" />
                Executive Summary
              </Button>
              
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start"
                onClick={() => setReportConfig(prev => ({
                  ...prev,
                  title: 'Comprehensive Vendor Analysis',
                  reportType: 'vendor-analysis',
                  includeVendorEvaluation: true,
                  includeProductCapabilities: true,
                  includeEcosystemSupport: true,
                  includeVendorNews: true,
                  includeMethodology: true
                }))}
                data-testid="button-template-comprehensive"
              >
                <BarChart3 className="mr-2 h-4 w-4" />
                Comprehensive Analysis
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}