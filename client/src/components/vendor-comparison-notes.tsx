import { useTranslation } from "react-i18next";
import type { Criteria, Vendor } from "@shared/schema";
import { translateCriterionName } from "@/lib/criteria-i18n";

interface VendorComparisonNotesProps {
  criterion: Criteria;
  entries: { vendor: Vendor; score: number; notes: string }[];
}

export default function VendorComparisonNotes({ criterion, entries }: VendorComparisonNotesProps) {
  const { t } = useTranslation("magicQuadrant");
  const { t: tc } = useTranslation("common");

  return (
    <section
      id={`desktop-vendor-notes-${criterion.id}`}
      data-testid={`desktop-vendor-notes-${criterion.id}`}
      aria-labelledby={`desktop-vendor-notes-heading-${criterion.id}`}
    >
      <h4 id={`desktop-vendor-notes-heading-${criterion.id}`} className="mb-3 text-sm font-semibold text-gray-900">
        {translateCriterionName(tc, criterion.name)} — {t("compare.notes")}
      </h4>
      <div className={`grid gap-4 md:grid-cols-2 ${entries.length > 2 ? "xl:grid-cols-3" : ""}`}>
        {entries.map(({ vendor, score, notes }) => (
          <article key={vendor.id} className="min-w-0 rounded-lg border border-slate-200 bg-white p-4" data-testid={`desktop-vendor-commentary-${vendor.id}-${criterion.id}`}>
            <div className="mb-3 flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
              <div className="min-w-0">
                <strong className="block break-words text-base font-semibold text-gray-900">{vendor.name}</strong>
                <span className="mt-1 block break-words text-sm text-gray-600">{vendor.product || t("compare.productNameUnavailable")}</span>
              </div>
              <span className="shrink-0 text-sm font-semibold text-blue-700">{score.toFixed(1)} / 10</span>
            </div>
            <p className="whitespace-pre-wrap break-words text-sm leading-6 text-gray-600">{notes || t("compare.noStoredCommentary")}</p>
          </article>
        ))}
      </div>
    </section>
  );
}