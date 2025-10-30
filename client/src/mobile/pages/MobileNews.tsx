import { useQuery } from "@tanstack/react-query";
import { MobileHeader } from "@/mobile/components/MobileHeader";
import { MobileCard, MobileCardContent } from "@/mobile/components/MobileCard";
import { MobileLoadingSpinner } from "@/mobile/components/MobileLoadingSpinner";
import { MobileEmptyState } from "@/mobile/components/MobileEmptyState";
import { Newspaper, ExternalLink } from "lucide-react";
import { formatRelativeTime } from "@/shared/utils";
import type { NewsArticle } from "@shared/schema";

export default function MobileNews() {
  const { data: articles, isLoading } = useQuery<NewsArticle[]>({
    queryKey: ["/api/news/articles"],
  });

  const getImpactBadge = (impact: string) => {
    const colors = {
      HIGH: "bg-red-100 text-red-700 border-red-200",
      MEDIUM: "bg-orange-100 text-orange-700 border-orange-200",
      LOW: "bg-gray-100 text-gray-700 border-gray-200",
    };
    return colors[impact as keyof typeof colors] || colors.LOW;
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <MobileHeader 
        title="Vendor News"
        subtitle="Latest Updates"
      />

      <div className="p-4 space-y-3">
        {isLoading ? (
          <MobileLoadingSpinner />
        ) : !articles || articles.length === 0 ? (
          <MobileEmptyState
            icon={Newspaper}
            title="No News Available"
            description="There are no news articles at this time."
          />
        ) : (
          articles.map((article) => (
            <MobileCard key={article.id}>
              <MobileCardContent className="py-4">
                <div className="space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-semibold text-gray-900 text-base line-clamp-2 flex-1">
                      {article.title}
                    </h3>
                    {article.impactLevel && (
                      <span className={`text-xs px-2 py-1 rounded-full border flex-shrink-0 ${getImpactBadge(article.impactLevel)}`}>
                        {article.impactLevel}
                      </span>
                    )}
                  </div>
                  
                  {article.summary && (
                    <p className="text-sm text-gray-600 line-clamp-3">{article.summary}</p>
                  )}
                  
                  <div className="flex items-center justify-between pt-2 text-xs text-gray-500">
                    <span>{formatRelativeTime(article.publishedAt)}</span>
                    {article.url && (
                      <a
                        href={article.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-blue-600 hover:text-blue-700 font-medium"
                        onClick={(e) => e.stopPropagation()}
                        data-testid={`link-article-${article.id}`}
                      >
                        Read more
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                </div>
              </MobileCardContent>
            </MobileCard>
          ))
        )}
      </div>
    </div>
  );
}
