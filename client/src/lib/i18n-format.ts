import i18n from "@/i18n";

/**
 * Locale-aware date formatting for translated surfaces. Use instead of
 * `.toLocaleDateString()` with no args (which is fine) or a hardcoded
 * locale string (which isn't) — this always reflects the active UI language.
 */
export function formatDate(
  value: string | number | Date | null | undefined,
  options: Intl.DateTimeFormatOptions = { year: "numeric", month: "short", day: "numeric" },
): string | null {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(i18n.language, options).format(date);
}

export function formatDateTime(value: string | number | Date | null | undefined): string | null {
  return formatDate(value, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function formatNumber(value: number | null | undefined, options?: Intl.NumberFormatOptions): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "";
  return new Intl.NumberFormat(i18n.language, options).format(value);
}

export function formatCurrency(value: number | null | undefined, currency = "USD"): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "";
  return new Intl.NumberFormat(i18n.language, { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
}
