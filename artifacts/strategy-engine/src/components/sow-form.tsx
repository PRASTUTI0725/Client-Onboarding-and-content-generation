import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useUpdateSow,
  getGetClientQueryKey,
  type Sow,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Plus, X, Save } from "lucide-react";

const PLATFORM_OPTIONS = ["Instagram", "LinkedIn", "TikTok", "X", "YouTube"];
const PILLAR_PRESETS = ["education", "thought_leadership", "social_proof", "behind_the_scenes", "promotion", "community"];

interface Props {
  clientId: string;
  initial: Sow | null | undefined;
  onSaved?: () => void;
}

export function SowForm({ clientId, initial, onSaved }: Props) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const update = useUpdateSow({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetClientQueryKey(clientId) });
        toast({ title: "SOW saved" });
        onSaved?.();
      },
      onError: (err) =>
        toast({ title: "Could not save SOW", description: String(err), variant: "destructive" }),
    },
  });

  const [platforms, setPlatforms] = useState<string[]>(initial?.platforms ?? ["Instagram"]);
  const [monthlyPosts, setMonthlyPosts] = useState<Record<string, number>>(
    (initial?.monthlyPosts as Record<string, number>) ?? { Instagram: 16 },
  );
  const [contentMix, setContentMix] = useState<Record<string, number>>(
    (initial?.contentMix as Record<string, number>) ?? {
      education: 40,
      thought_leadership: 30,
      social_proof: 20,
      promotion: 10,
    },
  );
  const [deliverables, setDeliverables] = useState<string[]>(initial?.deliverables ?? []);
  const [newDeliverable, setNewDeliverable] = useState("");
  const [toneByPlatform, setToneByPlatform] = useState<Record<string, string>>(
    (initial?.toneByPlatform as Record<string, string>) ?? {},
  );

  useEffect(() => {
    // Keep monthlyPosts and toneByPlatform in sync with selected platforms.
    setMonthlyPosts((prev) => {
      const out: Record<string, number> = {};
      for (const p of platforms) out[p] = prev[p] ?? 12;
      return out;
    });
    setToneByPlatform((prev) => {
      const out: Record<string, string> = {};
      for (const p of platforms) out[p] = prev[p] ?? "";
      return out;
    });
  }, [platforms]);

  const togglePlatform = (p: string) => {
    setPlatforms((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));
  };

  const setPillarPercent = (k: string, v: number) => {
    setContentMix((prev) => ({ ...prev, [k]: v }));
  };

  const addPillar = () => {
    const next = PILLAR_PRESETS.find((p) => contentMix[p] === undefined);
    if (next) setContentMix((prev) => ({ ...prev, [next]: 0 }));
  };

  const removePillar = (k: string) => {
    setContentMix((prev) => {
      const out = { ...prev };
      delete out[k];
      return out;
    });
  };

  const addDeliverable = () => {
    if (newDeliverable.trim()) {
      setDeliverables((prev) => [...prev, newDeliverable.trim()]);
      setNewDeliverable("");
    }
  };

  const totalPercent = Object.values(contentMix).reduce((a, b) => a + (Number(b) || 0), 0);
  const totalPosts = Object.values(monthlyPosts).reduce((a, b) => a + (Number(b) || 0), 0);

  const save = () => {
    if (platforms.length === 0) {
      toast({ title: "Pick at least one platform", variant: "destructive" });
      return;
    }
    if (totalPercent !== 100) {
      toast({
        title: `Content mix should sum to 100% (currently ${totalPercent}%)`,
        variant: "destructive",
      });
      return;
    }
    update.mutate({
      clientId,
      data: {
        platforms,
        monthlyPosts,
        contentMix,
        deliverables,
        toneByPlatform,
      },
    });
  };

  return (
    <div className="space-y-6">
      <Section
        label="Platforms"
        hint="Where the brand actually posts. Drives format menu and tone."
      >
        <div className="flex flex-wrap gap-2">
          {PLATFORM_OPTIONS.map((p) => {
            const active = platforms.includes(p);
            return (
              <button
                key={p}
                type="button"
                onClick={() => togglePlatform(p)}
                className={`px-3 py-1.5 rounded-full border text-sm transition-colors ${
                  active
                    ? "bg-foreground text-background border-foreground"
                    : "bg-card border-border text-muted-foreground hover:border-foreground/40"
                }`}
              >
                {p}
              </button>
            );
          })}
        </div>
      </Section>

      <Section
        label="Monthly post counts"
        hint={`Posts per platform per month. Total: ${totalPosts}.`}
      >
        <div className="space-y-2">
          {platforms.map((p) => (
            <div key={p} className="flex items-center gap-3">
              <span className="text-sm w-28 text-muted-foreground">{p}</span>
              <Input
                type="number"
                min={0}
                value={monthlyPosts[p] ?? 0}
                onChange={(e) =>
                  setMonthlyPosts((prev) => ({ ...prev, [p]: Number(e.target.value) || 0 }))
                }
                className="w-24"
              />
              <span className="text-xs text-muted-foreground">posts/mo</span>
            </div>
          ))}
        </div>
      </Section>

      <Section
        label="Content mix"
        hint={`Pillar percentages. Must sum to 100% (currently ${totalPercent}%).`}
      >
        <div className="space-y-2">
          {Object.entries(contentMix).map(([k, v]) => (
            <div key={k} className="flex items-center gap-3">
              <Input
                value={k}
                onChange={(e) => {
                  const newKey = e.target.value
                    .toLowerCase()
                    .replace(/\s+/g, "_")
                    .replace(/[^a-z0-9_]/g, "");
                  setContentMix((prev) => {
                    const out: Record<string, number> = {};
                    for (const [oldK, val] of Object.entries(prev)) {
                      out[oldK === k ? newKey : oldK] = val;
                    }
                    return out;
                  });
                }}
                className="flex-1"
              />
              <Input
                type="number"
                min={0}
                max={100}
                value={v}
                onChange={(e) => setPillarPercent(k, Number(e.target.value) || 0)}
                className="w-20"
              />
              <span className="text-xs text-muted-foreground w-4">%</span>
              <button
                type="button"
                onClick={() => removePillar(k)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={addPillar} className="gap-1.5 mt-1">
            <Plus className="size-3.5" /> Add pillar
          </Button>
        </div>
      </Section>

      <Section
        label="Tone by platform"
        hint="One short sentence per platform — the voice direction the writer should follow."
      >
        <div className="space-y-2">
          {platforms.map((p) => (
            <div key={p} className="space-y-1">
              <span className="text-xs uppercase tracking-wider text-muted-foreground">{p}</span>
              <Input
                value={toneByPlatform[p] ?? ""}
                onChange={(e) =>
                  setToneByPlatform((prev) => ({ ...prev, [p]: e.target.value }))
                }
                placeholder={`How should ${p} sound?`}
              />
            </div>
          ))}
        </div>
      </Section>

      <Section
        label="Recurring deliverables"
        hint="Repeating slots you committed to (e.g. weekly story takeover, 1 monthly hero carousel)."
      >
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {deliverables.map((d, i) => (
              <Badge key={i} variant="secondary" className="gap-1.5 font-normal">
                {d}
                <button
                  onClick={() => setDeliverables((prev) => prev.filter((_, j) => j !== i))}
                  className="hover:text-foreground"
                >
                  <X className="size-3" />
                </button>
              </Badge>
            ))}
          </div>
          <div className="flex gap-2">
            <Textarea
              rows={1}
              value={newDeliverable}
              onChange={(e) => setNewDeliverable(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  addDeliverable();
                }
              }}
              placeholder="e.g. 1 monthly hero carousel"
              className="resize-none"
            />
            <Button variant="outline" size="sm" onClick={addDeliverable}>
              <Plus className="size-4" />
            </Button>
          </div>
        </div>
      </Section>

      <div className="flex justify-end pt-2">
        <Button onClick={save} disabled={update.isPending} className="gap-2">
          <Save className="size-4" />
          {update.isPending ? "Saving..." : "Save SOW"}
        </Button>
      </div>
    </div>
  );
}

function Section({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div>
        <p className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
          {label}
        </p>
        {hint && <p className="text-xs text-muted-foreground/80 mt-0.5">{hint}</p>}
      </div>
      {children}
    </div>
  );
}
