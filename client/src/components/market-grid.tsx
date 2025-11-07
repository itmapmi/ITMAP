import { useState } from "react";
import { Link } from "wouter";
import { TrendingUp } from "lucide-react";
import type { Market } from "@shared/schema";
import { motion } from "framer-motion";
import { AnimatedCard } from "@/components/ui/animated-card";
import AuthModal from "@/components/auth-modal";

interface MarketGridProps {
  markets: Market[];
  isAuthenticated?: boolean;
}

export default function MarketGrid({ markets, isAuthenticated = false }: MarketGridProps) {
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [selectedMarketId, setSelectedMarketId] = useState<string | undefined>();

  const handleMarketClick = (marketId: string, e: React.MouseEvent) => {
    if (!isAuthenticated) {
      e.preventDefault();
      setSelectedMarketId(marketId);
      setShowAuthModal(true);
    }
    // If authenticated, the Link will handle navigation normally
  };
  const getGradientClass = (index: number) => {
    const gradients = [
      "from-blue-500 to-blue-600",
      "from-red-500 to-red-600", 
      "from-green-500 to-green-600",
      "from-purple-500 to-purple-600",
      "from-yellow-500 to-yellow-600",
      "from-indigo-500 to-indigo-600",
    ];
    return gradients[index % gradients.length];
  };

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {markets.map((market, index) => (
          <motion.div
            key={market.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ 
              duration: 0.4,
              delay: index * 0.1,
              ease: [0.25, 0.25, 0, 1]
            }}
          >
            {isAuthenticated ? (
              <Link href={`/markets/${market.id}`}>
                <AnimatedCard 
                  className="cursor-pointer group overflow-hidden" 
                  hover={true}
                  data-testid={`market-card-${market.id}`}
                >
                  <div className={`h-48 bg-gradient-to-br ${getGradientClass(index)} relative`}>
                    <div className="w-full h-full flex items-center justify-center">
                      <TrendingUp className="w-16 h-16 text-white opacity-80" />
                    </div>
                    <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />
                  </div>
                  <div className="p-6">
                    <h3 className="text-lg font-semibold text-gray-900 group-hover:text-primary-600 transition-colors">
                      {market.name}
                    </h3>
                    <p className="text-gray-600 text-sm mt-2">
                      {market.shortDescription || market.description || "Comprehensive market analysis"}
                    </p>
                    <div className="mt-4 flex items-center text-sm text-gray-500">
                      <TrendingUp className="mr-2 h-4 w-4" />
                      <span>
                        Updated {market.updatedAt ? 
                          new Date(market.updatedAt).toLocaleDateString() : 
                          'recently'
                        }
                      </span>
                    </div>
                  </div>
                </AnimatedCard>
              </Link>
            ) : (
              <div onClick={(e) => handleMarketClick(market.id, e)}>
                <AnimatedCard 
                  className="cursor-pointer group overflow-hidden" 
                  hover={true}
                  data-testid={`market-card-${market.id}`}
                >
                  <div className={`h-48 bg-gradient-to-br ${getGradientClass(index)} relative`}>
                    <div className="w-full h-full flex items-center justify-center">
                      <TrendingUp className="w-16 h-16 text-white opacity-80" />
                    </div>
                    <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />
                  </div>
                  <div className="p-6">
                    <h3 className="text-lg font-semibold text-gray-900 group-hover:text-primary-600 transition-colors">
                      {market.name}
                    </h3>
                    <p className="text-gray-600 text-sm mt-2">
                      {market.shortDescription || market.description || "Comprehensive market analysis"}
                    </p>
                    <div className="mt-4 flex items-center text-sm text-gray-500">
                      <TrendingUp className="mr-2 h-4 w-4" />
                      <span>
                        Updated {market.updatedAt ? 
                          new Date(market.updatedAt).toLocaleDateString() : 
                          'recently'
                        }
                      </span>
                    </div>
                  </div>
                </AnimatedCard>
              </div>
            )}
          </motion.div>
        ))}
      </div>
      
      <AuthModal 
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
        selectedMarketId={selectedMarketId}
      />
    </>
  );
}
