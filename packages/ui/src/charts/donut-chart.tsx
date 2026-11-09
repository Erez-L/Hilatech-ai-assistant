'use client';

import * as React from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { formatCompact, formatNumber } from '../lib/format';
import { ChartFrame, ChartLegend, ChartTooltipContent, seriesColor, type ValueFormatter } from './chart-shared';

export interface DonutDatum {
  label: string;
  value: number;
  color?: string;
}

export interface DonutChartProps {
  data: DonutDatum[];
  title?: React.ReactNode;
  description?: React.ReactNode;
  /** Centre label (defaults to the total). */
  centerLabel?: React.ReactNode;
  centerValue?: React.ReactNode;
  height?: number;
  valueFormatter?: ValueFormatter;
  className?: string;
}

/** Donut: one whole split into parts, with a 2px surface gap between segments. */
export function DonutChart({
  data,
  title,
  description,
  centerLabel = 'Total',
  centerValue,
  height = 220,
  valueFormatter = formatNumber,
  className,
}: DonutChartProps) {
  const total = data.reduce((sum, d) => sum + d.value, 0);
  const legend = <ChartLegend items={data.map((d, i) => ({ label: d.label, color: seriesColor(i, d.color) }))} />;

  return (
    <ChartFrame title={title} description={description} legend={legend} height={height} className={className}>
      <div className="relative h-full w-full">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Tooltip content={<ChartTooltipContent valueFormatter={valueFormatter} />} />
            <Pie
              data={data}
              dataKey="value"
              nameKey="label"
              innerRadius="68%"
              outerRadius="92%"
              paddingAngle={2}
              stroke="var(--color-surface)"
              strokeWidth={2}
              isAnimationActive={false}
            >
              {data.map((d, i) => (
                <Cell key={d.label} fill={seriesColor(i, d.color)} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-xl font-semibold tabular text-fg">{centerValue ?? formatCompact(total)}</span>
          <span className="text-xs text-fg-muted">{centerLabel}</span>
        </div>
      </div>
    </ChartFrame>
  );
}
