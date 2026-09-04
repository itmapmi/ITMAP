import { useState, type CSSProperties, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Newspaper, Radio, Users } from "lucide-react";
import { format } from "date-fns";
import type { NewPlayer, NewsArticle, Vendor } from "@shared/schema";
import type { SignalData } from "@/components/signal-card";
import "./mobile-market-intelligence.css";

type IntelligenceTab = "news" | "signals" | "players";

type NewsArticleExtended = NewsArticle & {
  category?: string | null;
};

interface VendorSignalsPage {
  data: SignalData[];
  total: number;
}

export interface MobileMarketIntelligenceProps {
  marketId: string;
  vendors: Vendor[];
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { credentials: "include" });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error || `Request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}

function dateLabel(date: Date | string | null): string | null {
  if (!date) return null;
  const value = new Date(date);
  return Number.isNaN(value.getTime()) ? null : format(value, "MMM d, yyyy");
}

function websiteHref(url: string) {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

// Distinguishable accent colours for the left stripe on each item. Assigned
// per market in a stable order (vendor list order for news, first-seen order
// for signal sources) so the same vendor/source always gets the same stripe
// while viewing that market. Cycles if there are more keys than colours.
const ACCENT_PALETTE = [
  "#13a8f0", "#7c3aed", "#e11d48", "#f59e0b", "#059669",
  "#ea580c", "#4f46e5", "#db2777", "#65a30d", "#0d9488",
  "#c026d3", "#a16207", "#b91c1c", "#155e75", "#166534",
];
const NEUTRAL_ACCENT = "#94a3b8";

function buildAccentMap(keys: Array<string | null | undefined>): Map<string, string> {
  const map = new Map<string, string>();
  for (const key of keys) {
    if (!key || map.has(key)) continue;
    map.set(key, ACCENT_PALETTE[map.size % ACCENT_PALETTE.length]);
  }
  return map;
}

function LoadingState() {
  return <div className="mmi-loading" aria-label="Loading"><div className="mmi-skeleton" /><div className="mmi-skeleton" /><div className="mmi-skeleton" /></div>;
}

function EmptyState({ title, children }: { title: string; children: ReactNode }) {
  return <div className="mmi-state"><strong>{title}</strong>{children}</div>;
}

export function MobileMarketIntelligence({ marketId, vendors }: MobileMarketIntelligenceProps) {
  const [tab, setTab] = useState<IntelligenceTab>("news");
  const news = useQuery<NewsArticleExtended[]>({
    queryKey: ["/api/news", { market: marketId, limit: 50 }],
    queryFn: () => fetchJson(`/api/news?${new URLSearchParams({ market: marketId, limit: "50" })}`),
    enabled: tab === "news",
  });
  const signals = useQuery<VendorSignalsPage>({
    queryKey: ["/api/markets", marketId, "vendor-signals", 20],
    queryFn: () => fetchJson(`/api/markets/${marketId}/vendor-signals?limit=20`),
    enabled: tab === "signals",
  });
  const players = useQuery<NewPlayer[]>({
    queryKey: ["/api/markets", marketId, "new-players"],
    queryFn: () => fetchJson(`/api/markets/${marketId}/new-players`),
    enabled: tab === "players",
  });

  // One colour per vendor in this market (list order), one per signal source.
  const vendorAccents = buildAccentMap(vendors.map(vendor => vendor.id));
  const sourceAccents = buildAccentMap((signals.data?.data ?? []).map(signal => signal.sourceType));

  const tabs = [
    { id: "news" as const, label: "News", icon: Newspaper },
    { id: "signals" as const, label: "Signals", icon: Radio },
    { id: "players" as const, label: "New Players", icon: Users },
  ];

  return (
    <section className="mobile-market-intelligence" aria-labelledby="mobile-intelligence-heading">
      <h2 id="mobile-intelligence-heading" className="mmi-heading"><span>01</span>Stored-data views</h2>
      <div className="mmi-tabs" role="tablist" aria-label="Market intelligence views">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button key={id} id={`mmi-tab-${id}`} type="button" role="tab" aria-selected={tab === id}
            aria-controls={`mmi-panel-${id}`} onClick={() => setTab(id)}>
            <Icon size={14} aria-hidden="true" />{label}
          </button>
        ))}
      </div>

      {tab === "news" && <div id="mmi-panel-news" role="tabpanel" aria-labelledby="mmi-tab-news">
        {news.isLoading ? <LoadingState /> : news.isError ? (
          <EmptyState title="News is unavailable"><span>{news.error.message}</span><button type="button" onClick={() => news.refetch()}>Try again</button></EmptyState>
        ) : !news.data?.length ? (
          <EmptyState title="No news articles found"><span>News appears here when stored articles are available for this market.</span></EmptyState>
        ) : <div className="mmi-card">{news.data.map(article => {
          const vendor = vendors.find(item => item.id === article.vendorId);
          const accent = (vendor && vendorAccents.get(vendor.id)) || NEUTRAL_ACCENT;
          return <article className="mmi-item" key={article.id} style={{ "--mmi-accent": accent } as CSSProperties} data-testid={`mmi-news-${article.id}`}>
            <div className="mmi-meta">{vendor && <span className="mmi-keyed"><i className="mmi-swatch" aria-hidden="true" />{vendor.name}</span>}{dateLabel(article.publishedAt) && <span>{dateLabel(article.publishedAt)}</span>}{article.impactLabel && <span className="mmi-impact">{article.impactLabel}</span>}</div>
            <h3 className="mmi-article-title"><a className="mmi-article-link" href={article.url} target="_blank" rel="noopener noreferrer">{article.title} <ExternalLink size={12} aria-hidden="true" /></a></h3>
            {article.category && <span className="mmi-label">{article.category}</span>}
            {article.summary && <p className="mmi-summary">{article.summary}</p>}
          </article>;
        })}</div>}
      </div>}

      {tab === "signals" && <div id="mmi-panel-signals" role="tabpanel" aria-labelledby="mmi-tab-signals">
        {signals.isLoading ? <LoadingState /> : signals.isError ? (
          <EmptyState title="Signals are unavailable"><span>{signals.error.message}</span><button type="button" onClick={() => signals.refetch()}>Try again</button></EmptyState>
        ) : !signals.data?.data.length ? (
          <EmptyState title="No signals collected yet"><span>Stored signals for this market appear here.</span></EmptyState>
        ) : <div className="mmi-card">{signals.data.data.map(signal => <article className="mmi-item" key={signal.id} style={{ "--mmi-accent": sourceAccents.get(signal.sourceType) || NEUTRAL_ACCENT } as CSSProperties} data-testid={`mmi-signal-${signal.id}`}>
          <div className="mmi-signal-head"><span className="mmi-source mmi-keyed"><i className="mmi-swatch" aria-hidden="true" />{signal.sourceType}</span><strong>{signal.title}</strong></div>
          {signal.vendorName && <span className="mmi-label">{signal.vendorName}</span>}
          {signal.content && <p className="mmi-signal-content">{signal.content}</p>}
          {signal.url && <a className="mmi-player-link" href={signal.url} target="_blank" rel="noopener noreferrer">View source <ExternalLink size={12} aria-hidden="true" /></a>}
        </article>)}</div>}
      </div>}

      {tab === "players" && <div id="mmi-panel-players" role="tabpanel" aria-labelledby="mmi-tab-players">
        {players.isLoading ? <LoadingState /> : players.isError ? (
          <EmptyState title="New players are unavailable"><span>{players.error.message}</span><button type="button" onClick={() => players.refetch()}>Try again</button></EmptyState>
        ) : !players.data?.length ? (
          <EmptyState title="No new players yet"><span>New entrants appear here when stored for this market.</span></EmptyState>
        ) : <div className="mmi-card">{players.data.map(player => <article className="mmi-item" key={player.id}>
          <div className="mmi-player-head"><strong className="mmi-player-name">{player.name}</strong>{player.websiteUrl && <a className="mmi-player-link" href={websiteHref(player.websiteUrl)} target="_blank" rel="noopener noreferrer">Visit <ExternalLink size={12} aria-hidden="true" /></a>}</div>
          {player.description && <p className="mmi-player-description">{player.description}</p>}
          {(player.estimatedRevenue || player.location) && <div className="mmi-player-facts">{player.estimatedRevenue && <span>{player.estimatedRevenue}</span>}{player.location && <span>{player.location}</span>}</div>}
        </article>)}</div>}
      </div>}
    </section>
  );
}

export default MobileMarketIntelligence;