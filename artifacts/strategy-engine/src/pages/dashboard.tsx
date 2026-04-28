import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useHealthCheck, useListClients, getListClientsQueryKey } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Plus, Globe, Building2, LayoutTemplate, Sparkles } from "lucide-react";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CreateClientDialog } from "@/components/create-client-dialog";
import { AISettingsDialog } from "@/components/ai-settings-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { RuntimeModeBanner } from "@/components/runtime-mode-banner";
import { useToast } from "@/hooks/use-toast";

export default function Dashboard() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: clients, isLoading } = useListClients();
  const { data: health } = useHealthCheck();
  const clientList = Array.isArray(clients) ? clients : [];
  const loadDemo = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/clients/demo/seed", { method: "POST" });
      if (!res.ok) throw new Error(`Demo seed failed: ${res.status}`);
      return res.json() as Promise<{ added: number; message: string }>;
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: getListClientsQueryKey() });
      toast({
        title: "Demo clients ready",
        description: result.message,
      });
    },
    onError: (err) =>
      toast({
        title: "Could not load demo clients",
        description: String(err),
        variant: "destructive",
      }),
  });

  return (
    <div className="min-h-[100dvh] bg-background">
      <header className="border-b border-border/50 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            <div className="size-8 rounded-md bg-primary flex items-center justify-center text-primary-foreground font-serif italic text-lg shadow-sm">
              S
            </div>
            <h1 className="font-serif text-base sm:text-lg font-medium tracking-tight text-foreground truncate">
              Strategy Engine
            </h1>
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto flex-wrap">
            <AISettingsDialog />
            <CreateClientDialog>
              <Button
                size="sm"
                className="gap-2 font-medium shadow-sm w-full sm:w-auto"
                data-testid="new-client-button"
              >
                <Plus className="size-4" />
                New Client
              </Button>
            </CreateClientDialog>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
        <RuntimeModeBanner />
        <div className="flex flex-col gap-2 mb-8 sm:mb-10">
          <h2 className="text-2xl sm:text-3xl font-serif text-foreground tracking-tight">Clients</h2>
          <p className="text-muted-foreground text-sm sm:text-base">
            Select a client to generate or refine their strategy.
          </p>
          {(health as { mode?: string } | undefined)?.mode === "fallback" && (
            <div className="pt-2">
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={() => loadDemo.mutate()}
                disabled={loadDemo.isPending}
                data-testid="load-demo-clients-button"
              >
                <Sparkles className="size-4" />
                {loadDemo.isPending ? "Loading demo clients..." : "Load demo clients"}
              </Button>
            </div>
          )}
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3].map(i => (
              <div key={i} className="border border-border rounded-xl p-6 h-48 bg-card shadow-sm flex flex-col">
                <Skeleton className="h-6 w-1/2 mb-4" />
                <Skeleton className="h-4 w-full mb-2" />
                <Skeleton className="h-4 w-3/4 mb-auto" />
                <Skeleton className="h-8 w-20" />
              </div>
            ))}
          </div>
        ) : !clientList.length ? (
          <div className="flex flex-col items-center justify-center py-24 px-6 text-center border border-dashed border-border rounded-xl bg-card/50">
            <div className="size-12 rounded-full bg-primary/10 text-primary flex items-center justify-center mb-4">
              <Building2 className="size-6" />
            </div>
            <h3 className="text-lg font-serif font-medium mb-2">No clients yet</h3>
            <p className="text-muted-foreground max-w-sm mb-6 text-sm">
              Add your first client to start generating brand strategy and enrichment data.
            </p>
            <CreateClientDialog>
              <Button>Add First Client</Button>
            </CreateClientDialog>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {clientList.map((client, i) => (
              <Link
                key={client.id}
                href={`/clients/${client.id}`}
                className="block group"
                data-testid={`client-card-${client.id}`}
              >
                <div 
                  className="h-full bg-card rounded-xl p-6 border border-border shadow-sm hover:shadow-md transition-all duration-300 hover:border-primary/20 flex flex-col hover:-translate-y-1 animate-in fade-in slide-in-from-bottom-4"
                  style={{ animationDelay: `${i * 50}ms`, animationFillMode: 'both' }}
                >
                  <div className="flex justify-between items-start mb-4 gap-2">
                    <h3 className="font-serif text-lg sm:text-xl font-medium text-foreground group-hover:text-primary transition-colors line-clamp-2 min-w-0">{client.name}</h3>
                    {client.status === 'draft' && <Badge variant="secondary" className="font-medium bg-yellow-100 text-yellow-800 hover:bg-yellow-100 border-transparent">Draft</Badge>}
                    {client.status === 'approved' && <Badge variant="secondary" className="font-medium bg-green-100 text-green-800 hover:bg-green-100 border-transparent">Approved</Badge>}
                    {(!client.status || client.status === 'no-strategy') && <Badge variant="outline" className="font-medium text-muted-foreground border-muted-foreground/30">No Strategy</Badge>}
                  </div>
                  
                  <div className="space-y-3 mb-6 flex-grow">
                    <p className="text-sm text-muted-foreground line-clamp-2 leading-relaxed">
                      {client.oneLineDescription || "No description provided."}
                    </p>
                    
                    {(client.website || client.templateType) && (
                      <div className="flex flex-wrap gap-x-4 gap-y-2 mt-4 text-xs text-muted-foreground/80">
                        {client.website && (
                          <div className="flex items-center gap-1.5">
                            <Globe className="size-3.5" />
                            <span className="truncate max-w-[120px]">{client.website.replace(/^https?:\/\//, '')}</span>
                          </div>
                        )}
                        {client.templateType && (
                          <div className="flex items-center gap-1.5">
                            <LayoutTemplate className="size-3.5" />
                            <span className="capitalize">{client.templateType.replace('_', ' ')}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  
                  <div className="pt-4 border-t border-border/50 text-xs text-muted-foreground/60 font-medium tracking-wide uppercase">
                    Added {format(new Date(client.createdAt), "MMM d, yyyy")}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
