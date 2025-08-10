import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import type { Vendor, Feature, VendorFeatureSupport } from "@shared/schema";

interface SupportMatrixProps {
  marketId: string;
}

interface HarveyBallProps {
  percentage: number;
  tooltip?: string;
}

function HarveyBall({ percentage, tooltip }: HarveyBallProps) {
  return (
    <Tooltip>
      <TooltipTrigger>
        <div className="harvey-ball mx-auto relative w-6 h-6 border-2 border-gray-400 rounded-full overflow-hidden bg-white">
          <div 
            className="harvey-fill absolute bottom-0 left-0 w-full bg-primary-500 transition-all duration-300"
            style={{ height: `${percentage}%` }}
          />
        </div>
      </TooltipTrigger>
      <TooltipContent>
        <p>{tooltip || `${percentage}% support`}</p>
      </TooltipContent>
    </Tooltip>
  );
}

export default function SupportMatrix({ marketId }: SupportMatrixProps) {
  const { data: vendors, isLoading: vendorsLoading } = useQuery<Vendor[]>({
    queryKey: ["/api/markets", marketId, "vendors"],
  });

  const { data: features, isLoading: featuresLoading } = useQuery<Feature[]>({
    queryKey: ["/api/markets", marketId, "features"],
  });

  const { data: featureSupport, isLoading: supportLoading } = useQuery<(VendorFeatureSupport & { vendor: Vendor; feature: Feature })[]>({
    queryKey: ["/api/markets", marketId, "feature-support"],
  });

  const getSupportLevel = (vendorId: string, featureId: string): VendorFeatureSupport | undefined => {
    return featureSupport?.find(fs => fs.vendorId === vendorId && fs.featureId === featureId);
  };

  if (vendorsLoading || featuresLoading || supportLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Feature Support Matrix</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-64 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!features || features.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Feature Support Matrix</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <p className="text-gray-500">No features available for this market.</p>
            <p className="text-sm text-gray-400 mt-2">Features will appear here once they are added by administrators.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Feature Support Matrix</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Feature</TableHead>
                {vendors?.map(vendor => (
                  <TableHead key={vendor.id} className="text-center min-w-[120px]">
                    {vendor.name}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {features.map(feature => (
                <TableRow key={feature.id}>
                  <TableCell className="font-medium">
                    <div>
                      <div>{feature.name}</div>
                      {feature.description && (
                        <div className="text-sm text-gray-500">{feature.description}</div>
                      )}
                    </div>
                  </TableCell>
                  {vendors?.map(vendor => {
                    const support = getSupportLevel(vendor.id, feature.id);
                    return (
                      <TableCell key={vendor.id} className="text-center">
                        <HarveyBall 
                          percentage={support?.supportLevel || 0}
                          tooltip={support?.comments || `${support?.supportLevel || 0}% support`}
                        />
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
