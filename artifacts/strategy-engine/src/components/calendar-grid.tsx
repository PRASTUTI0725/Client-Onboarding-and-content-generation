import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useUpdatePost,
  getGetCalendarQueryKey,
} from "@workspace/api-client-react";
import { CalendarCard } from "./calendar-card";
import { useToast } from "@/hooks/use-toast";

interface Pillar {
  name: string;
  color: string;
  description?: string;
}

interface Post {
  id: string;
  date: string;
  pillar: string;
  format: string;
  hook: string;
  status: string;
}

interface Props {
  posts: Post[];
  pillars: Pillar[];
  clientId: string;
  onSelectPost: (id: string) => void;
}

export function CalendarGrid({ posts, pillars, clientId, onSelectPost }: Props) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [dragOver, setDragOver] = useState<string | null>(null);

  const update = useUpdatePost({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetCalendarQueryKey(clientId) });
      },
      onError: (err) =>
        toast({
          title: "Could not move post",
          description: String(err),
          variant: "destructive",
        }),
    },
  });

  const pillarColorMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of pillars) m.set(p.name.toLowerCase(), p.color);
    return m;
  }, [pillars]);

  const { firstDay, daysInMonth, startWeekday, monthLabel } = useMemo(() => {
    const dates = posts.map((p) => p.date).sort();
    const anchor = dates[0]
      ? new Date(dates[0] + "T00:00:00Z")
      : new Date();
    const year = anchor.getUTCFullYear();
    const month = anchor.getUTCMonth();
    const first = new Date(Date.UTC(year, month, 1));
    const next = new Date(Date.UTC(year, month + 1, 1));
    const diMs = next.getTime() - first.getTime();
    const dim = Math.round(diMs / (1000 * 60 * 60 * 24));
    return {
      firstDay: first,
      daysInMonth: dim,
      startWeekday: first.getUTCDay(),
      monthLabel: first.toLocaleDateString(undefined, {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      }),
    };
  }, [posts]);

  const postsByDate = useMemo(() => {
    const m = new Map<string, Post[]>();
    for (const p of posts) {
      const arr = m.get(p.date) ?? [];
      arr.push(p);
      m.set(p.date, arr);
    }
    return m;
  }, [posts]);

  const cells: Array<{ date: string | null; key: string }> = [];
  for (let i = 0; i < startWeekday; i++) {
    cells.push({ date: null, key: `pad-start-${i}` });
  }
  for (let day = 1; day <= daysInMonth; day++) {
    const dt = new Date(firstDay);
    dt.setUTCDate(day);
    const iso = dt.toISOString().slice(0, 10);
    cells.push({ date: iso, key: iso });
  }
  while (cells.length % 7 !== 0) {
    cells.push({ date: null, key: `pad-end-${cells.length}` });
  }

  function colorFor(pillar: string) {
    return pillarColorMap.get(pillar.toLowerCase()) ?? "#9CA3AF";
  }

  const todayIso = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <h2 className="font-serif text-2xl tracking-tight">{monthLabel}</h2>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {pillars.map((p) => (
            <span key={p.name} className="inline-flex items-center gap-1.5">
              <span
                className="inline-block size-2 rounded-full"
                style={{ backgroundColor: p.color }}
              />
              {p.name}
            </span>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-7 gap-px bg-border rounded-lg overflow-hidden border border-border shadow-sm">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div
            key={d}
            className="bg-card px-2 py-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground text-center"
          >
            {d}
          </div>
        ))}
        {cells.map(({ date, key }) => {
          if (!date) {
            return <div key={key} className="bg-muted/30 min-h-[120px]" />;
          }
          const dayPosts = postsByDate.get(date) ?? [];
          const isToday = date === todayIso;
          return (
            <div
              key={key}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(date);
              }}
              onDragLeave={() => setDragOver((d) => (d === date ? null : d))}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(null);
                const postId = e.dataTransfer.getData("text/post-id");
                const fromDate = e.dataTransfer.getData("text/post-date");
                if (postId && fromDate !== date) {
                  update.mutate({ postId, data: { date } });
                }
              }}
              className={`bg-card min-h-[120px] p-1.5 space-y-1 transition-colors ${
                dragOver === date ? "bg-accent/40" : ""
              }`}
            >
              <div className="flex items-center justify-between px-1">
                <span
                  className={`text-[11px] font-medium ${
                    isToday
                      ? "text-primary-foreground bg-primary rounded-full size-5 inline-flex items-center justify-center"
                      : "text-muted-foreground"
                  }`}
                >
                  {Number(date.slice(8, 10))}
                </span>
              </div>
              {dayPosts.map((p) => (
                <CalendarCard
                  key={p.id}
                  format={p.format}
                  pillar={p.pillar}
                  hook={p.hook}
                  status={p.status}
                  pillarColor={colorFor(p.pillar)}
                  onClick={() => onSelectPost(p.id)}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData("text/post-id", p.id);
                    e.dataTransfer.setData("text/post-date", p.date);
                    e.dataTransfer.effectAllowed = "move";
                  }}
                />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
