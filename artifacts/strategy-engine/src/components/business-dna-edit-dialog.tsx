import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { getGetClientQueryKey } from "@workspace/api-client-react";
import { localApiFetch } from "@/lib/local-api";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  clientId: string;
  businessDna: Record<string, unknown> | null | undefined;
};

export function BusinessDnaEditDialog({ open, onOpenChange, clientId, businessDna }: Props) {
  const [text, setText] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (open) {
      try {
        setText(JSON.stringify(businessDna ?? {}, null, 2));
      } catch {
        setText("{}");
      }
    }
  }, [open, businessDna]);

  async function save() {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Root must be a JSON object");
      }
    } catch (e) {
      toast({
        title: "Invalid JSON",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
      return;
    }
    setPending(true);
    try {
      const res = await localApiFetch(`/api/clients/${clientId}/onboarding`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessDna: parsed }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      await queryClient.invalidateQueries({ queryKey: getGetClientQueryKey(clientId) });
      toast({ title: "Business DNA saved" });
      onOpenChange(false);
    } catch (e) {
      toast({
        title: "Save failed",
        description: String(e),
        variant: "destructive",
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col gap-0 p-0">
        <DialogHeader className="px-6 pt-6 pb-2">
          <DialogTitle>Edit business DNA</DialogTitle>
          <DialogDescription className="text-sm leading-relaxed">
            Full JSON for <code className="text-xs bg-muted px-1 rounded">businessDna</code>. Invalid JSON
            will be rejected. Structure should match the enrichment model (purpose, mission, targetAudience,
            mcp, confidenceScores, …). Keep a backup before large edits.
          </DialogDescription>
        </DialogHeader>
        <div className="px-6 flex-1 min-h-0 flex flex-col gap-2">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="font-mono text-xs min-h-[min(60vh,520px)] leading-relaxed resize-y"
            spellCheck={false}
          />
        </div>
        <DialogFooter className="px-6 py-4 border-t">
          <Button variant="outline" type="button" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={save} disabled={pending}>
            {pending ? "Saving…" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
