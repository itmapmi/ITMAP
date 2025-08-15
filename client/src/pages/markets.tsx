import { useQuery } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import MarketGrid from "@/components/market-grid";
import { motion } from "framer-motion";
import { FadeInSection } from "@/components/ui/animated-card";
import { LoadingGrid } from "@/components/ui/loading-animations";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Search, Filter, Grid, BarChart3, TrendingUp, Users } from "lucide-react";
import type { Market } from "@shared/schema";

export default function Markets() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { data: markets, isLoading, error } = useQuery<Market[]>({
    queryKey: ["/api/markets"],
  });

  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState<string>("");

  // Extract unique categories from markets
  const categories = useMemo(() => {
    if (!markets) return [];
    const uniqueCategories = [...new Set(markets.map(market => market.category).filter(Boolean))];
    return uniqueCategories.sort();
  }, [markets]);

  // Filter markets based on category and search
  const filteredMarkets = useMemo(() => {
    if (!markets) return [];
    
    return markets.filter(market => {
      const matchesCategory = selectedCategory === "all" || market.category === selectedCategory;
      const matchesSearch = searchTerm === "" || 
        market.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        market.description?.toLowerCase().includes(searchTerm.toLowerCase());
      
      return matchesCategory && matchesSearch;
    });
  }, [markets, selectedCategory, searchTerm]);

  if (authLoading) {
    return <div className="min-h-screen bg-gray-50 flex items-center justify-center">Loading...</div>;
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
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-blue-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header Section */}
        <FadeInSection className="mb-8">
          <motion.div 
            className="text-center mb-8"
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: "easeOut" }}
          >
            <h1 className="text-4xl font-bold text-gray-900 mb-4">
              Explore Markets
            </h1>
            <p className="text-xl text-gray-600 max-w-3xl mx-auto">
              Discover comprehensive vendor analysis across technology sectors. 
              Compare solutions, explore market leaders, and make informed decisions.
            </p>
          </motion.div>
        </FadeInSection>

        {/* Stats Bar */}
        {markets && markets.length > 0 && (
          <motion.div 
            className="bg-white rounded-xl shadow-md border border-gray-100 p-6 mb-8"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
          >
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="flex items-center space-x-3">
                <div className="p-2 bg-blue-100 rounded-lg">
                  <BarChart3 className="h-6 w-6 text-blue-600" />
                </div>
                <div>
                  <p className="text-sm text-gray-500">Total Markets</p>
                  <p className="text-2xl font-bold text-gray-900">{markets.length}</p>
                </div>
              </div>
              <div className="flex items-center space-x-3">
                <div className="p-2 bg-green-100 rounded-lg">
                  <TrendingUp className="h-6 w-6 text-green-600" />
                </div>
                <div>
                  <p className="text-sm text-gray-500">Categories</p>
                  <p className="text-2xl font-bold text-gray-900">{categories.length}</p>
                </div>
              </div>
              <div className="flex items-center space-x-3">
                <div className="p-2 bg-purple-100 rounded-lg">
                  <Users className="h-6 w-6 text-purple-600" />
                </div>
                <div>
                  <p className="text-sm text-gray-500">Active Results</p>
                  <p className="text-2xl font-bold text-gray-900">{filteredMarkets.length}</p>
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {/* Filters and Search Section */}
        <motion.div 
          className="bg-white rounded-2xl shadow-lg border border-gray-100 p-6 mb-8"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.3 }}
        >
          <div className="flex items-center gap-2 mb-4">
            <Filter className="h-5 w-5 text-gray-500" />
            <h3 className="text-lg font-semibold text-gray-900">Filter & Search</h3>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Search Input */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                placeholder="Search markets..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>

            {/* Category Filter */}
            <Select value={selectedCategory} onValueChange={setSelectedCategory}>
              <SelectTrigger>
                <SelectValue placeholder="Select category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {categories.map((category) => (
                  <SelectItem key={category} value={category}>
                    {category}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Active Filters */}
          {(selectedCategory !== "all" || searchTerm !== "") && (
            <div className="flex items-center gap-2 mt-4">
              <span className="text-sm text-gray-500">Active filters:</span>
              {selectedCategory !== "all" && (
                <Badge variant="secondary" className="bg-blue-100 text-blue-800">
                  Category: {selectedCategory}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-2 h-4 w-4 p-0 hover:bg-blue-200"
                    onClick={() => setSelectedCategory("all")}
                  >
                    ×
                  </Button>
                </Badge>
              )}
              {searchTerm !== "" && (
                <Badge variant="secondary" className="bg-green-100 text-green-800">
                  Search: "{searchTerm}"
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-2 h-4 w-4 p-0 hover:bg-green-200"
                    onClick={() => setSearchTerm("")}
                  >
                    ×
                  </Button>
                </Badge>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setSelectedCategory("all");
                  setSearchTerm("");
                }}
                className="ml-2"
              >
                Clear All
              </Button>
            </div>
          )}
        </motion.div>

        {/* Markets Grid */}
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
        ) : filteredMarkets && filteredMarkets.length > 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.4 }}
          >
            <MarketGrid markets={filteredMarkets} />
          </motion.div>
        ) : markets && markets.length > 0 ? (
          <motion.div 
            className="text-center py-12 bg-white rounded-2xl shadow-lg border border-gray-100"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5, delay: 0.2 }}
          >
            <div className="max-w-md mx-auto">
              <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Search className="h-8 w-8 text-gray-400" />
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">No markets found</h3>
              <p className="text-gray-600 mb-4">
                Try adjusting your search terms or category filter.
              </p>
              <Button
                variant="outline"
                onClick={() => {
                  setSelectedCategory("all");
                  setSearchTerm("");
                }}
              >
                Clear Filters
              </Button>
            </div>
          </motion.div>
        ) : (
          <motion.div 
            className="text-center py-12 bg-white rounded-2xl shadow-lg border border-gray-100"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5, delay: 0.2 }}
          >
            <div className="max-w-md mx-auto">
              <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Grid className="h-8 w-8 text-gray-400" />
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">No Markets Available</h3>
              <p className="text-gray-600">
                Markets will appear here once they are added by administrators.
              </p>
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}