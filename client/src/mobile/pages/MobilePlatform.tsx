import { ArrowLeft, Shield, Target, Users, Zap, TrendingUp, Award } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { MobileCard, MobileCardHeader, MobileCardTitle, MobileCardDescription } from "@/mobile/components/MobileCard";

export default function MobilePlatform() {
  const features = [
    {
      icon: Target,
      title: "Unbiased Intelligence",
      description: "Independent, comprehensive market research free from vendor influence."
    },
    {
      icon: TrendingUp,
      title: "Vendor Evaluation",
      description: "Interactive visualizations and detailed competitive analysis across technology markets."
    },
    {
      icon: Zap,
      title: "Real-time Updates",
      description: "AI-powered news analysis and automated vendor score updates based on market developments."
    },
    {
      icon: Users,
      title: "ISV Ecosystem",
      description: "Track third-party integrations and partner ecosystems for comprehensive vendor evaluation."
    },
    {
      icon: Award,
      title: "Product Evaluation",
      description: "Detailed feature-by-feature analysis with support matrices and capability scoring."
    },
    {
      icon: Shield,
      title: "Enterprise-Grade",
      description: "Built for technology leaders making critical vendor selection decisions."
    }
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="p-4 flex items-center gap-3">
          <Link href="/mobile/dashboard">
            <a data-testid="button-back">
              <Button variant="ghost" size="sm" className="p-2">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </a>
          </Link>
          <h1 className="text-xl font-bold text-gray-900">Platform</h1>
        </div>
      </div>

      {/* Hero Section */}
      <div className="p-4">
        <div className="bg-gradient-to-br from-blue-600 to-blue-700 rounded-lg p-6 text-white shadow-lg mb-6">
          <h2 className="text-2xl font-bold mb-2">ITMAP Platform</h2>
          <p className="text-blue-100 text-sm leading-relaxed">
            Your trusted source for technology market intelligence. Empowering enterprise decisions with comprehensive, unbiased research.
          </p>
        </div>

        {/* Mission Statement */}
        <MobileCard className="mb-6">
          <MobileCardHeader>
            <MobileCardTitle>Our Mission</MobileCardTitle>
            <MobileCardDescription className="mt-2 text-base leading-relaxed">
              MarketScope delivers enterprise-grade market research designed for technology vendor analysis. 
              We provide independent, data-driven intelligence to help organizations navigate complex technology markets 
              and make informed vendor selection decisions.
            </MobileCardDescription>
          </MobileCardHeader>
        </MobileCard>

        {/* Features */}
        <div className="mb-4">
          <h3 className="text-lg font-semibold text-gray-900 mb-3">Platform Features</h3>
          <div className="space-y-3">
            {features.map((feature, index) => {
              const Icon = feature.icon;
              return (
                <MobileCard key={index} data-testid={`card-feature-${index}`}>
                  <MobileCardHeader>
                    <div className="flex items-start gap-3">
                      <div className="bg-blue-100 p-2 rounded-lg flex-shrink-0">
                        <Icon className="h-5 w-5 text-blue-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <MobileCardTitle className="text-base">{feature.title}</MobileCardTitle>
                        <MobileCardDescription className="mt-1">
                          {feature.description}
                        </MobileCardDescription>
                      </div>
                    </div>
                  </MobileCardHeader>
                </MobileCard>
              );
            })}
          </div>
        </div>

        {/* Why Choose Us */}
        <MobileCard className="mb-6">
          <MobileCardHeader>
            <MobileCardTitle>Why Choose MarketScope?</MobileCardTitle>
            <div className="mt-3 space-y-3">
              <div className="flex items-start gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-blue-600 mt-2 flex-shrink-0" />
                <p className="text-sm text-gray-700">
                  <strong>Independent Research:</strong> No vendor bias or influence in our analysis
                </p>
              </div>
              <div className="flex items-start gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-blue-600 mt-2 flex-shrink-0" />
                <p className="text-sm text-gray-700">
                  <strong>Comprehensive Coverage:</strong> Deep market insights across multiple technology segments
                </p>
              </div>
              <div className="flex items-start gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-blue-600 mt-2 flex-shrink-0" />
                <p className="text-sm text-gray-700">
                  <strong>AI-Powered Analysis:</strong> Automated news processing and intelligent impact scoring
                </p>
              </div>
              <div className="flex items-start gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-blue-600 mt-2 flex-shrink-0" />
                <p className="text-sm text-gray-700">
                  <strong>Enterprise Focus:</strong> Built specifically for technology leaders and decision makers
                </p>
              </div>
            </div>
          </MobileCardHeader>
        </MobileCard>

        {/* CTA */}
        <div className="text-center pb-6">
          <Link href="/mobile/dashboard">
            <a data-testid="button-explore-markets">
              <Button className="w-full bg-blue-600 hover:bg-blue-700 text-white">
                Explore Markets
              </Button>
            </a>
          </Link>
        </div>
      </div>
    </div>
  );
}
