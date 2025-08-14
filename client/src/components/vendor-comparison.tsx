import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Download, ChevronDown, ChevronRight, FileText } from "lucide-react";
import type { Vendor, VendorScore, Criteria } from "@shared/schema";

interface VendorComparisonProps {
  marketId: string;
}

export default function VendorComparison({ marketId }: VendorComparisonProps) {
  const [selectedVendors, setSelectedVendors] = useState<string[]>([]);
  const [expandedNotes, setExpandedNotes] = useState<Record<string, boolean>>({});

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
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 mb-6">
          {vendors?.map(vendor => (
            <div key={vendor.id} className="flex items-center space-x-3">
              <Checkbox
                id={vendor.id}
                checked={selectedVendors.includes(vendor.id)}
                onCheckedChange={(checked) => handleVendorToggle(vendor.id, !!checked)}
              />
              <label 
                htmlFor={vendor.id}
                className="text-sm font-medium text-gray-700 cursor-pointer"
              >
                {vendor.name}
              </label>
            </div>
          ))}
        </div>

        {selectedVendorData.length >= 2 ? (
          <div>
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
            <div className="mt-4">
              <Button className="bg-primary-600 hover:bg-primary-700">
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
