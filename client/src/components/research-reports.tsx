import { useState, type ReactNode } from "react";
import MarketSectionHeader from "@/components/market-section-header";
import { useQuery } from "@tanstack/react-query";
import { FileText, Download, ExternalLink, Calendar, ChevronDown, FileIcon, FileArchive, FileSpreadsheet, FileVideo, FileType, AlertCircle, Lock } from "lucide-react";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CompanyProfileLockedPanel, isCompanyEmailRequiredError } from "@/components/company-profile-lock";
import type { ResearchReport } from "@shared/schema";

interface ResearchReportsProps {
  marketId: string;
  /** True only on the /mobile/* route — opens report links at their
   * /mobile/report/:id mirror instead of the desktop path. */
  mobileMode?: boolean;
}

function getFileMeta(mimeType: string | null, fileUrl: string | null) {
  const url = (fileUrl || "").toLowerCase();
  const m = (mimeType || "").toLowerCase();

  if (m.includes("pdf") || url.endsWith(".pdf")) {
    return { Icon: FileText, label: "PDF", color: "text-red-600 bg-red-50" };
  }
  if (m.includes("sheet") || m.includes("excel") || url.endsWith(".xlsx") || url.endsWith(".xls") || url.endsWith(".csv")) {
    return { Icon: FileSpreadsheet, label: "Excel", color: "text-emerald-600 bg-emerald-50" };
  }
  if (m.includes("zip") || m.includes("compressed") || url.endsWith(".zip") || url.endsWith(".7z") || url.endsWith(".rar")) {
    return { Icon: FileArchive, label: "Archive", color: "text-amber-600 bg-amber-50" };
  }
  if (m.startsWith("video/") || url.endsWith(".mp4") || url.endsWith(".mov") || url.endsWith(".webm") || url.endsWith(".m4v")) {
    return { Icon: FileVideo, label: "Video", color: "text-violet-600 bg-violet-50" };
  }
  if (m.includes("word") || m.includes("document") || url.endsWith(".doc") || url.endsWith(".docx")) {
    return { Icon: FileType, label: "Document", color: "text-blue-600 bg-blue-50" };
  }
  if (m.includes("presentation") || m.includes("powerpoint") || url.endsWith(".ppt") || url.endsWith(".pptx")) {
    return { Icon: FileType, label: "Slides", color: "text-orange-600 bg-orange-50" };
  }
  return { Icon: FileIcon, label: "File", color: "text-slate-600 bg-slate-50" };
}

function formatFileSize(bytes: number | null | undefined): string {
  if (!bytes) return "";
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${Math.round((bytes / Math.pow(1024, i)) * 100) / 100} ${sizes[i]}`;
}

function getStoredExcerpt(html: string): string {
  let text = "";

  if (typeof DOMParser !== "undefined") {
    text = new DOMParser().parseFromString(html, "text/html").body.textContent || "";
  } else {
    text = html.replace(/<[^>]*>/g, " ");
  }

  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > 420 ? `${normalized.slice(0, 417).trimEnd()}…` : normalized;
}

export function ResearchReports({ marketId, mobileMode = false }: ResearchReportsProps) {
  const [openReportId, setOpenReportId] = useState<string | null>(null);
  const { data: reports, isLoading, error, refetch } = useQuery<ResearchReport[]>({
    queryKey: ["/api/markets", marketId, "research-reports"],
  });

  const companyLocked = isCompanyEmailRequiredError(error);

  if (mobileMode) {
    const errorMessage = error instanceof Error ? error.message : "";
    const isLocked = /^40[13]:/.test(errorMessage);

    return (
      <section className="font-[Montserrat]" aria-labelledby="mobile-report-library-title">
        <div className="mb-3 flex items-end justify-between border-b border-slate-200 pb-2">
          <div>
            <p className="font-[Menlo] text-[9px] font-bold uppercase tracking-[0.1em] text-sky-500">01</p>
            <h3 id="mobile-report-library-title" className="text-base font-bold tracking-[-0.035em] text-slate-950">
              Report library
            </h3>
          </div>
          {!isLoading && !error && reports ? (
            <span className="font-[Menlo] text-[10px] font-bold uppercase tracking-[0.1em] text-slate-500">
              {reports.length} reports
            </span>
          ) : null}
        </div>

        {isLoading ? (
          <div className="border border-slate-200 bg-slate-50 p-3" aria-label="Loading reports" aria-busy="true">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex gap-2 border-b border-slate-200 py-3 last:border-0">
                <Skeleton className="h-[38px] w-[34px] shrink-0 rounded-none" />
                <div className="flex-1 space-y-2 pt-0.5">
                  <Skeleton className="h-3.5 w-4/5" />
                  <Skeleton className="h-2.5 w-2/5" />
                </div>
              </div>
            ))}
          </div>
        ) : companyLocked ? (
          <CompanyProfileLockedPanel feature="The report library" variant="mobile" />
        ) : error ? (
          <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-9 text-center" role={isLocked ? undefined : "alert"}>
            {isLocked ? (
              <Lock className="mx-auto mb-2 h-[22px] w-[22px] text-sky-500" />
            ) : (
              <AlertCircle className="mx-auto mb-2 h-[22px] w-[22px] text-red-500" />
            )}
            <strong className="block text-[13px] text-slate-950">
              {isLocked ? "Reports are locked" : "Reports could not be loaded"}
            </strong>
            <p className="mx-auto mt-1 max-w-[280px] text-xs leading-relaxed text-slate-500">
              {isLocked
                ? "Sign in with research report access to browse this report library."
                : "There was a problem loading the report library. Please try again."}
            </p>
            {!isLocked ? (
              <Button className="mt-4" variant="outline" size="sm" onClick={() => void refetch()}>
                Try again
              </Button>
            ) : null}
          </div>
        ) : !reports || reports.length === 0 ? (
          <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-9 text-center">
            <FileText className="mx-auto mb-2 h-[22px] w-[22px] text-sky-500" />
            <strong className="block text-[13px] text-slate-950">No Research Reports Yet</strong>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              Reports published for this market will appear here.
            </p>
          </div>
        ) : (
          <div className="border border-slate-200 bg-slate-50 px-[14px]">
            {reports.map((report) => {
              const meta = getFileMeta(report.mimeType, report.fileUrl);
              const dateValue = report.publishedAt || report.uploadedAt || report.createdAt;
              const open = openReportId === report.id;
              const excerpt = report.htmlContent ? getStoredExcerpt(report.htmlContent) : "";

              return (
                <article key={report.id} className="border-b border-slate-200 py-[13px] last:border-0" data-testid={`report-card-${report.id}`}>
                  <button
                    type="button"
                    className="flex min-h-11 w-full items-start gap-[9px] bg-transparent p-0 text-left"
                    onClick={() => setOpenReportId(open ? null : report.id)}
                    aria-expanded={open}
                    aria-controls={`mobile-report-detail-${report.id}`}
                  >
                    <span className="grid h-[38px] w-[34px] shrink-0 place-items-center bg-sky-50 font-[Menlo] text-[9px] font-bold text-sky-600">
                      {meta.label.slice(0, 4)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <strong className="block break-words [overflow-wrap:anywhere] text-[13px] leading-snug text-slate-950" data-testid={`report-title-${report.id}`}>
                        {report.title}
                      </strong>
                      <small className="mt-1 block text-[10px] text-slate-500">
                        {dateValue ? format(new Date(dateValue), "MMM d, yyyy") : "Date unavailable"}
                        {report.fileSize ? ` · ${formatFileSize(report.fileSize)}` : ""}
                      </small>
                    </span>
                    <ChevronDown className={`mt-1 h-[15px] w-[15px] shrink-0 text-sky-500 transition-transform ${open ? "rotate-180" : ""}`} />
                  </button>

                  {open ? (
                    <div id={`mobile-report-detail-${report.id}`}>
                      {report.htmlContent ? (
                        <div className="ml-[39px] mt-[13px] border-l-[3px] border-sky-500 bg-sky-50 p-[11px] text-xs leading-[1.55] text-slate-600">
                          <div className="font-[Menlo] text-[10px] font-bold uppercase tracking-[0.1em] text-slate-500">
                            Stored report excerpt
                          </div>
                          <p className="mt-1.5">
                            {excerpt || "This stored report contains online media without a text excerpt."}
                          </p>
                        </div>
                      ) : (
                        <div className="mt-[14px] border border-dashed border-slate-300 bg-[#faf9f4] px-4 py-8 text-center">
                          <FileText className="mx-auto mb-[9px] h-[22px] w-[22px] text-red-500" />
                          <strong className="block text-[13px] text-slate-950">No Content Available</strong>
                          <p className="mt-1 text-xs leading-relaxed text-slate-500">
                            This report does not have stored online content available.
                          </p>
                        </div>
                      )}

                      {report.htmlContent || report.fileUrl ? (
                        <div className="ml-[39px] mt-3 flex flex-wrap gap-2">
                          {report.htmlContent ? (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => window.open(`/mobile/report/${report.id}`, "_blank")}
                              data-testid={`report-view-${report.id}`}
                            >
                              <ExternalLink className="mr-1 h-3.5 w-3.5" />
                              View online
                            </Button>
                          ) : null}
                          {report.fileUrl ? (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => window.open(`/api/research-reports/${report.id}/download`, "_blank")}
                              data-testid={`report-download-${report.id}`}
                            >
                              <Download className="mr-1 h-3.5 w-3.5" />
                              Download
                            </Button>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </section>
    );
  }

  const renderDesktopSection = (content: ReactNode) => (
    <section className="overflow-hidden rounded-xl border border-blue-100 bg-white shadow-lg" aria-labelledby="report-library-heading">
      <MarketSectionHeader
        title="Research Reports"
        description="In-depth analyses, briefings, and supporting materials published for this market."
        icon={FileText}
        tone="rose"
        headingId="report-library-heading"
      />
      <div className="p-6">{content}</div>
    </section>
  );

  if (isLoading) {
    return renderDesktopSection(
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
    );
  }

  if (companyLocked) {
    return renderDesktopSection(<CompanyProfileLockedPanel feature="Research reports" />);
  }

  if (!reports || reports.length === 0) {
    return renderDesktopSection(
      <div className="flex justify-center items-center p-12">
        <div className="text-center">
          <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
          <p className="text-lg text-muted-foreground mb-2">No Research Reports Yet</p>
          <p className="text-sm text-muted-foreground">
            Reports published for this market will appear here.
          </p>
        </div>
      </div>
    );
  }

  return renderDesktopSection(
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {reports.map((report) => {
          const meta = getFileMeta(report.mimeType, report.fileUrl);
          const { Icon } = meta;
          const dateValue = report.publishedAt || report.uploadedAt || report.createdAt;
          return (
            <div
              key={report.id}
              className="flex flex-col p-5 border rounded-lg bg-white hover:shadow-md transition-shadow"
              data-testid={`report-card-${report.id}`}
            >
              <div className="flex items-start gap-4">
                <div className={`flex-shrink-0 p-3 rounded-lg ${meta.color}`}>
                  <Icon className="h-6 w-6" />
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="font-semibold text-gray-900 leading-snug break-words [overflow-wrap:anywhere]" data-testid={`report-title-${report.id}`}>
                    {report.title}
                  </h4>
                  {report.description && (
                    <p className="text-sm text-gray-600 mt-1 line-clamp-2">
                      {report.description}
                    </p>
                  )}
                  <div className="flex items-center gap-3 mt-2 text-xs text-gray-500 flex-wrap">
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-gray-100 text-gray-700 font-medium">
                      {meta.label}
                    </span>
                    {dateValue && (
                      <span className="inline-flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {format(new Date(dateValue), "MMM d, yyyy")}
                      </span>
                    )}
                    {report.fileSize ? (
                      <span className="inline-flex items-center gap-1">
                        <FileIcon className="h-3 w-3" />
                        {formatFileSize(report.fileSize)}
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 mt-4 pt-4 border-t">
                {report.htmlContent && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => window.open(`${mobileMode ? "/mobile" : ""}/report/${report.id}`, "_blank")}
                    className="flex items-center gap-2"
                    data-testid={`report-view-${report.id}`}
                  >
                    <ExternalLink className="h-4 w-4" />
                    View Online
                  </Button>
                )}
                {report.fileUrl && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => window.open(`/api/research-reports/${report.id}/download`, "_blank")}
                    className="flex items-center gap-2"
                    data-testid={`report-download-${report.id}`}
                  >
                    <Download className="h-4 w-4" />
                    Download
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
