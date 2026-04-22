import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  totalPosts: number;
  onConfirm: (input: { month: string; startDate: string; goal: string; notes: string }) => void;
  isPending: boolean;
}

export function GenerateMonthDialog({ open, onOpenChange, totalPosts, onConfirm, isPending }: Props) {
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-serif text-2xl tracking-tight">
            Plan the month
          </DialogTitle>
          <DialogDescription>
            We'll generate {totalPosts} posts across your active platforms, distributed by your SOW
            and the goal below.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="month">Month label</Label>
              <Input id="month" value={month} onChange={(e) => setMonth(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="start">Start date</Label>
              <Input
                id="start"
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
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="e.g. Drive 200 demo signups via the new template launch"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="notes">Notes & constraints</Label>
            <Textarea
              id="notes"
              rows={4}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Anything specific: launches, blackout days, hooks to lean into, themes to avoid..."
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button
            onClick={() => onConfirm({ month, startDate, goal, notes })}
            disabled={isPending || !month || !startDate}
          >
            {isPending ? "Generating..." : "Generate calendar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
