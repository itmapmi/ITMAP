import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ArrowRight, Database, FileText } from "lucide-react";
import type { DatasheetMarket } from "@shared/schema";
import { useAuth } from "@/hooks/useAuth";
import { LockedFeaturePanel } from "@/components/locked-feature-tooltip";

export default function DatasheetsIndexPage() {
  const { hasFeature, isLoading: authLoading } = useAuth();
  const { data: markets = [], isLoading } = useQuery<DatasheetMarket[]>({
    queryKey: ["/api/datasheets/markets"],
    enabled: hasFeature("datasheets"),
  });

  if (!authLoading && !hasFeature("datasheets")) {
    return <LockedFeaturePanel featureKey="datasheets" variant="dark" />;
  }

  return (
    <div className="min-h-screen theme-bg pt-20 pb-24">
      <div className="max-w-7xl mx-auto px-6">
        <div className="mb-12">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-300 text-xs font-medium mb-4">
            <FileText className="h-3 w-3" /> Hardware Datasheets
          </div>
          <h1 className="text-4xl md:text-5xl font-bold mb-3 bg-gradient-to-r from-white to-slate-400 bg-clip-text text-transparent">
            Datasheet Comparison
          </h1>
          <p className="text-slate-400 max-w-2xl">
            Compare hardware vendor datasheets side-by-side with AI-extracted specs, normalized units, and source citations from the original PDFs.
          </p>
          <div className="mt-6 flex gap-3">
            <Link href="/me/comparisons" className="inline-flex items-center text-sm text-cyan-400 hover:text-cyan-300 gap-1" data-testid="link-saved-comparisons">
              <Database className="h-4 w-4" /> My saved comparisons →
            </Link>
          </div>
        </div>

        {isLoading && <div className="text-slate-500">Loading…</div>}
        {!isLoading && markets.length === 0 && (
          <div className="text-slate-500 text-center py-16 border border-white/5 rounded-2xl bg-slate-900/40">
            No datasheet markets are available yet. Check back soon.
          </div>
        )}
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
          {markets.map(m => (
            <Link key={m.id} href={`/datasheets/${m.slug}`} className="group block bg-slate-900 border border-white/5 hover:border-cyan-500/40 rounded-2xl p-6 transition-all" data-testid={`card-datasheet-market-${m.slug}`}>
              {m.category && <div className="text-xs text-cyan-400 mb-2 uppercase tracking-wider">{m.category}</div>}
              <h3 className="text-xl font-semibold mb-2 group-hover:text-cyan-300 transition">{m.name}</h3>
              {m.description && <p className="text-sm text-slate-400 line-clamp-3 mb-4">{m.description}</p>}
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>Compare datasheets</span>
                <ArrowRight className="h-4 w-4 group-hover:translate-x-1 transition" />
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
