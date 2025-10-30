import { useQuery } from "@tanstack/react-query";
import { MobileHeader } from "@/mobile/components/MobileHeader";
import { MobileCard, MobileCardContent, MobileCardHeader, MobileCardTitle } from "@/mobile/components/MobileCard";
import { MobileLoadingSpinner } from "@/mobile/components/MobileLoadingSpinner";
import { MobileEmptyState } from "@/mobile/components/MobileEmptyState";
import { Link } from "wouter";
import { Building2, ChevronRight } from "lucide-react";
import type { Vendor } from "@shared/schema";

export default function MobileVendors() {
  const { data: allVendors, isLoading } = useQuery<Vendor[]>({
    queryKey: ["/api/vendors"],
  });

  const vendors = allVendors?.sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="min-h-screen bg-gray-50">
      <MobileHeader 
        title="Vendors"
        subtitle="Technology Providers"
      />

      <div className="p-4 space-y-3">
        {isLoading ? (
          <MobileLoadingSpinner />
        ) : !vendors || vendors.length === 0 ? (
          <MobileEmptyState
            icon={Building2}
            title="No Vendors Available"
            description="There are no vendors to display at this time."
          />
        ) : (
          <>
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
              <p className="text-sm text-blue-900">
                <strong>{vendors.length}</strong> vendors available
              </p>
            </div>
            
            {vendors.map((vendor) => (
              <Link key={vendor.id} href={`/mobile/vendors/${vendor.id}`}>
                <a data-testid={`link-vendor-${vendor.id}`}>
                  <MobileCard className="hover:shadow-md transition-shadow">
                    <MobileCardContent className="py-4">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center flex-shrink-0">
                            <Building2 className="h-5 w-5 text-white" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <h3 className="font-semibold text-gray-900 truncate">{vendor.name}</h3>
                            {vendor.website && (
                              <p className="text-xs text-gray-500 truncate mt-0.5">{vendor.website.replace(/^https?:\/\//, '')}</p>
                            )}
                          </div>
                        </div>
                        <ChevronRight className="h-5 w-5 text-gray-400 flex-shrink-0" />
                      </div>
                    </MobileCardContent>
                  </MobileCard>
                </a>
              </Link>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
