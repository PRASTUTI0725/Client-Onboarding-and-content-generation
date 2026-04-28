import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { readAISettings, type AIProvider, writeAISettings } from "@/lib/ai-settings";
import { useToast } from "@/hooks/use-toast";

const PROVIDERS: AIProvider[] = [
  "openrouter",
  "groq",
  "nvidia",
  "gemini",
  "perplexity",
  "openai",
  "claude",
  "codex",
];

export function AISettingsDialog() {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const [useRealAI, setUseRealAI] = useState(true);
  const [provider, setProvider] = useState<AIProvider>("openrouter");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");

  useEffect(() => {
    if (!open) return;
    const settings = readAISettings();
    setUseRealAI(settings.useRealAI);
    setProvider(settings.provider);
    setApiKey(settings.apiKey);
    setModel(settings.model);
  }, [open]);

  function save() {
    writeAISettings({ useRealAI, provider, apiKey: apiKey.trim(), model: model.trim() });
    toast({
      title: "AI settings saved",
      description: useRealAI
        ? "Real AI mode is enabled for new generations."
        : "Template preview mode: enable real AI keys (or USE_REAL_AI on the server) for live generation.",
    });
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" data-testid="open-ai-settings-button">
          AI Settings
        </Button>
      </DialogTrigger>
      <DialogContent className="w-[calc(100vw-1.5rem)] max-w-lg sm:w-full">
        <DialogHeader>
          <DialogTitle>AI Provider Settings</DialogTitle>
          <DialogDescription>
            Enter provider credentials for real generation. Leave key blank to keep using server env keys.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={useRealAI}
              onChange={(e) => setUseRealAI(e.target.checked)}
              className="size-4 accent-primary"
            />
            Use real AI generation
          </label>
          <div className="space-y-1.5">
            <Label>Provider</Label>
            <div className="flex flex-wrap gap-2">
              {PROVIDERS.map((p) => (
                <Button
                  key={p}
                  type="button"
                  variant={provider === p ? "default" : "outline"}
                  size="sm"
                  onClick={() => setProvider(p)}
                  className="capitalize"
                >
                  {p}
                </Button>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ai-api-key">API key</Label>
            <Input
              id="ai-api-key"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-... or pplx-..."
              type="password"
              data-testid="ai-api-key-input"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ai-model">Model override (optional)</Label>
            <Input
              id="ai-model"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="e.g. sonar-pro, gpt-4o-mini"
            />
          </div>
        </div>
        <DialogFooter className="flex-col-reverse sm:flex-row gap-2">
          <Button variant="outline" onClick={() => setOpen(false)} className="w-full sm:w-auto">
            Cancel
          </Button>
          <Button onClick={save} className="w-full sm:w-auto" data-testid="save-ai-settings-button">
            Save settings
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
