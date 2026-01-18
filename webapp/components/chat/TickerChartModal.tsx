'use client';

import { useEffect, useRef, useCallback } from 'react';
import { X, TrendingUp, TrendingDown, ExternalLink, RefreshCw } from 'lucide-react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import type { TickerPriceData } from '@/app/api/ticker-price/route';
import { formatTicker } from '@/lib/ticker/utils';

interface TickerChartModalProps {
  /** Ticker symbol */
  symbol: string;
  /** Price data to display */
  data: TickerPriceData;
  /** Close callback */
  onClose: () => void;
  /** Retry callback for refreshing data */
  onRetry?: () => void;
  /** Whether data is currently loading */
  isLoading?: boolean;
}

/**
 * Modal displaying detailed 7-day price chart for a ticker
 */
export function TickerChartModal({ symbol, data, onClose, onRetry, isLoading }: TickerChartModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);

  // Close on Escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  // Close on click outside
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        onClose();
      }
    },
    [onClose]
  );

  const isPositive = data.priceChangePercentage24h >= 0;
  const color = isPositive ? '#00C230' : '#FF3B30';

  // Transform sparkline data for recharts with time labels
  const chartData = data.sparkline7d.map((price, index) => {
    // Calculate approximate date for each data point (7 days spread)
    const hoursAgo = ((data.sparkline7d.length - 1 - index) / data.sparkline7d.length) * 7 * 24;
    const date = new Date(Date.now() - hoursAgo * 60 * 60 * 1000);
    return {
      price,
      time: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      fullTime: date.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      }),
    };
  });

  // Format price
  const formattedPrice = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: data.currentPrice < 1 ? 4 : 2,
    maximumFractionDigits: data.currentPrice < 1 ? 6 : 2,
  }).format(data.currentPrice);

  // Format change
  const formattedChangePercent = `${isPositive ? '+' : ''}${data.priceChangePercentage24h.toFixed(2)}%`;
  const formattedChangeAmount = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: data.priceChange24h < 1 ? 6 : 2,
  }).format(Math.abs(data.priceChange24h));

  // Format market cap
  const formattedMarketCap = data.marketCap
    ? new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        notation: 'compact',
        maximumFractionDigits: 2,
      }).format(data.marketCap)
    : null;

  // External URL based on ticker type
  const isStock = data.type === 'stock';
  const externalUrl = isStock
    ? `https://finance.yahoo.com/quote/${symbol}`
    : `https://www.coingecko.com/en/coins/${data.name.toLowerCase().replace(/\s+/g, '-')}`;
  const externalLabel = isStock ? 'Yahoo Finance' : 'CoinGecko';

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={handleBackdropClick}
    >
      <div
        ref={modalRef}
        className="bg-[var(--bg-primary)] rounded-2xl shadow-xl w-full max-w-[480px] max-h-[90vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[var(--border-default)]">
          <div className="flex items-center gap-3">
            {data.image ? (
              <img src={data.image} alt={symbol} className="w-10 h-10 rounded-full" />
            ) : (
              <div className="w-10 h-10 rounded-full bg-[var(--bg-secondary)] flex items-center justify-center">
                <span className="text-[14px] font-semibold text-[var(--text-tertiary)]">
                  {symbol.slice(0, 2)}
                </span>
              </div>
            )}
            <div>
              <h2 className="text-[18px] font-semibold text-[var(--text-primary)]">
                {formatTicker(symbol, data.type)}
              </h2>
              <p className="text-[13px] text-[var(--text-secondary)]">{data.name}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[12px] font-medium text-[var(--text-tertiary)] bg-[var(--bg-secondary)] px-2 py-0.5 rounded">
              7D
            </span>
            <button
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-[var(--bg-hover)] text-[var(--text-tertiary)] transition-colors"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Price display */}
        <div className="p-4">
          <div className="text-[32px] font-semibold text-[var(--text-primary)]">
            {formattedPrice}
          </div>
          <div
            className={`flex items-center gap-2 text-[14px] font-medium ${
              isPositive ? 'text-[#00C230]' : 'text-[#FF3B30]'
            }`}
          >
            {isPositive ? (
              <TrendingUp className="w-4 h-4" />
            ) : (
              <TrendingDown className="w-4 h-4" />
            )}
            <span>{formattedChangePercent}</span>
            <span className="text-[var(--text-tertiary)]">
              ({isPositive ? '+' : '-'}
              {formattedChangeAmount})
            </span>
            <span className="text-[var(--text-tertiary)]">24h</span>
          </div>
          {formattedMarketCap && (
            <div className="mt-2 text-[13px] text-[var(--text-secondary)]">
              Market Cap: <span className="font-medium text-[var(--text-primary)]">{formattedMarketCap}</span>
            </div>
          )}
        </div>

        {/* Chart */}
        <div className="px-4 pb-4 h-[240px] [&_*]:outline-none" tabIndex={-1}>
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={chartData}
                margin={{ top: 10, right: 10, bottom: 20, left: 10 }}
              >
                <defs>
                  <linearGradient id="priceGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={color} stopOpacity={0.3} />
                    <stop offset="100%" stopColor={color} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="time"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }}
                  ticks={(() => {
                    // Show 4 labels: 3 evenly spaced + last day
                    const len = chartData.length;
                    if (len < 4) return chartData.map(d => d.time);
                    const indices = [
                      Math.floor(len * 0.15),      // ~Day 2
                      Math.floor(len * 0.45),      // ~Day 4
                      Math.floor(len * 0.75),      // ~Day 6
                      len - 1,                      // Last day
                    ];
                    return indices.map(i => chartData[i]?.time).filter(Boolean);
                  })()}
                />
                <YAxis hide domain={['auto', 'auto']} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'var(--bg-secondary)',
                    border: '1px solid var(--border-default)',
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  labelStyle={{ color: 'var(--text-secondary)' }}
                  formatter={(value: number | undefined) => {
                    if (value === undefined) return ['', 'Price'];
                    return [
                      new Intl.NumberFormat('en-US', {
                        style: 'currency',
                        currency: 'USD',
                        minimumFractionDigits: value < 1 ? 4 : 2,
                        maximumFractionDigits: value < 1 ? 6 : 2,
                      }).format(value),
                      'Price',
                    ];
                  }}
                  labelFormatter={(_, payload) => {
                    if (payload && payload[0]) {
                      return payload[0].payload.fullTime;
                    }
                    return '';
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="price"
                  stroke={color}
                  strokeWidth={2}
                  fill="url(#priceGradient)"
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full flex flex-col items-center justify-center gap-3 text-[var(--text-tertiary)]">
              <span>No chart data available</span>
              {onRetry && (
                <button
                  onClick={onRetry}
                  disabled={isLoading}
                  className="flex items-center gap-2 px-3 py-1.5 text-[13px] text-[var(--accent-blue)] hover:bg-[var(--bg-hover)] rounded-lg transition-colors disabled:opacity-50"
                >
                  <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
                  {isLoading ? 'Refreshing...' : 'Refresh'}
                </button>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-[var(--border-default)]">
          <a
            href={externalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 text-[14px] text-[var(--accent-blue)] hover:opacity-80 transition-opacity"
          >
            View on {externalLabel}
            <ExternalLink className="w-4 h-4" />
          </a>
        </div>
      </div>
    </div>
  );
}
