import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileText, Download, ExternalLink, Calendar, ChevronDown, FileIcon, FileArchive, FileSpreadsheet, FileVideo, FileType } from "lucide-react";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
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

export function ResearchReports({ marketId, mobileMode = false }: ResearchReportsProps) {
  const [openReportId, setOpenReportId] = useState<string | null>(null);
  const { data: reports, isLoading } = useQuery<ResearchReport[]>({
    queryKey: ["/api/markets", marketId, "research-reports"],
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
    );
  }

  if (!reports || reports.length === 0) {
    return (
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

  if (mobileMode) {
    return (
      <section className="font-[Montserrat]">
        <div className="mb-3 flex items-end justify-between border-b border-slate-200 pb-2">
          <div>
            <p className="font-[Menlo] text-[9px] font-bold uppercase tracking-widest text-sky-500">01</p>
            <h3 className="text-base font-bold text-slate-950">Report library</h3>
          </div>
          <span className="font-[Menlo] text-[10px] uppercase tracking-wider text-slate-500">{reports.length} reports</span>
        </div>
        <div className="border border-slate-200 bg-slate-50 px-3">
          {reports.map(report => {
            const meta = getFileMeta(report.mimeType, report.fileUrl);
            const dateValue = report.publishedAt || report.uploadedAt || report.createdAt;
            const open = openReportId === report.id;
            return (
              <article key={report.id} className="border-b border-slate-200 py-3 last:border-0">
                <button type="button" className="flex min-h-11 w-full items-start gap-2 text-left" onClick={() => setOpenReportId(open ? null : report.id)} aria-expanded={open}>
                  <span className="grid h-9 w-9 shrink-0 place-items-center bg-blue-100 font-[Menlo] text-[9px] font-bold text-sky-700">{meta.label.slice(0, 4)}</span>
                  <span className="min-w-0 flex-1">
                    <strong className="block text-[13px] leading-snug text-slate-950">{report.title}</strong>
                    <small className="mt-1 block text-[10px] text-slate-500">{dateValue ? format(new Date(dateValue), "MMM d, yyyy") : "Date unavailable"}{report.fileSize ? ` · ${formatFileSize(report.fileSize)}` : ""}</small>
                  </span>
                  <ChevronDown className={`mt-1 h-4 w-4 text-sky-600 transition-transform ${open ? "rotate-180" : ""}`} />
                </button>
                {open && (
                  <div className="ml-11 mt-2 border-l-2 border-sky-500 bg-blue-50 p-3">
                    <p className="text-xs leading-relaxed text-slate-600">{report.description || "No stored description is available for this report."}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {report.htmlContent && <Button variant="outline" size="sm" onClick={() => window.open(`/mobile/report/${report.id}`, "_blank")}><ExternalLink className="mr-1 h-3.5 w-3.5" /> View online</Button>}
                      {report.fileUrl && <Button variant="outline" size="sm" onClick={() => window.open(`/api/research-reports/${report.id}/download`, "_blank")}><Download className="mr-1 h-3.5 w-3.5" /> Download</Button>}
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </section>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-2xl font-bold mb-2">Research Reports</h3>
        <p className="text-muted-foreground">
          In-depth analyses, briefings, and supporting materials published for this market.
        </p>
      </div>

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
                  <h4 className="font-semibold text-gray-900 leading-snug" data-testid={`report-title-${report.id}`}>
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
