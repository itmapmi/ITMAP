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
import { BarChart3, TrendingUp, Users, Shield } from "lucide-react";

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
      <div className="min-h-screen bg-gray-50">
        {/* Hero Section */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
          <motion.div 
            className="text-center"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
          >
            <h1 className="text-4xl font-bold text-gray-900 sm:text-5xl md:text-6xl">
              Enterprise Market
              <span className="text-blue-600"> Intelligence</span>
            </h1>
            <p className="mt-3 max-w-md mx-auto text-base text-gray-500 sm:text-lg md:mt-5 md:text-xl md:max-w-3xl">
              Get comprehensive vendor analysis, competitive intelligence, and detailed market insights with interactive Magic Quadrant visualizations.
            </p>
            <div className="mt-5 max-w-md mx-auto sm:flex sm:justify-center md:mt-8">
              <Link href="/register">
                <Button size="lg" className="w-full sm:w-auto mr-3">
                  Get Started Free
                </Button>
              </Link>
              <Link href="/login">
                <Button variant="outline" size="lg" className="w-full sm:w-auto mt-3 sm:mt-0">
                  Sign In
                </Button>
              </Link>
            </div>
          </motion.div>
        </div>

        {/* Features Section */}
        <div className="py-16 bg-white">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <motion.div 
              className="text-center"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.3 }}
            >
              <h2 className="text-3xl font-bold text-gray-900 sm:text-4xl">
                Everything you need for market research
              </h2>
              <p className="mt-4 max-w-2xl mx-auto text-xl text-gray-500">
                Comprehensive tools and insights to make informed technology decisions
              </p>
            </motion.div>

            <motion.div 
              className="mt-16"
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.5 }}
            >
              <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-4">
                <div className="text-center">
                  <div className="flex justify-center">
                    <BarChart3 className="h-12 w-12 text-blue-600" />
                  </div>
                  <h3 className="mt-6 text-lg font-medium text-gray-900">Magic Quadrant Analysis</h3>
                  <p className="mt-2 text-base text-gray-500">
                    Interactive vendor positioning with detailed scoring across execution and viability criteria.
                  </p>
                </div>

                <div className="text-center">
                  <div className="flex justify-center">
                    <TrendingUp className="h-12 w-12 text-blue-600" />
                  </div>
                  <h3 className="mt-6 text-lg font-medium text-gray-900">Market Intelligence</h3>
                  <p className="mt-2 text-base text-gray-500">
                    Real-time vendor news analysis and automated impact scoring on market positions.
                  </p>
                </div>

                <div className="text-center">
                  <div className="flex justify-center">
                    <Users className="h-12 w-12 text-blue-600" />
                  </div>
                  <h3 className="mt-6 text-lg font-medium text-gray-900">Competitive Analysis</h3>
                  <p className="mt-2 text-base text-gray-500">
                    Side-by-side vendor comparisons with detailed feature matrices and capability assessments.
                  </p>
                </div>

                <div className="text-center">
                  <div className="flex justify-center">
                    <Shield className="h-12 w-12 text-blue-600" />
                  </div>
                  <h3 className="mt-6 text-lg font-medium text-gray-900">Research Reports</h3>
                  <p className="mt-2 text-base text-gray-500">
                    Downloadable comprehensive market analysis with rich HTML formatting and insights.
                  </p>
                </div>
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
