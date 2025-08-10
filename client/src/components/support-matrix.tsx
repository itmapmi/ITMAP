import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import type { Feature, Vendor, VendorFeatureSupport } from "@shared/schema";

interface SupportMatrixProps {
  marketId: string;
}

// Harvey Ball icons representing different support levels
const HarveyBall = ({ level }: { level: number }) => {
  const getHarveyBallIcon = (level: number) => {
    switch (level) {
      case 0: return "○"; // Empty circle - No support
      case 1: return "◔"; // Quarter filled - Limited support
      case 2: return "◑"; // Half filled - Partial support
      case 3: return "◕"; // Three quarters filled - Good support
      case 4: return "●"; // Full circle - Full support
      default: return "○";
    }
  };

  const getHarveyBallColor = (level: number) => {
    switch (level) {
      case 0: return "text-gray-300";
      case 1: return "text-red-500";
      case 2: return "text-yellow-500";
      case 3: return "text-blue-500";
      case 4: return "text-green-500";
      default: return "text-gray-300";
    }
  };

  const getSupportText = (level: number) => {
    switch (level) {
      case 0: return "No Support";
      case 1: return "Limited";
      case 2: return "Partial";
      case 3: return "Good";
      case 4: return "Full Support";
      default: return "Unknown";
    }
  };

  return (
    <div className="flex items-center justify-center">
      <span 
        className={`text-2xl ${getHarveyBallColor(level)}`}
        title={getSupportText(level)}
      >
        {getHarveyBallIcon(level)}
      </span>
    </div>
  );
};

export default function SupportMatrix({ marketId }: SupportMatrixProps) {
  const { data: features, isLoading: featuresLoading } = useQuery<Feature[]>({
    queryKey: ["/api/markets", marketId, "features"],
  });

  const { data: vendors, isLoading: vendorsLoading } = useQuery<Vendor[]>({
    queryKey: ["/api/markets", marketId, "vendors"],
  });

  const { data: supportMatrix, isLoading: supportLoading } = useQuery<VendorFeatureSupport[]>({
    queryKey: ["/api/markets", marketId, "feature-support"],
  });

  const isLoading = featuresLoading || vendorsLoading || supportLoading;

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Feature Support Matrix</CardTitle>
          <CardDescription>Harvey ball indicators showing vendor feature support levels</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="flex space-x-4">
                <Skeleton className="h-8 w-48" />
                <div className="flex space-x-2">
                  {[...Array(3)].map((_, j) => (
                    <Skeleton key={j} className="h-8 w-8 rounded-full" />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!features || !vendors || !supportMatrix) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Feature Support Matrix</CardTitle>
          <CardDescription>Harvey ball indicators showing vendor feature support levels</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-gray-500">No feature support data available for this market.</p>
        </CardContent>
      </Card>
    );
  }

  // Create support lookup map
  const supportLookup = new Map<string, number>();
  supportMatrix.forEach(support => {
    const key = `${support.vendorId}-${support.featureId}`;
    supportLookup.set(key, support.supportLevel);
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Feature Support Matrix</CardTitle>
        <CardDescription>
          Harvey ball indicators showing vendor feature support levels (● Full, ◕ Good, ◑ Partial, ◔ Limited, ○ None)
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <div className="min-w-full">
            {/* Header with vendor names */}
            <div className="grid gap-4 mb-6" style={{ gridTemplateColumns: `300px repeat(${vendors.length}, 120px)` }}>
              <div className="font-semibold text-sm text-gray-600 flex items-center">
                Features
              </div>
              {vendors.map(vendor => (
                <div key={vendor.id} className="text-center">
                  <div className="font-medium text-sm text-gray-900 mb-1">
                    {vendor.name}
                  </div>
                  <Badge variant="outline" className="text-xs">
                    Vendor
                  </Badge>
                </div>
              ))}
            </div>

            {/* Feature rows */}
            <div className="space-y-3">
              {features.map(feature => (
                <div 
                  key={feature.id} 
                  className="grid gap-4 py-3 border-b border-gray-100 hover:bg-gray-50 rounded-lg px-2"
                  style={{ gridTemplateColumns: `300px repeat(${vendors.length}, 120px)` }}
                >
                  <div className="flex flex-col justify-center">
                    <div className="font-medium text-sm text-gray-900">
                      {feature.name}
                    </div>
                    {feature.description && (
                      <div className="text-xs text-gray-500 mt-1">
                        {feature.description}
                      </div>
                    )}
                    <Badge variant="secondary" className="text-xs w-fit mt-2">
                      {feature.category}
                    </Badge>
                  </div>
                  
                  {vendors.map(vendor => {
                    const supportKey = `${vendor.id}-${feature.id}`;
                    const supportLevel = supportLookup.get(supportKey) || 0;
                    
                    return (
                      <div key={vendor.id} className="flex justify-center items-center">
                        <HarveyBall level={supportLevel} />
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>

            {features.length === 0 && (
              <div className="text-center py-12">
                <p className="text-gray-500">No features defined for this market yet.</p>
              </div>
            )}
          </div>
        </div>

        {/* Legend */}
        <div className="mt-8 pt-6 border-t border-gray-200">
          <h4 className="font-medium text-sm text-gray-900 mb-3">Harvey Ball Legend</h4>
          <div className="flex flex-wrap gap-4 text-sm">
            <div className="flex items-center gap-2">
              <HarveyBall level={4} />
              <span className="text-gray-600">Full Support</span>
            </div>
            <div className="flex items-center gap-2">
              <HarveyBall level={3} />
              <span className="text-gray-600">Good Support</span>
            </div>
            <div className="flex items-center gap-2">
              <HarveyBall level={2} />
              <span className="text-gray-600">Partial Support</span>
            </div>
            <div className="flex items-center gap-2">
              <HarveyBall level={1} />
              <span className="text-gray-600">Limited Support</span>
            </div>
            <div className="flex items-center gap-2">
              <HarveyBall level={0} />
              <span className="text-gray-600">No Support</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}