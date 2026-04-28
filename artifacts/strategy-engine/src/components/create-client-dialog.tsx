import { useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  customFetch,
  getGetClientQueryKey,
  getListClientsQueryKey,
} from "@workspace/api-client-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { confirmPreflightLimit, estimateBytes, estimateTokens } from "@/lib/request-preflight";

interface Props {
  children: ReactNode;
}

function describeCreateClientError(err: unknown): string {
  if (err instanceof TypeError) {
    return "Backend unreachable. We could not connect to the API. Check that the backend server is running on port 3001 and try again.";
  }
  if (!(err instanceof Error)) {
    return "Server failure while creating the client. Please try again.";
  }

  if (/HTTP 401|Invalid API key|unauthorized/i.test(err.message)) {
    return "Unauthorized. The API key was rejected by the backend.";
  }
  if (/HTTP 5\d\d|Failed to create client|Internal server error/i.test(err.message)) {
    return "Server failure while creating the client. Please try again.";
  }
  return err.message;
}

export function CreateClientDialog({ children }: Props) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [instagramHandle, setInstagramHandle] = useState("");
  const [oneLineDescription, setOneLineDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [progressCopy, setProgressCopy] = useState<string | null>(null);
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  function resetForm() {
    setName("");
    setWebsiteUrl("");
    setInstagramHandle("");
    setOneLineDescription("");
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      toast({
        title: "Client name is required",
        variant: "destructive",
      });
      return;
    }

    void (async () => {
      const startedAt = performance.now();
      const payload = {
        name: name.trim(),
        websiteUrl: websiteUrl.trim(),
        instagramHandle: instagramHandle.trim(),
        oneLineDescription: oneLineDescription.trim(),
      };
      const proceed = confirmPreflightLimit({
        context: "Client creation preflight",
        estimatedTokens: estimateTokens(payload),
        estimatedBytes: estimateBytes(payload),
        tokenThreshold: 1200,
        byteThreshold: 80 * 1024,
      });
      if (!proceed) return;
      setSubmitting(true);
      setProgressCopy("Creating client workspace...");
      try {
        const data = await customFetch<{ id: string }>("/api/clients", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        setProgressCopy("Opening workspace while brand context processes...");
        void queryClient.invalidateQueries({ queryKey: getListClientsQueryKey() });
        void queryClient.invalidateQueries({
          queryKey: getGetClientQueryKey(data.id),
          exact: true,
        });
        setOpen(false);
        resetForm();
        toast({
          title: "Client created",
          description: "Paste SOW details into the workspace to continue.",
        });
        navigate(`/clients/${data.id}`);
        const elapsedMs = Math.round(performance.now() - startedAt);
        console.info("[ui] create-client flow completed", { elapsedMs, clientId: data.id });
      } catch (err) {
        toast({
          title: "Could not create client",
          description: describeCreateClientError(err),
          variant: "destructive",
        });
      } finally {
        setProgressCopy(null);
        setSubmitting(false);
      }
    })();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="w-[calc(100vw-1.5rem)] max-w-lg sm:w-full">
        <DialogHeader>
          <DialogTitle className="font-serif text-2xl tracking-tight">
            Create a new client
          </DialogTitle>
          <DialogDescription>
            Start with the basics, then paste SOW details directly into the workspace. PDF upload is hidden for now to
            keep founder testing fast.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label htmlFor="name">Client name</Label>
            <Input
              id="name"
              data-testid="client-name-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Maison & Co."
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="website">Website (optional)</Label>
            <Input
              id="website"
              data-testid="client-website-input"
              value={websiteUrl}
              onChange={(e) => setWebsiteUrl(e.target.value)}
              placeholder="https://example.com"
            />
            <p className="text-xs text-muted-foreground">Add this if you want website-based brand context later.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="instagram">Instagram handle or notes (optional)</Label>
            <Input
              id="instagram"
              data-testid="client-instagram-input"
              value={instagramHandle}
              onChange={(e) => setInstagramHandle(e.target.value)}
              placeholder="@handle or short positioning note"
            />
            <p className="text-xs text-muted-foreground">You can paste better positioning details into the SOW form next.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="desc">One-line business summary (optional)</Label>
            <Textarea
              id="desc"
              data-testid="client-description-input"
              value={oneLineDescription}
              onChange={(e) => setOneLineDescription(e.target.value)}
              placeholder="What does this client sell, and who is it for?"
              rows={2}
            />
          </div>
          {progressCopy && (
            <p className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-primary">
              {progressCopy}
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            Next step after creation: open the SOW section and paste goals, launch plan, platforms, and deliverables.
          </p>
          <DialogFooter className="pt-2 flex-col-reverse sm:flex-row gap-2">
            <Button
              type="button"
              variant="ghost"
              data-testid="cancel-create-client-button"
              onClick={() => setOpen(false)}
              disabled={submitting}
              className="w-full sm:w-auto"
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting} data-testid="create-client-submit" className="w-full sm:w-auto">
              {submitting ? "Creating..." : "Create client"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
