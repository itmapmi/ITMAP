import { useQuery } from "@tanstack/react-query";
import { useRoute } from "wouter";
import { MobileHeader } from "@/mobile/components/MobileHeader";
import { MobileCard, MobileCardContent, MobileCardHeader, MobileCardTitle } from "@/mobile/components/MobileCard";
import { MobileLoadingScreen } from "@/mobile/components/MobileLoadingSpinner";
import { CollapsibleSection } from "@/mobile/components/CollapsibleSection";
import { Building2, Globe, Info, TrendingUp } from "lucide-react";
import type { Vendor } from "@shared/schema";

export default function MobileVendorDetails() {
  const [, params] = useRoute("/mobile/vendors/:vendorId");
  const vendorId = params?.vendorId;

  const { data: vendor, isLoading } = useQuery<Vendor>({
    queryKey: ["/api/vendors", vendorId],
  });

  if (isLoading || !vendor) {
    return <MobileLoadingScreen message="Loading vendor details..." />;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <MobileHeader 
        title={vendor.name}
        subtitle="Vendor Profile"
        showBack
      />

      <div className="p-4 space-y-4">
        <MobileCard>
          <MobileCardContent className="py-6">
            <div className="text-center space-y-4">
              <div className="w-16 h-16 rounded-full bg-gradient-to-br from-blue-600 to-blue-700 flex items-center justify-center mx-auto">
                <Building2 className="h-8 w-8 text-white" />
              </div>
              <div>
                <h2 className="text-2xl font-bold text-gray-900">{vendor.name}</h2>
                {vendor.website && (
                  <a
                    href={vendor.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-700 text-sm mt-2"
                    data-testid="link-vendor-website"
                  >
                    <Globe className="h-4 w-4" />
                    {vendor.website.replace(/^https?:\/\//, '')}
                  </a>
                )}
              </div>
            </div>
          </MobileCardContent>
        </MobileCard>

        <CollapsibleSection
          title="About"
          icon={<Info className="h-5 w-5" />}
          defaultOpen={true}
          testId="section-about"
        >
          <div className="pt-3">
            <p className="text-sm text-gray-700">
              {vendor.description || "No description available for this vendor."}
            </p>
          </div>
        </CollapsibleSection>

        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <p className="text-sm text-blue-900 text-center">
            View full vendor evaluation and scores in the Markets section
          </p>
        </div>
      </div>
    </div>
  );
}
