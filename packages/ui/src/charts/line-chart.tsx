'use client';

import * as React from 'react';
import {
  CartesianGrid,
  Line,
  LineChart as RLineChart,
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

export interface LineChartProps<T extends Record<string, unknown>> {
  data: T[];
  xKey: keyof T & string;
  series: SeriesDef<keyof T & string>[];
  title?: React.ReactNode;
  description?: React.ReactNode;
  height?: number;
  valueFormatter?: ValueFormatter;
  className?: string;
}

/** Line chart: 2px lines, ≥8px markers with a surface ring, crosshair tooltip. */
export function LineChart<T extends Record<string, unknown>>({
  data,
  xKey,
  series,
  title,
  description,
  height = 240,
  valueFormatter = formatNumber,
  className,
}: LineChartProps<T>) {
  const legend =
    series.length > 1 ? (
      <ChartLegend items={series.map((s, i) => ({ label: s.label, color: seriesColor(i, s.color), shape: 'line' }))} />
    ) : null;

  return (
    <ChartFrame title={title} description={description} legend={legend} height={height} className={className}>
      <ResponsiveContainer width="100%" height="100%">
        <RLineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
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
            cursor={{ stroke: 'var(--color-border-strong)', strokeWidth: 1 }}
            content={<ChartTooltipContent valueFormatter={valueFormatter} />}
          />
          {series.map((s, i) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={seriesColor(i, s.color)}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--color-surface)' }}
              isAnimationActive={false}
            />
          ))}
        </RLineChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
