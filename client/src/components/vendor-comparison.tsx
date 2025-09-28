import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Download, ChevronDown, ChevronRight, FileText } from "lucide-react";
import { useMobile } from "@/hooks/use-mobile";
import type { Vendor, VendorScore, Criteria } from "@shared/schema";

interface VendorComparisonProps {
  marketId: string;
}

export default function VendorComparison({ marketId }: VendorComparisonProps) {
  const [selectedVendors, setSelectedVendors] = useState<string[]>([]);
  const [expandedNotes, setExpandedNotes] = useState<Record<string, boolean>>({});
  const isMobile = useMobile();

  const { data: vendors } = useQuery<Vendor[]>({
    queryKey: ["/api/markets", marketId, "vendors"],
  });

  const { data: scores } = useQuery<(VendorScore & { vendor: Vendor; criteria: Criteria })[]>({
    queryKey: ["/api/markets", marketId, "scores"],
  });

  const { data: criteria } = useQuery<Criteria[]>({
    queryKey: ["/api/criteria"],
  });

  const handleVendorToggle = (vendorId: string, checked: boolean) => {
    if (checked) {
      setSelectedVendors(prev => [...prev, vendorId]);
    } else {
      setSelectedVendors(prev => prev.filter(id => id !== vendorId));
    }
  };

  const getVendorScore = (vendorId: string, criteriaId: string): number => {
    const score = scores?.find(s => s.vendorId === vendorId && s.criteriaId === criteriaId);
    return score?.score ? parseFloat(score.score.toString()) : 0;
  };

  const getVendorNotes = (vendorId: string, criteriaId: string): string => {
    const score = scores?.find(s => s.vendorId === vendorId && s.criteriaId === criteriaId);
    return score?.notes || "";
  };

  const toggleNotes = (criteriaId: string) => {
    setExpandedNotes(prev => ({
      ...prev,
      [criteriaId]: !prev[criteriaId]
    }));
  };

  const hasNotesForCriteria = (criteriaId: string): boolean => {
    return selectedVendorData.some(vendor => 
      getVendorNotes(vendor.id, criteriaId).trim() !== ""
    );
  };

  const selectedVendorData = vendors?.filter(vendor => selectedVendors.includes(vendor.id)) || [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Compare Vendors</CardTitle>
      </CardHeader>
      <CardContent>
        <div className={`grid gap-4 mb-6 ${isMobile ? 'grid-cols-1' : 'grid-cols-2 md:grid-cols-3 lg:grid-cols-4'}`}>
          {vendors?.map(vendor => (
            <div key={vendor.id} className={`flex items-center space-x-3 ${isMobile ? 'p-3 bg-gray-50 rounded-lg' : ''}`}>
              <Checkbox
                id={vendor.id}
                checked={selectedVendors.includes(vendor.id)}
                onCheckedChange={(checked) => handleVendorToggle(vendor.id, !!checked)}
                className={isMobile ? 'w-5 h-5' : ''}
                data-testid={`checkbox-vendor-${vendor.id}`}
              />
              <label 
                htmlFor={vendor.id}
                className={`font-medium text-gray-700 cursor-pointer ${isMobile ? 'text-base' : 'text-sm'}`}
              >
                {vendor.name}
              </label>
            </div>
          ))}
        </div>

        {selectedVendorData.length >= 2 ? (
          <div>
            {/* Desktop Table */}
            {!isMobile && (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Criteria</TableHead>
                      {selectedVendorData.map(vendor => (
                        <TableHead key={vendor.id}>{vendor.name}</TableHead>
                      ))}
                      <TableHead className="text-center">Notes</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {criteria?.map(criterion => {
                      const isExpanded = expandedNotes[criterion.id];
                      const hasNotes = hasNotesForCriteria(criterion.id);
                      
                      return (
                        <>
                          <TableRow key={criterion.id}>
                            <TableCell className="font-medium">{criterion.name}</TableCell>
                            {selectedVendorData.map(vendor => (
                              <TableCell key={vendor.id} className="text-center">
                                <span className="font-semibold">
                                  {getVendorScore(vendor.id, criterion.id)}
                                </span>
                              </TableCell>
                            ))}
                            <TableCell className="text-center">
                              {hasNotes && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => toggleNotes(criterion.id)}
                                  className="h-6 px-2 text-xs text-blue-600 hover:text-blue-800"
                                >
                                  <FileText className="mr-1 h-3 w-3" />
                                  View Notes
                                  {isExpanded ? (
                                    <ChevronDown className="ml-1 h-3 w-3" />
                                  ) : (
                                    <ChevronRight className="ml-1 h-3 w-3" />
                                  )}
                                </Button>
                              )}
                            </TableCell>
                          </TableRow>
                          
                          {hasNotes && isExpanded && (
                            <TableRow>
                              <TableCell colSpan={selectedVendorData.length + 2} className="p-4 bg-gray-50 dark:bg-gray-800">
                                <div className="space-y-3">
                                  {selectedVendorData.map(vendor => {
                                    const notes = getVendorNotes(vendor.id, criterion.id);
                                    if (!notes.trim()) return null;
                                    
                                    return (
                                      <div key={vendor.id} className="border-l-3 border-blue-500 pl-3">
                                        <div className="font-medium text-sm text-blue-700 dark:text-blue-300 mb-1">
                                          {vendor.name}
                                        </div>
                                        <div className="text-sm text-gray-600 dark:text-gray-300 whitespace-pre-wrap">
                                          {notes}
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </TableCell>
                            </TableRow>
                          )}
                        </>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
            
            {/* Mobile Card Layout */}
            {isMobile && (
              <div className="space-y-4">
                {criteria?.map(criterion => {
                  const isExpanded = expandedNotes[criterion.id];
                  const hasNotes = hasNotesForCriteria(criterion.id);
                  
                  return (
                    <div key={criterion.id} className="border border-gray-200 rounded-lg p-4 bg-white shadow-sm">
                      <div className="mb-4">
                        <div className="font-medium text-base text-gray-900 mb-3">
                          {criterion.name}
                        </div>
                        
                        <div className="space-y-3">
                          {selectedVendorData.map(vendor => (
                            <div key={vendor.id} className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
                              <span className="font-medium text-sm text-gray-800">
                                {vendor.name}
                              </span>
                              <span className="font-bold text-lg text-blue-600">
                                {getVendorScore(vendor.id, criterion.id)}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                      
                      {hasNotes && (
                        <div className="border-t border-gray-200 pt-3">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => toggleNotes(criterion.id)}
                            className="w-full justify-center text-blue-600 hover:text-blue-800 hover:bg-blue-50"
                            data-testid={`button-notes-${criterion.id}`}
                          >
                            <FileText className="mr-2 h-4 w-4" />
                            {isExpanded ? 'Hide Notes' : 'View Notes'}
                            {isExpanded ? (
                              <ChevronDown className="ml-2 h-4 w-4" />
                            ) : (
                              <ChevronRight className="ml-2 h-4 w-4" />
                            )}
                          </Button>
                          
                          {isExpanded && (
                            <div className="mt-3 pt-3 bg-gray-50 rounded-lg p-3">
                              <div className="space-y-3">
                                {selectedVendorData.map(vendor => {
                                  const notes = getVendorNotes(vendor.id, criterion.id);
                                  if (!notes.trim()) return null;
                                  
                                  return (
                                    <div key={vendor.id} className="border-l-4 border-blue-500 pl-3">
                                      <div className="font-medium text-sm text-blue-700 mb-1">
                                        {vendor.name}
                                      </div>
                                      <div className="text-sm text-gray-600 whitespace-pre-wrap">
                                        {notes}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            
            <div className="mt-4">
              <Button 
                className={`bg-primary-600 hover:bg-primary-700 ${isMobile ? 'w-full' : ''}`}
                size={isMobile ? "default" : "default"}
                data-testid="button-detailed-report"
              >
                <Download className="mr-2 h-4 w-4" />
                View Detailed Report
              </Button>
            </div>
          </div>
        ) : (
          <div className="text-center py-8 text-gray-500">
            Select at least 2 vendors to compare their scores
          </div>
        )}
      </CardContent>
    </Card>
  );
}
