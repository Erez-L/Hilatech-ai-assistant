'use client';

import * as React from 'react';
import {
  Bar,
  BarChart as RBarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatCompact, formatNumber } from '../lib/format';
import {
  CHART_FONT_SIZE,
  CHART_GRID,
  CHART_TEXT,
  ChartFrame,
  ChartLegend,
  ChartTooltipContent,
  seriesColor,
  type SeriesDef,
  type ValueFormatter,
} from './chart-shared';

export interface BarChartProps<T extends Record<string, unknown>> {
  data: T[];
  /** Key of the category (x-axis) field. */
  xKey: keyof T & string;
  series: SeriesDef<keyof T & string>[];
  stacked?: boolean;
  title?: React.ReactNode;
  description?: React.ReactNode;
  height?: number;
  valueFormatter?: ValueFormatter;
  className?: string;
}

/** Column chart: thin marks (≤24px), 4px rounded caps, hairline grid, hover tooltip. */
export function BarChart<T extends Record<string, unknown>>({
  data,
  xKey,
  series,
  stacked = false,
  title,
  description,
  height = 240,
  valueFormatter = formatNumber,
  className,
}: BarChartProps<T>) {
  const legend =
    series.length > 1 ? (
      <ChartLegend
        items={series.map((s, i) => ({ label: s.label, color: seriesColor(i, s.color) }))}
      />
    ) : null;

  return (
    <ChartFrame
      title={title}
      description={description}
      legend={legend}
      height={height}
      className={className}
    >
      <ResponsiveContainer width="100%" height="100%">
        <RBarChart
          data={data}
          margin={{ top: 8, right: 8, bottom: 0, left: -12 }}
          barCategoryGap="30%"
          barGap={2}
        >
          <CartesianGrid vertical={false} stroke={CHART_GRID} strokeWidth={1} />
          <XAxis
            dataKey={xKey}
            tickLine={false}
            axisLine={{ stroke: CHART_GRID }}
            tick={{ fill: CHART_TEXT, fontSize: CHART_FONT_SIZE }}
            tickMargin={8}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            tick={{ fill: CHART_TEXT, fontSize: CHART_FONT_SIZE }}
            tickFormatter={(v: number) => formatCompact(v)}
            width={48}
            allowDecimals={false}
          />
          <Tooltip
            cursor={{ fill: 'var(--color-surface-muted)', opacity: 0.6 }}
            content={<ChartTooltipContent valueFormatter={valueFormatter} />}
          />
          {series.map((s, i) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              name={s.label}
              stackId={stacked ? 'stack' : undefined}
              fill={seriesColor(i, s.color)}
              maxBarSize={24}
              radius={stacked && i < series.length - 1 ? 0 : [4, 4, 0, 0]}
              isAnimationActive={false}
            />
          ))}
        </RBarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
