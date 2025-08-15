import { useQuery } from "@tanstack/react-query";
import MarketGrid from "@/components/market-grid";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import type { Market } from "@shared/schema";
import { motion } from "framer-motion";
import { FadeInSection } from "@/components/ui/animated-card";
import { LoadingGrid, SkeletonCard } from "@/components/ui/loading-animations";
import { useAuth } from "@/hooks/useAuth";
import { Link } from "wouter";
import { BarChart3, TrendingUp, Users, Shield, CheckCircle, Play } from "lucide-react";
import itmapLogo from "@assets/ITMAP_logo_transparent_1755237362280.png";

export default function Home() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { data: markets, isLoading, error } = useQuery<Market[]>({
    queryKey: ["/api/markets"],
  });

  if (authLoading) {
    return <div className="min-h-screen bg-gray-50 flex items-center justify-center">Loading...</div>;
  }

  // Landing page for unauthenticated users
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-blue-50">
        {/* Hero Section */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
          <motion.div 
            className="text-center"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
          >
            <div className="flex justify-center mb-12">
              <img src={itmapLogo} alt="ITMAP" className="h-32 w-auto" />
            </div>
            <h1 className="text-5xl font-bold text-gray-900 sm:text-6xl md:text-7xl mb-6">
              Enterprise Technology Intelligence
            </h1>
            <div className="text-2xl text-blue-600 font-bold mb-8 tracking-wide">
              Unbiased. Comprehensive.
            </div>
            <p className="mt-3 max-w-3xl mx-auto text-lg text-gray-600 leading-relaxed">
              ITMAP delivers unbiased technology vendor analysis and comprehensive market intelligence. 
              Make informed decisions with our interactive Magic Quadrant visualizations, real-time competitive intelligence, 
              and detailed research reports.
            </p>
            <div className="mt-10 flex flex-col sm:flex-row gap-4 justify-center">
              <Link href="/register">
                <Button size="lg" className="w-full sm:w-auto bg-gradient-to-r from-teal-500 to-blue-600 hover:from-teal-600 hover:to-blue-700 text-white px-8 py-3">
                  Start Free Trial
                </Button>
              </Link>
              <Link href="/login">
                <Button variant="outline" size="lg" className="w-full sm:w-auto border-2 border-blue-600 text-blue-600 hover:bg-blue-600 hover:text-white px-8 py-3">
                  Sign In
                </Button>
              </Link>
            </div>
          </motion.div>
        </div>

        {/* Value Proposition Section */}
        <div className="py-16 bg-gradient-to-br from-blue-50 to-gray-50">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <motion.div 
              className="text-center mb-16"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.3 }}
            >
              <h2 className="text-3xl font-bold text-gray-900 sm:text-4xl mb-4">
                Why Technology Leaders Choose ITMAP
              </h2>
              <p className="text-xl text-gray-600 max-w-3xl mx-auto">
                Our platform combines deep market expertise with cutting-edge analytics to deliver actionable insights
              </p>
            </motion.div>

            <motion.div 
              className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center mb-16"
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.5 }}
            >
              <div>
                <h3 className="text-2xl font-bold text-gray-900 mb-6">Unbiased Analysis You Can Trust</h3>
                <div className="space-y-4">
                  <div className="flex items-start">
                    <CheckCircle className="h-6 w-6 text-green-500 mt-0.5 mr-3 flex-shrink-0" />
                    <p className="text-gray-600">Independent research methodology free from vendor influence</p>
                  </div>
                  <div className="flex items-start">
                    <CheckCircle className="h-6 w-6 text-green-500 mt-0.5 mr-3 flex-shrink-0" />
                    <p className="text-gray-600">Transparent scoring criteria across execution and viability dimensions</p>
                  </div>
                  <div className="flex items-start">
                    <CheckCircle className="h-6 w-6 text-green-500 mt-0.5 mr-3 flex-shrink-0" />
                    <p className="text-gray-600">Real-time updates based on authentic vendor news and developments</p>
                  </div>
                </div>
              </div>
              <div className="bg-gradient-to-br from-teal-50 to-blue-50 p-8 rounded-xl">
                <BarChart3 className="h-16 w-16 text-blue-600 mb-4" />
                <h4 className="text-xl font-semibold text-gray-900 mb-2">Interactive Magic Quadrants</h4>
                <p className="text-gray-600">Explore vendor positioning with dynamic visualizations and drill-down capabilities</p>
              </div>
            </motion.div>

            <motion.div 
              className="grid grid-cols-1 md:grid-cols-3 gap-8"
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.7 }}
            >
              <div className="text-center p-6 bg-gray-50 rounded-xl">
                <TrendingUp className="h-12 w-12 text-blue-600 mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-gray-900 mb-2">Market Intelligence</h3>
                <p className="text-gray-600">
                  AI-powered analysis of vendor news, market movements, and competitive dynamics
                </p>
              </div>

              <div className="text-center p-6 bg-gray-50 rounded-xl">
                <Users className="h-12 w-12 text-blue-600 mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-gray-900 mb-2">Competitive Analysis</h3>
                <p className="text-gray-600">
                  Side-by-side comparisons with feature matrices and capability assessments
                </p>
              </div>

              <div className="text-center p-6 bg-gray-50 rounded-xl">
                <Shield className="h-12 w-12 text-blue-600 mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-gray-900 mb-2">Research Reports</h3>
                <p className="text-gray-600">
                  Comprehensive market analysis with downloadable insights and recommendations
                </p>
              </div>
            </motion.div>
          </div>
        </div>

        {/* CTA Section */}
        <div className="py-16 bg-gradient-to-r from-teal-500 to-blue-600">
          <div className="max-w-4xl mx-auto text-center px-4 sm:px-6 lg:px-8">
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.9 }}
            >
              <h2 className="text-3xl font-bold text-white mb-4">
                Ready to Transform Your Technology Decisions?
              </h2>
              <p className="text-xl text-blue-100 mb-8">
                Join thousands of technology leaders who trust ITMAP for unbiased market intelligence
              </p>
              <Link href="/register">
                <Button size="lg" className="bg-white text-blue-600 hover:bg-gray-100 px-8 py-3 text-lg font-semibold">
                  Start Your Free Trial Today
                </Button>
              </Link>
            </motion.div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-red-600 mb-2">Error Loading Markets</h1>
          <p className="text-gray-600">Unable to fetch market data. Please try again later.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <FadeInSection className="mb-8">
        <motion.h1 
          className="text-3xl font-bold text-gray-900 mb-2"
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: "easeOut" }}
        >
          Technology Markets
        </motion.h1>
        <motion.p 
          className="text-gray-600"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2, ease: "easeOut" }}
        >
          Explore comprehensive analysis across technology sectors
        </motion.p>
      </FadeInSection>

      {isLoading ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4 }}
        >
          <LoadingGrid 
            columns={4} 
            rows={2} 
            className="grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
          />
        </motion.div>
      ) : markets && markets.length > 0 ? (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.3 }}
        >
          <MarketGrid markets={markets} />
        </motion.div>
      ) : (
        <motion.div 
          className="text-center py-12"
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, delay: 0.2 }}
        >
          <h2 className="text-xl font-semibold text-gray-900 mb-2">No Markets Available</h2>
          <p className="text-gray-600">Markets will appear here once they are added by administrators.</p>
        </motion.div>
      )}
    </div>
  );
}
