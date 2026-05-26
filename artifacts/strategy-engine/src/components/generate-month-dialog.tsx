import { useEffect, useState } from "react";
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
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  totalPosts: number;
  onConfirm: (input: { month: string; startDate: string; goal: string; notes: string }) => void;
  isPending: boolean;
  mode?: "generate" | "regenerate";
  initialMonth?: string | null;
  initialStartDate?: string | null;
  initialGoal?: string | null;
  initialNotes?: string | null;
}

export function GenerateMonthDialog({
  open,
  onOpenChange,
  totalPosts,
  onConfirm,
  isPending,
  mode = "generate",
  initialMonth,
  initialStartDate,
  initialGoal,
  initialNotes,
}: Props) {
  const today = new Date();
  const defaultStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))
    .toISOString()
    .slice(0, 10);
  const defaultMonth = today.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

  const [month, setMonth] = useState(defaultMonth);
  const [startDate, setStartDate] = useState(defaultStart);
  const [goal, setGoal] = useState("");
  const [notes, setNotes] = useState("");
  const isRegenerate = mode === "regenerate";
  const [overwriteConfirmed, setOverwriteConfirmed] = useState(!isRegenerate);

  useEffect(() => {
    if (!open) return;
    setMonth(initialMonth || defaultMonth);
    setStartDate(initialStartDate || defaultStart);
    setGoal(initialGoal || "");
    setNotes(initialNotes || "");
    setOverwriteConfirmed(!isRegenerate);
  }, [defaultMonth, defaultStart, initialGoal, initialMonth, initialNotes, initialStartDate, isRegenerate, open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-1.5rem)] max-w-lg sm:w-full">
        <DialogHeader>
          <DialogTitle className="font-serif text-2xl tracking-tight">
            {isRegenerate ? "Regenerate calendar" : "Plan the month"}
          </DialogTitle>
          <DialogDescription>
            {isRegenerate
              ? `This will replace the current calendar with ${totalPosts} posts generated from the approved SOW, Business DNA, and Jump-to-Action.`
              : `We'll generate ${totalPosts} posts across your active platforms, distributed by your SOW and the goal below.`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {isRegenerate && (
            <div className="space-y-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-3 text-sm text-amber-950">
              <p>
                This will replace the current calendar for this month. Existing post edits, statuses, scheduled dates,
                and comments may be overwritten.
              </p>
              <label className="flex items-start gap-3 rounded-md border border-amber-200 bg-white/70 px-3 py-2">
                <Checkbox
                  checked={overwriteConfirmed}
                  onCheckedChange={(checked) => setOverwriteConfirmed(checked === true)}
                  data-testid="confirm-overwrite-calendar-checkbox"
                  className="mt-0.5 border-amber-500 data-[state=checked]:bg-amber-600"
                />
                <span className="leading-5">
                  I understand the current calendar will be replaced.
                </span>
              </label>
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="month">Month label</Label>
              <Input
                id="month"
                data-testid="month-label-input"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="start">Start date</Label>
              <Input
                id="start"
                data-testid="start-date-input"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="goal">Monthly goal</Label>
            <Input
              id="goal"
              data-testid="monthly-goal-input"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="e.g. Drive 200 demo signups via the new template launch"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="notes">Notes & constraints</Label>
            <Textarea
              id="notes"
              data-testid="monthly-notes-input"
              rows={4}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Anything specific: launches, blackout days, hooks to lean into, themes to avoid..."
            />
          </div>
        </div>

        <DialogFooter className="flex-col-reverse sm:flex-row gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
            data-testid="cancel-generate-calendar-button"
          >
            Cancel
          </Button>
          <Button
            onClick={() => onConfirm({ month, startDate, goal, notes })}
            disabled={isPending || !month || !startDate || (isRegenerate && !overwriteConfirmed)}
            data-testid="confirm-generate-calendar-button"
            className="w-full sm:w-auto"
          >
            {isPending ? "Generating..." : isRegenerate ? "Replace current calendar" : "Generate calendar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
