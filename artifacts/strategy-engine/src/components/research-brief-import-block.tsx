import { useRef, useState } from "react";
import type { ExistingClientValues, ImportPreview, ResearchBriefApplyPayload } from "@workspace/research-brief";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { FileText, Upload, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  parseResearchBriefInput,
  readResearchBriefFile,
  validateResearchBriefFile,
} from "@/lib/research-brief-import";
import { ResearchBriefPreviewDialog } from "@/components/research-brief-preview-dialog";

type ResearchBriefImportBlockProps = {
  existing: ExistingClientValues;
  onConfirmImport: (payload: ResearchBriefApplyPayload) => void;
};

export function ResearchBriefImportBlock({ existing, onConfirmImport }: ResearchBriefImportBlockProps) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [pasteText, setPasteText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [feedback, setFeedback] = useState("");

  async function handleFileChange(file: File | null) {
    if (!file) return;
    const fileError = validateResearchBriefFile(file);
    if (fileError) {
      toast({ title: "Unsupported file", description: fileError, variant: "destructive" });
      return;
    }
    try {
      const text = await readResearchBriefFile(file);
      setPasteText(text);
      setFileName(file.name);
      setFeedback(`Loaded ${file.name}`);
    } catch (err) {
      toast({ title: "Could not read file", description: String(err), variant: "destructive" });
    }
  }

  function handleParse() {
    const { preview: nextPreview, error } = parseResearchBriefInput({
      text: pasteText,
      fileName: fileName ?? undefined,
      existing,
    });
    if (error) {
      setFeedback(error);
      toast({ title: "Parse failed", description: error, variant: "destructive" });
      return;
    }
    if (!nextPreview) {
      setFeedback("Nothing to preview.");
      return;
    }
    setPreview(nextPreview);
    setPreviewOpen(true);
    setFeedback(
      nextPreview.parseMeta.mappedFieldCount > 0
        ? `Detected ${nextPreview.parseMeta.mappedFieldCount} mapped fields. Review before importing.`
        : "Parse completed but no mapped fields were found.",
    );
  }

  function clearState() {
    setPasteText("");
    setFileName(null);
    setPreview(null);
    setFeedback("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleConfirm(payload: ResearchBriefApplyPayload) {
    onConfirmImport(payload);
    toast({
      title: "Research brief imported",
      description: "Review fields before approving & saving SOW.",
    });
    setFeedback("Imported into form. Review and save when ready.");
  }

  return (
    <>
      <div className="space-y-3 rounded-lg border border-dashed border-border/80 bg-muted/20 p-4">
        <div className="flex items-start sm:items-center gap-3 flex-wrap">
          <Input
            ref={fileInputRef}
            type="file"
            accept=".md,.txt,text/markdown,text/plain"
            onChange={(e) => void handleFileChange(e.target.files?.[0] ?? null)}
            className="w-full sm:max-w-sm"
            data-testid="research-brief-file-input"
          />
          {fileName && (
            <Badge variant="secondary" className="gap-1.5">
              <FileText className="size-3.5" />
              {fileName}
            </Badge>
          )}
          {(pasteText || fileName) && (
            <Button type="button" size="sm" variant="ghost" onClick={clearState} className="gap-1.5">
              <X className="size-4" />
              Clear
            </Button>
          )}
        </div>
        <Textarea
          value={pasteText}
          onChange={(e) => setPasteText(e.target.value)}
          placeholder="Paste standardized Markdown research brief here…"
          className="min-h-40 w-full text-sm leading-relaxed font-mono"
          data-testid="research-brief-paste-input"
        />
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            type="button"
            variant="outline"
            onClick={handleParse}
            disabled={!pasteText.trim()}
            className="gap-2"
            data-testid="research-brief-parse-button"
          >
            <Upload className="size-4" />
            Parse & preview
          </Button>
        </div>
        {feedback && (
          <p className="text-sm text-muted-foreground" data-testid="research-brief-parse-feedback">
            {feedback}
          </p>
        )}
      </div>

      <ResearchBriefPreviewDialog
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        preview={preview}
        onConfirm={handleConfirm}
      />
    </>
  );
}
