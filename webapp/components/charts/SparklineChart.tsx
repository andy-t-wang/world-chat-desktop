'use client';

import { useMemo, useCallback } from 'react';
import { AreaChart, Area, ResponsiveContainer, YAxis, Tooltip } from 'recharts';

interface SparklineChartProps {
  /** Array of price values */
  data: number[];
  /** Whether the trend is positive (green) or negative (red) */
  isPositive: boolean;
  /** Chart width in pixels */
  width?: number;
  /** Chart height in pixels */
  height?: number;
  /** Callback when hovering over chart - returns price or null when leaving */
  onHover?: (price: number | null) => void;
}

/**
 * Small sparkline area chart for showing price trends
 * Used in ticker preview cards
 */
export function SparklineChart({
  data,
  isPositive,
  width = 80,
  height = 32,
  onHover,
}: SparklineChartProps) {
  // Transform data for recharts and calculate domain
  const { chartData, domain } = useMemo(() => {
    const transformed = data.map((value, index) => ({ value, index }));

    // Calculate min/max for proper Y-axis scaling
    const values = data.filter(v => v != null && !isNaN(v));
    if (values.length === 0) {
      return { chartData: transformed, domain: [0, 1] as [number, number] };
    }

    const min = Math.min(...values);
    const max = Math.max(...values);

    // Add small padding to the domain (2% on each side)
    const padding = (max - min) * 0.02 || max * 0.01;

    return {
      chartData: transformed,
      domain: [min - padding, max + padding] as [number, number],
    };
  }, [data]);

  // Handle mouse events for hover price
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleMouseMove = useCallback((state: any) => {
    if (onHover && state?.activePayload?.[0]?.value != null) {
      onHover(state.activePayload[0].value as number);
    }
  }, [onHover]);

  const handleMouseLeave = useCallback(() => {
    onHover?.(null);
  }, [onHover]);

  // Don't render if no data
  if (data.length === 0) {
    return null;
  }

  // Refined color palette
  const color = isPositive ? '#10B981' : '#EF4444';
  const gradientId = `sparkline-${isPositive ? 'up' : 'down'}-${Math.random().toString(36).slice(2)}`;

  return (
    <div style={{ width, height }} className="overflow-hidden rounded-lg [&_*]:outline-none" tabIndex={-1}>
      <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
        <AreaChart
          data={chartData}
          margin={{ top: 4, right: 0, bottom: 0, left: 0 }}
          onMouseMove={onHover ? handleMouseMove : undefined}
          onMouseLeave={onHover ? handleMouseLeave : undefined}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.15} />
              <stop offset="100%" stopColor={color} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <YAxis domain={domain} hide />
          {onHover && (
            <Tooltip
              content={() => null}
              cursor={{
                stroke: 'var(--text-tertiary)',
                strokeWidth: 1,
                strokeDasharray: '3 3',
                opacity: 0.5
              }}
            />
          )}
          <Area
            type="monotoneX"
            dataKey="value"
            stroke={color}
            strokeWidth={1.5}
            fill={`url(#${gradientId})`}
            isAnimationActive={false}
            dot={false}
            activeDot={{
              r: 3,
              fill: color,
              stroke: 'var(--bg-primary)',
              strokeWidth: 2,
            }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
