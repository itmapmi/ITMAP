import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Link2, FileText, Trash2, Loader2, Plus, Globe, ChevronDown, ChevronUp } from "lucide-react";

interface Source {
  id: string;
  jobId: string;
  stage: number | null;
  type: string;
  name: string;
  url: string | null;
  content: string;
  createdAt: string;
}

const STAGE_LABELS: Record<number, string> = {
  1: "Stage 1 – Vendors",
  2: "Stage 2 – Criteria",
  3: "Stage 3 – Features",
  4: "Stage 4 – Scoring",
  5: "Stage 5 – Support",
};

interface SourcesPanelProps {
  jobId: string;
  currentStage?: number;
}

export function SourcesPanel({ jobId, currentStage }: SourcesPanelProps) {
  const { toast } = useToast();
  const [showForm, setShowForm] = useState<"url" | "file" | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  // URL form state
  const [urlInput, setUrlInput] = useState("");
  const [urlName, setUrlName] = useState("");
  const [urlStage, setUrlStage] = useState<string>(currentStage?.toString() ?? "all");

  // File form state
  const [fileName, setFileName] = useState("");
  const [fileContent, setFileContent] = useState("");
  const [fileStage, setFileStage] = useState<string>(currentStage?.toString() ?? "all");

  const { data: sources = [], isLoading } = useQuery<Source[]>({
    queryKey: [`/api/admin/market-builder/jobs/${jobId}/sources`],
  });

  const addUrl = useMutation({
    mutationFn: () =>
      apiRequest(`/api/admin/market-builder/jobs/${jobId}/sources/url`, "POST", {
        url: urlInput.trim(),
        name: urlName.trim() || urlInput.trim(),
        stage: urlStage === "all" ? null : parseInt(urlStage),
      }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/admin/market-builder/jobs/${jobId}/sources`] });
      setUrlInput(""); setUrlName(""); setShowForm(null);
      toast({ title: "URL source added" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const addFile = useMutation({
    mutationFn: () =>
      apiRequest(`/api/admin/market-builder/jobs/${jobId}/sources/file`, "POST", {
        name: fileName.trim(),
        content: fileContent.trim(),
        stage: fileStage === "all" ? null : parseInt(fileStage),
      }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/admin/market-builder/jobs/${jobId}/sources`] });
      setFileName(""); setFileContent(""); setShowForm(null);
      toast({ title: "File source added" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const removeSource = useMutation({
    mutationFn: (sourceId: string) =>
      apiRequest(`/api/admin/market-builder/jobs/${jobId}/sources/${sourceId}`, "DELETE"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [`/api/admin/market-builder/jobs/${jobId}/sources`] }),
  });

  // Handle file upload — read text from selected file
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = ev => setFileContent((ev.target?.result as string) ?? "");
    reader.readAsText(file);
  };

  const stageSelect = (value: string, onChange: (v: string) => void) => (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-8 text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All stages</SelectItem>
        {[1,2,3,4,5].map(n => (
          <SelectItem key={n} value={n.toString()}>{STAGE_LABELS[n]}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      <button
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-gray-700 hover:bg-gray-50 rounded-t-lg"
        onClick={() => setCollapsed(c => !c)}
      >
        <span className="flex items-center gap-2">
          Research Sources
          {sources.length > 0 && (
            <Badge variant="secondary" className="text-xs py-0">{sources.length}</Badge>
          )}
        </span>
        {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
      </button>

      {!collapsed && (
        <div className="px-4 pb-4 space-y-3">
          <p className="text-xs text-gray-500">
            Add URLs or paste file content to give the AI extra context alongside its own research.
          </p>

          {/* Existing sources */}
          {sources.length > 0 && (
            <div className="space-y-1.5">
              {sources.map(s => (
                <div key={s.id} className="flex items-center gap-2 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
                  {s.type === "url"
                    ? <Globe className="h-3.5 w-3.5 text-blue-500 shrink-0" />
                    : <FileText className="h-3.5 w-3.5 text-purple-500 shrink-0" />}
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-gray-800 truncate">{s.name}</p>
                    <p className="text-xs text-gray-400">
                      {s.stage == null ? "All stages" : STAGE_LABELS[s.stage]} · {s.content.length.toLocaleString()} chars
                    </p>
                  </div>
                  <Button
                    variant="ghost" size="icon" className="h-6 w-6 shrink-0"
                    onClick={() => removeSource.mutate(s.id)}
                  >
                    <Trash2 className="h-3 w-3 text-red-400" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          {/* Add buttons */}
          {showForm == null && (
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="h-7 text-xs gap-1 flex-1" onClick={() => setShowForm("url")}>
                <Link2 className="h-3.5 w-3.5" /> Add URL
              </Button>
              <Button variant="outline" size="sm" className="h-7 text-xs gap-1 flex-1" onClick={() => setShowForm("file")}>
                <FileText className="h-3.5 w-3.5" /> Upload File
              </Button>
            </div>
          )}

          {/* URL form */}
          {showForm === "url" && (
            <div className="space-y-2 rounded-lg border border-blue-200 bg-blue-50 p-3">
              <div className="space-y-1">
                <Label className="text-xs">URL</Label>
                <Input value={urlInput} onChange={e => setUrlInput(e.target.value)} placeholder="https://example.com/report" className="h-8 text-xs" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Label (optional)</Label>
                <Input value={urlName} onChange={e => setUrlName(e.target.value)} placeholder="e.g. Vendor Whitepaper 2024" className="h-8 text-xs" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Apply to</Label>
                {stageSelect(urlStage, setUrlStage)}
              </div>
              <div className="flex gap-2 pt-1">
                <Button size="sm" className="h-7 text-xs flex-1" onClick={() => addUrl.mutate()} disabled={!urlInput.trim() || addUrl.isPending}>
                  {addUrl.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Fetch & Add"}
                </Button>
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setShowForm(null)}>Cancel</Button>
              </div>
            </div>
          )}

          {/* File form */}
          {showForm === "file" && (
            <div className="space-y-2 rounded-lg border border-purple-200 bg-purple-50 p-3">
              <div className="space-y-1">
                <Label className="text-xs">Upload file</Label>
                <input
                  type="file"
                  accept=".txt,.md,.csv,.json,.html"
                  onChange={handleFileUpload}
                  className="text-xs text-gray-600 file:mr-2 file:text-xs file:border file:rounded file:px-2 file:py-0.5 file:bg-white file:text-gray-700"
                />
                <p className="text-xs text-gray-400">Supports .txt, .md, .csv, .json, .html</p>
              </div>
              {fileName && (
                <div className="space-y-1">
                  <Label className="text-xs">Label</Label>
                  <Input value={fileName} onChange={e => setFileName(e.target.value)} className="h-8 text-xs" />
                </div>
              )}
              {fileContent && (
                <p className="text-xs text-purple-700">{fileContent.length.toLocaleString()} characters loaded</p>
              )}
              <div className="space-y-1">
                <Label className="text-xs">Or paste text directly</Label>
                <Textarea
                  value={fileContent}
                  onChange={e => setFileContent(e.target.value)}
                  placeholder="Paste report text, analysis, or any relevant content…"
                  rows={4}
                  className="text-xs resize-none"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Apply to</Label>
                {stageSelect(fileStage, setFileStage)}
              </div>
              <div className="flex gap-2 pt-1">
                <Button size="sm" className="h-7 text-xs flex-1" onClick={() => addFile.mutate()} disabled={!fileName.trim() || !fileContent.trim() || addFile.isPending}>
                  {addFile.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Add Source"}
                </Button>
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setShowForm(null)}>Cancel</Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
