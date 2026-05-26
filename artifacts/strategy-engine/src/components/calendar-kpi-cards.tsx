import { useMemo, useState } from "react";
import { Pie, PieChart, Bar, BarChart, Cell, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Button } from "@/components/ui/button";

type MetricMode = "text" | "graph";
const DONUT_COLORS = ["#B85C38", "#A38560", "#D9C6A5", "#6B4E3D", "#8E7B6A", "#C7B299"];

interface Props {
  platformSplit: Record<string, number>;
  distribution: Record<string, number>;
  formats: Record<string, number>;
}

export function CalendarKpiCards({ platformSplit, distribution, formats }: Props) {
  return (
    <>
      {Object.keys(platformSplit).length > 0 && (
        <KpiMetricCard
          label="Platform split"
          valueSuffix="posts"
          data={toChartData(platformSplit)}
          chart="donut"
          testId="kpi-platform-split"
        />
      )}
      <KpiMetricCard
        label="Bucket mix"
        valueSuffix="posts"
        data={toChartData(distribution)}
        chart="donut"
        testId="kpi-pillar-mix"
      />
      <KpiMetricCard
        label="Format mix"
        valueSuffix="posts"
        data={toChartData(formats)}
        chart="bar"
        testId="kpi-format-mix"
      />
    </>
  );
}

function KpiMetricCard({
  label,
  valueSuffix,
  data,
  chart,
  testId,
}: {
  label: string;
  valueSuffix: string;
  data: Array<{ key: string; label: string; value: number; color: string }>;
  chart: "donut" | "bar";
  testId: string;
}) {
  const [mode, setMode] = useState<MetricMode>("text");
  const total = useMemo(() => data.reduce((acc, item) => acc + item.value, 0), [data]);

  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm" data-testid={testId}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-xs uppercase tracking-wider text-foreground font-bold">
          {label}
        </p>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs"
          onClick={() => setMode((prev) => (prev === "text" ? "graph" : "text"))}
          aria-label={mode === "text" ? `View graph for ${label}` : `View text for ${label}`}
          data-testid={`${testId}-toggle`}
        >
          {mode === "text" ? "View graph" : "View text"}
        </Button>
      </div>

      {mode === "text" ? (
        <div className="space-y-1.5 text-sm">
          {data.map((item) => (
            <Row key={item.key} label={item.label} value={`${item.value} ${valueSuffix}`} />
          ))}
        </div>
      ) : (
        <div className="space-y-2" data-testid={`${testId}-graph`}>
          {chart === "donut" ? (
            <ChartContainer config={toChartConfig(data)} className="mx-auto h-[180px] w-full max-w-[220px] sm:max-w-[260px]">
              <PieChart>
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      formatter={(value, name) => {
                        const n = Number(value);
                        const pct = total > 0 ? Math.round((n / total) * 100) : 0;
                        return (
                          <div className="flex w-full items-center justify-between gap-3">
                            <span className="text-muted-foreground">{String(name)}</span>
                            <span className="font-medium">{`${n} ${valueSuffix} (${pct}%)`}</span>
                          </div>
                        );
                      }}
                    />
                  }
                />
                <Pie data={data} dataKey="value" nameKey="label" innerRadius={46} outerRadius={74}>
                  {data.map((item) => (
                    <Cell key={item.key} fill={item.color} />
                  ))}
                </Pie>
                <ChartLegend
                  verticalAlign="bottom"
                  align="center"
                  content={
                    <ChartLegendContent
                      payload={data.map((item) => ({
                        value: `${item.label}: ${item.value} (${total > 0 ? Math.round((item.value / total) * 100) : 0}%)`,
                        dataKey: item.key,
                        color: item.color,
                        type: "circle",
                      }))}
                    />
                  }
                />
              </PieChart>
            </ChartContainer>
          ) : (
            <ChartContainer config={toChartConfig(data)} className="h-[180px] w-full">
              <BarChart data={data} layout="vertical" margin={{ left: 8, right: 12, top: 2, bottom: 2 }}>
                <XAxis type="number" hide />
                <YAxis
                  type="category"
                  dataKey="label"
                  width={72}
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                />
                <ChartTooltip
                  cursor={false}
                  content={
                    <ChartTooltipContent
                      formatter={(value, name) => (
                        <div className="flex w-full items-center justify-between gap-3">
                          <span className="text-muted-foreground">{String(name)}</span>
                          <span className="font-medium">{`${Number(value)} ${valueSuffix}`}</span>
                        </div>
                      )}
                    />
                  }
                />
                <Bar dataKey="value" radius={4}>
                  {data.map((item) => (
                    <Cell key={item.key} fill={item.color} />
                  ))}
                </Bar>
              </BarChart>
            </ChartContainer>
          )}
        </div>
      )}
    </div>
  );
}

function toChartData(input: Record<string, number>) {
  return Object.entries(input).map(([key, value], index) => ({
    key,
    label: prettify(key),
    value: Number(value) || 0,
    color: DONUT_COLORS[index % DONUT_COLORS.length]!,
  }));
}

function toChartConfig(data: Array<{ key: string; label: string; color: string }>) {
  return data.reduce<ChartConfig>((config, item) => {
    config[item.key] = { label: item.label, color: item.color };
    return config;
  }, {});
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-md bg-muted/25 px-2.5 py-2">
      <span className="text-foreground font-semibold leading-snug">{label}</span>
      <span className="text-foreground/85 font-medium text-right leading-snug">{value}</span>
    </div>
  );
}

function prettify(s: string) {
  const spaced = s.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : s;
}
