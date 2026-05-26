import { useEffect, useMemo, useState } from "react";
import type { ImportPreview, ImportPreviewRow } from "@workspace/research-brief";
import { buildApplyPayload } from "@/lib/research-brief-import";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import { AlertTriangle, Copy } from "lucide-react";

type ResearchBriefPreviewDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preview: ImportPreview | null;
  onConfirm: (payload: ReturnType<typeof buildApplyPayload>) => void;
};

function statusLabel(status: ImportPreviewRow["status"]): string {
  switch (status) {
    case "will_fill":
      return "Will fill";
    case "will_update":
      return "Will update";
    case "skipped":
      return "Skipped";
    case "unmapped":
      return "Unmapped";
    default:
      return status;
  }
}

function statusVariant(status: ImportPreviewRow["status"]): "default" | "secondary" | "outline" | "destructive" {
  switch (status) {
    case "will_fill":
      return "default";
    case "will_update":
      return "destructive";
    case "unmapped":
      return "secondary";
    default:
      return "outline";
  }
}

export function ResearchBriefPreviewDialog({
  open,
  onOpenChange,
  preview,
  onConfirm,
}: ResearchBriefPreviewDialogProps) {
  const initialSelected = useMemo(() => {
    if (!preview) return new Set<string>();
    return new Set(preview.rows.filter((row) => row.selected).map((row) => row.id));
  }, [preview]);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(initialSelected);

  useEffect(() => {
    setSelectedIds(initialSelected);
  }, [initialSelected, open]);

  const rows = preview?.rows ?? [];
  const mappedCount = rows.filter((r) => r.status !== "unmapped").length;
  const claimDetected = Boolean(preview?.importedResearchBrief.claimSafetyNotes);
  const missingCount = preview?.importedResearchBrief.missingInformation?.length ?? 0;

  function toggleRow(id: string, checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function handleConfirm() {
    if (!preview) return;
    onConfirm(buildApplyPayload(preview, selectedIds));
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto" data-testid="research-brief-preview-dialog">
        <DialogHeader>
          <DialogTitle>Import preview</DialogTitle>
          <DialogDescription>
            Review mapped fields before applying. Existing values are not overwritten unless you select them.
          </DialogDescription>
        </DialogHeader>

        {preview && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">{mappedCount} mapped fields</Badge>
              <Badge variant="outline">{preview.unmappedSections.length} unmapped sections</Badge>
              {claimDetected && <Badge variant="default">Claim/safety notes detected</Badge>}
              {missingCount > 0 && <Badge variant="outline">{missingCount} missing-info items</Badge>}
            </div>

            {preview.errors.length > 0 && (
              <Alert variant="destructive">
                <AlertTitle>Import blocked</AlertTitle>
                <AlertDescription>{preview.errors.join(" ")}</AlertDescription>
              </Alert>
            )}

            {preview.warnings.length > 0 && (
              <Alert>
                <AlertTriangle className="size-4" />
                <AlertTitle>Warnings</AlertTitle>
                <AlertDescription>
                  <ul className="list-disc pl-4 space-y-1">
                    {preview.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            <div className="rounded-lg border overflow-hidden">
              <div className="grid grid-cols-[auto_1fr_1fr_auto] gap-2 bg-muted/50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <span>Use</span>
                <span>Section / value</span>
                <span>Target field</span>
                <span>Status</span>
              </div>
              <div className="divide-y max-h-[min(50vh,28rem)] overflow-y-auto">
                {rows.map((row) => (
                  <div
                    key={row.id}
                    className="grid grid-cols-[auto_1fr_1fr_auto] gap-2 px-3 py-3 text-sm items-start"
                    data-testid={`research-brief-preview-row-${row.id}`}
                  >
                    <Checkbox
                      checked={selectedIds.has(row.id)}
                      disabled={row.status === "skipped" || preview.errors.length > 0}
                      onCheckedChange={(checked) => toggleRow(row.id, checked === true)}
                      aria-label={`Import ${row.targetLabel}`}
                    />
                    <div className="min-w-0 space-y-1">
                      <p className="font-medium text-foreground">{row.section}</p>
                      <p className="text-muted-foreground whitespace-pre-line break-words">{row.extractedValue}</p>
                      {row.warning && (
                        <p className="text-xs text-amber-700 flex items-center gap-1">
                          <AlertTriangle className="size-3.5 shrink-0" />
                          {row.warning}
                        </p>
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium">{row.targetLabel}</p>
                      <p className="text-xs text-muted-foreground">{row.targetPath}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <Badge variant={statusVariant(row.status)} className={cn("shrink-0")}>
                        {statusLabel(row.status)}
                      </Badge>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2"
                        onClick={() => void navigator.clipboard.writeText(String(row.extractedValue))}
                      >
                        <Copy className="size-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleConfirm}
            disabled={!preview || preview.errors.length > 0 || selectedIds.size === 0}
            data-testid="research-brief-confirm-import-button"
          >
            Confirm import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
