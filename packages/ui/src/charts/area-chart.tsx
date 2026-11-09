'use client';

import * as React from 'react';
import {
  Area,
  AreaChart as RAreaChart,
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

export interface AreaChartProps<T extends Record<string, unknown>> {
  data: T[];
  xKey: keyof T & string;
  series: SeriesDef<keyof T & string>[];
  title?: React.ReactNode;
  description?: React.ReactNode;
  height?: number;
  valueFormatter?: ValueFormatter;
  /** Format x-axis ticks and tooltip labels (e.g. shorten ISO dates). */
  labelFormatter?: (label: string | number) => string;
  /** Hide axes and grid for a sparkline-style rendering. */
  minimal?: boolean;
  className?: string;
}

/** Area chart: 2px line with a soft gradient fill. Use for daily counts and trends over a period. */
export function AreaChart<T extends Record<string, unknown>>({
  data,
  xKey,
  series,
  title,
  description,
  height = 200,
  valueFormatter = formatNumber,
  labelFormatter,
  minimal = false,
  className,
}: AreaChartProps<T>) {
  const gradientId = React.useId().replace(/:/g, '');
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
        <RAreaChart
          data={data}
          margin={
            minimal
              ? { top: 4, right: 0, bottom: 0, left: 0 }
              : { top: 8, right: 12, bottom: 0, left: -12 }
          }
        >
          <defs>
            {series.map((s, i) => (
              <linearGradient key={s.key} id={`${gradientId}-${i}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={seriesColor(i, s.color)} stopOpacity={0.28} />
                <stop offset="100%" stopColor={seriesColor(i, s.color)} stopOpacity={0.02} />
              </linearGradient>
            ))}
          </defs>
          {minimal ? null : <CartesianGrid vertical={false} stroke={CHART_GRID} strokeWidth={1} />}
          <XAxis
            dataKey={xKey}
            hide={minimal}
            tickLine={false}
            axisLine={{ stroke: CHART_GRID }}
            tick={{ fill: CHART_TEXT, fontSize: CHART_FONT_SIZE }}
            tickMargin={8}
            minTickGap={24}
            tickFormatter={labelFormatter ? (v: string | number) => labelFormatter(v) : undefined}
          />
          <YAxis
            hide={minimal}
            tickLine={false}
            axisLine={false}
            tick={{ fill: CHART_TEXT, fontSize: CHART_FONT_SIZE }}
            tickFormatter={(v: number) => formatCompact(v)}
            width={48}
            allowDecimals={false}
          />
          <Tooltip
            cursor={{ stroke: 'var(--color-border-strong)', strokeWidth: 1 }}
            content={
              <ChartTooltipContent
                valueFormatter={valueFormatter}
                labelFormatter={labelFormatter}
              />
            }
          />
          {series.map((s, i) => (
            <Area
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={seriesColor(i, s.color)}
              strokeWidth={2}
              fill={`url(#${gradientId}-${i})`}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--color-surface)' }}
              isAnimationActive={false}
            />
          ))}
        </RAreaChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
