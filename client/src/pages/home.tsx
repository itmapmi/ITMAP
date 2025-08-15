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
              <img src={itmapLogo} alt="ITMAP" className="h-48 w-auto" />
            </div>
            <h1 className="text-4xl font-bold text-gray-900 sm:text-5xl md:text-6xl mb-8 max-w-5xl mx-auto leading-tight">
              Cut Through the Noise in Enterprise IT Vendor Evaluation
            </h1>
            <p className="text-xl text-gray-600 max-w-4xl mx-auto mb-12 leading-relaxed">
              ITMAP.com uses AI to analyze publicly available data, delivering vendor rankings, feature matrices, 
              and competitive insights — without hidden agendas.
            </p>
            <div className="mt-10 flex flex-col sm:flex-row gap-4 justify-center">
              <Link href="/markets">
                <Button size="lg" className="w-full sm:w-auto bg-gradient-to-r from-cyan-500 to-purple-600 hover:from-cyan-600 hover:to-purple-700 px-12 py-4 text-lg font-semibold">
                  Explore Vendor Evaluations
                </Button>
              </Link>
              <Link href="/login">
                <Button variant="outline" size="lg" className="w-full sm:w-auto border-2 border-gray-700 text-gray-700 hover:bg-gray-700 hover:text-white px-8 py-4 text-lg">
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
                One Stop Shop for Vendor Selection
              </h2>
            </motion.div>

            <motion.div 
              className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center mb-16"
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.5 }}
            >
              <div>
                <div className="space-y-6">
                  <div className="flex items-start">
                    <CheckCircle className="h-6 w-6 text-green-500 mt-0.5 mr-3 flex-shrink-0" />
                    <div>
                      <h4 className="font-semibold text-gray-900 mb-1">AI-Powered Analysis</h4>
                      <p className="text-gray-600">Independent research methodology using artificial intelligence to process public data</p>
                    </div>
                  </div>
                  <div className="flex items-start">
                    <CheckCircle className="h-6 w-6 text-green-500 mt-0.5 mr-3 flex-shrink-0" />
                    <div>
                      <h4 className="font-semibold text-gray-900 mb-1">Transparent Methodology</h4>
                      <p className="text-gray-600">Clear scoring criteria across execution and viability dimensions with public data sources</p>
                    </div>
                  </div>
                  <div className="flex items-start">
                    <CheckCircle className="h-6 w-6 text-green-500 mt-0.5 mr-3 flex-shrink-0" />
                    <div>
                      <h4 className="font-semibold text-gray-900 mb-1">Real-Time Intelligence</h4>
                      <p className="text-gray-600">Live updates based on authentic vendor news and market developments</p>
                    </div>
                  </div>
                </div>
              </div>
              <div className="bg-gradient-to-br from-cyan-50 to-purple-50 p-8 rounded-xl border border-gray-100">
                <BarChart3 className="h-16 w-16 text-cyan-600 mb-4" />
                <h4 className="text-xl font-semibold text-gray-900 mb-2">Interactive Vendor Evaluations</h4>
                <p className="text-gray-600">Explore vendor positioning with dynamic visualizations and drill-down capabilities</p>
              </div>
            </motion.div>

            <motion.div 
              className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8"
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.7 }}
            >
              <div className="text-center p-6 bg-white rounded-xl shadow-lg border border-gray-100">
                <BarChart3 className="h-12 w-12 text-cyan-500 mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-gray-900 mb-2">Vendor Evaluation Guide</h3>
                <p className="text-gray-600">
                  Instantly see which vendors lead the market.
                </p>
              </div>

              <div className="text-center p-6 bg-white rounded-xl shadow-lg border border-gray-100">
                <TrendingUp className="h-12 w-12 text-purple-500 mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-gray-900 mb-2">Live Market News</h3>
                <p className="text-gray-600">
                  Stay ahead with up-to-date enterprise IT coverage.
                </p>
              </div>

              <div className="text-center p-6 bg-white rounded-xl shadow-lg border border-gray-100">
                <Users className="h-12 w-12 text-blue-600 mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-gray-900 mb-2">Feature Support Matrix</h3>
                <p className="text-gray-600">
                  Quickly check product capabilities.
                </p>
              </div>

              <div className="text-center p-6 bg-white rounded-xl shadow-lg border border-gray-100">
                <Shield className="h-12 w-12 text-indigo-600 mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-gray-900 mb-2">Detailed Research Reports</h3>
                <p className="text-gray-600">
                  Dive deep into unbiased market analysis.
                </p>
              </div>
            </motion.div>
          </div>
        </div>

        {/* Why ITMAP is Different Section */}
        <div className="py-16 bg-white">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
            <motion.div 
              className="text-center"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.9 }}
            >
              <h2 className="text-3xl font-bold text-gray-900 mb-8 sm:text-4xl">
                Why ITMAP is Different
              </h2>
              <div className="bg-gradient-to-br from-cyan-50 to-purple-50 p-8 rounded-2xl border border-gray-100">
                <p className="text-xl text-gray-700 leading-relaxed mb-8">
                  Unlike traditional analyst firms, ITMAP's evaluations aren't influenced by paid vendor relationships. 
                  Every insight is based on public, verifiable data — processed and analyzed by AI.
                </p>
                <Link href="/markets">
                  <Button size="lg" className="bg-gradient-to-r from-cyan-500 to-purple-600 hover:from-cyan-600 hover:to-purple-700 px-12 py-4 text-lg font-semibold">
                    Explore Vendor Evaluations
                  </Button>
                </Link>
              </div>
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
