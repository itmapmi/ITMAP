import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { FileDown, Users, CheckCircle2 } from "lucide-react";
import type { Vendor } from "@shared/schema";

interface VendorSelectionModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vendors: Vendor[];
  onGenerate: (selectedVendorIds: string[]) => void;
  title: string;
  description: string;
  isGenerating?: boolean;
}

export function VendorSelectionModal({
  open,
  onOpenChange,
  vendors,
  onGenerate,
  title,
  description,
  isGenerating = false
}: VendorSelectionModalProps) {
  const [selectedVendorIds, setSelectedVendorIds] = useState<string[]>([]);

  const handleSelectAll = () => {
    if (selectedVendorIds.length === vendors.length) {
      setSelectedVendorIds([]);
    } else {
      setSelectedVendorIds(vendors.map(v => v.id));
    }
  };

  const toggleVendor = (vendorId: string) => {
    setSelectedVendorIds(prev => 
      prev.includes(vendorId)
        ? prev.filter(id => id !== vendorId)
        : [...prev, vendorId]
    );
  };

  const handleGenerate = () => {
    onGenerate(selectedVendorIds);
    setSelectedVendorIds([]);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileDown className="h-5 w-5 text-blue-600" />
            {title}
          </DialogTitle>
          <p className="text-sm text-gray-600 mt-2">{description}</p>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Select All Option */}
          <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-200">
            <Label className="flex items-center gap-2 cursor-pointer" htmlFor="select-all">
              <CheckCircle2 className="h-4 w-4 text-blue-600" />
              <span className="font-medium">
                {selectedVendorIds.length === vendors.length ? 'Deselect All' : 'Select All Vendors'}
              </span>
            </Label>
            <Checkbox
              id="select-all"
              checked={selectedVendorIds.length === vendors.length}
              onCheckedChange={handleSelectAll}
              data-testid="checkbox-select-all-vendors"
            />
          </div>

          {/* Vendor List */}
          <div className="border rounded-lg">
            <ScrollArea className="h-[300px]">
              <div className="p-4 space-y-2">
                {vendors.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    <Users className="h-12 w-12 mx-auto mb-2 text-gray-300" />
                    <p>No vendors available for this market</p>
                  </div>
                ) : (
                  vendors.map((vendor) => (
                    <div
                      key={vendor.id}
                      className="flex items-center justify-between p-3 hover:bg-gray-50 rounded-lg border border-transparent hover:border-gray-200 transition-colors"
                    >
                      <Label
                        htmlFor={`vendor-${vendor.id}`}
                        className="flex-1 cursor-pointer"
                      >
                        <div>
                          <div className="font-medium text-gray-900">{vendor.name}</div>
                          {vendor.description && (
                            <div className="text-xs text-gray-500 mt-0.5 line-clamp-1">
                              {vendor.description}
                            </div>
                          )}
                        </div>
                      </Label>
                      <Checkbox
                        id={`vendor-${vendor.id}`}
                        checked={selectedVendorIds.includes(vendor.id)}
                        onCheckedChange={() => toggleVendor(vendor.id)}
                        data-testid={`checkbox-vendor-${vendor.id}`}
                      />
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>
          </div>

          {/* Selection Summary */}
          {selectedVendorIds.length > 0 && (
            <div className="flex items-center gap-2 text-sm text-blue-600 bg-blue-50 p-3 rounded-lg">
              <CheckCircle2 className="h-4 w-4" />
              <span className="font-medium">
                {selectedVendorIds.length} vendor{selectedVendorIds.length !== 1 ? 's' : ''} selected
              </span>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isGenerating}
            data-testid="button-cancel-report"
          >
            Cancel
          </Button>
          <Button
            onClick={handleGenerate}
            disabled={selectedVendorIds.length === 0 || isGenerating}
            data-testid="button-generate-report"
          >
            {isGenerating ? (
              <>
                <span className="animate-spin mr-2">⏳</span>
                Generating...
              </>
            ) : (
              <>
                <FileDown className="h-4 w-4 mr-2" />
                Generate Report
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
