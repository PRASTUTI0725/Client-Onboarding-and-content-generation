import { useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateClient,
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

interface Props {
  children: ReactNode;
}

export function CreateClientDialog({ children }: Props) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [instagramHandle, setInstagramHandle] = useState("");
  const [oneLineDescription, setOneLineDescription] = useState("");
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const create = useCreateClient({
    mutation: {
      onSuccess: (client) => {
        queryClient.invalidateQueries({ queryKey: getListClientsQueryKey() });
        setOpen(false);
        setName("");
        setWebsiteUrl("");
        setInstagramHandle("");
        setOneLineDescription("");
        navigate(`/clients/${client.id}`);
      },
      onError: (err) => {
        toast({
          title: "Could not create client",
          description: String(err),
          variant: "destructive",
        });
      },
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name || !websiteUrl || !instagramHandle || !oneLineDescription) {
      toast({
        title: "All fields are required",
        variant: "destructive",
      });
      return;
    }
    create.mutate({
      data: { name, websiteUrl, instagramHandle, oneLineDescription },
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-serif text-2xl tracking-tight">
            Onboard a new client
          </DialogTitle>
          <DialogDescription>
            Four quick fields. We'll do the rest.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label htmlFor="name">Client name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Maison & Co."
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="website">Website</Label>
            <Input
              id="website"
              value={websiteUrl}
              onChange={(e) => setWebsiteUrl(e.target.value)}
              placeholder="https://maisonandco.com"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="instagram">Instagram handle</Label>
            <Input
              id="instagram"
              value={instagramHandle}
              onChange={(e) => setInstagramHandle(e.target.value)}
              placeholder="@maisonandco"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="desc">One-line description</Label>
            <Textarea
              id="desc"
              value={oneLineDescription}
              onChange={(e) => setOneLineDescription(e.target.value)}
              placeholder="Bespoke heirloom furniture for architects and designers."
              rows={2}
            />
          </div>
          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={create.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? "Saving..." : "Create client"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
