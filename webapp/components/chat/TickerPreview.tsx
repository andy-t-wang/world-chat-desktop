'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { RefreshCw, AlertCircle } from 'lucide-react';
import { SparklineChart } from '@/components/charts/SparklineChart';
import { useTickerPrice } from '@/hooks/useTickerPrice';
import { extractTickers, formatTicker, type TickerType } from '@/lib/ticker/utils';
import type { TickerPriceData } from '@/app/api/ticker-price/route';

// Format price helper
function formatPrice(price: number): string {
  if (price >= 1000) {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(price);
  }
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: price >= 0.01 ? 2 : 4,
    maximumFractionDigits: price >= 0.01 ? 2 : 6,
  }).format(price);
}

interface TickerPreviewProps {
  /** Ticker symbol without prefix (e.g., "WLD", "BTC", "AAPL") */
  symbol: string;
  /** Ticker type - crypto ($) or stock (#) */
  type: TickerType;
  /** Callback when user clicks to open detailed modal */
  onOpenModal: (symbol: string, type: TickerType, data: TickerPriceData) => void;
  /** Callback when content loads (for scroll adjustment) */
  onLoad?: () => void;
}

/**
 * Premium fintech-style price card
 * Refined typography, interactive chart, subtle depth
 */
export function TickerPreview({ symbol, type, onOpenModal, onLoad }: TickerPreviewProps) {
  const { data, isLoading, error, isStale, status, retry } = useTickerPrice(symbol, type);
  const [hoveredPrice, setHoveredPrice] = useState<number | null>(null);
  const hasCalledOnLoad = useRef(false);

  const handleChartHover = useCallback((price: number | null) => {
    setHoveredPrice(price);
  }, []);

  // Call onLoad when data first loads
  useEffect(() => {
    if (data && !hasCalledOnLoad.current && onLoad) {
      hasCalledOnLoad.current = true;
      // Small delay to ensure DOM has updated
      requestAnimationFrame(() => {
        onLoad();
      });
    }
  }, [data, onLoad]);

  // Format display with correct prefix
  const displaySymbol = formatTicker(symbol, type);

  // Loading state - skeleton pulse
  if (isLoading && !data) {
    return (
      <div className="w-[240px] rounded-xl bg-[var(--bubble-incoming)] p-3.5 shadow-sm">
        <div className="flex items-center gap-2 mb-2.5">
          <div className="w-7 h-7 rounded-full bg-[var(--bg-secondary)] animate-pulse" />
          <div className="flex-1">
            <div className="h-3.5 w-20 bg-[var(--bg-secondary)] rounded animate-pulse mb-1" />
            <div className="h-3 w-10 bg-[var(--bg-secondary)] rounded animate-pulse" />
          </div>
        </div>
        {status ? (
          <div className="h-[52px] flex items-center justify-center text-[12px] text-[var(--text-tertiary)]">
            {status}
          </div>
        ) : (
          <div className="h-[52px] bg-[var(--bg-secondary)] rounded-lg animate-pulse" />
        )}
      </div>
    );
  }

  // Error state
  if (error && !data) {
    // Check if it's a "not found" error vs other errors
    const isNotFound = error.toLowerCase().includes('not found');

    return (
      <div className="w-[240px] rounded-xl bg-[var(--bubble-incoming)] p-3.5 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-[var(--text-quaternary)]" />
            <span className="text-[13px] text-[var(--text-tertiary)]">
              {isNotFound ? 'No matching ticker found' : `${displaySymbol} unavailable`}
            </span>
          </div>
          {/* Only show retry for non-404 errors */}
          {!isNotFound && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                retry();
              }}
              className="p-1.5 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-tertiary)] transition-colors outline-none"
              title="Retry"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    );
  }

  if (!data) return null;

  const isPositive = data.priceChangePercentage24h >= 0;
  const displayPrice = hoveredPrice ?? data.currentPrice;
  const formattedPrice = formatPrice(displayPrice);
  const formattedChange = `${isPositive ? '+' : ''}${data.priceChangePercentage24h.toFixed(2)}%`;
  const trendColor = isPositive ? '#10B981' : '#EF4444';

  return (
    <div
      onClick={() => onOpenModal(symbol, type, data)}
      className="group cursor-pointer w-[240px] rounded-xl bg-[var(--bubble-incoming)] p-3.5 shadow-sm hover:shadow-md transition-all duration-200 hover:scale-[1.02] outline-none focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-blue)] focus-visible:ring-offset-2"
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          onOpenModal(symbol, type, data);
        }
      }}
    >
      {/* Header: Token info + Price */}
      <div className="flex items-start justify-between mb-2.5">
        {/* Left: Icon + Name/Symbol */}
        <div className="flex items-center gap-2">
          {data.image ? (
            <img
              src={data.image}
              alt={data.name}
              className="w-7 h-7 rounded-full"
            />
          ) : (
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[var(--bg-secondary)] to-[var(--bg-hover)] flex items-center justify-center">
              <span className="text-[10px] font-bold text-[var(--text-tertiary)] tracking-tight">
                {symbol.slice(0, 2)}
              </span>
            </div>
          )}
          <div className="min-w-0">
            <div className="text-[14px] font-semibold text-[var(--text-primary)] leading-tight truncate max-w-[90px]">
              {data.name}
            </div>
            <div className="text-[12px] text-[var(--text-tertiary)] font-medium tracking-wide">
              {displaySymbol}
              {isStale && <span className="opacity-50 ml-1">•</span>}
            </div>
          </div>
        </div>

        {/* Right: Price + Change */}
        <div className="text-right">
          <div
            className={`text-[16px] font-semibold tabular-nums leading-tight transition-colors duration-150 ${
              hoveredPrice ? 'text-[var(--text-secondary)]' : 'text-[var(--text-primary)]'
            }`}
          >
            {formattedPrice}
          </div>
          <div
            className="text-[12px] font-medium tabular-nums flex items-center justify-end gap-0.5"
            style={{ color: trendColor }}
          >
            <svg
              width="10"
              height="10"
              viewBox="0 0 10 10"
              fill="none"
              className={`transition-transform ${isPositive ? '' : 'rotate-180'}`}
            >
              <path
                d="M5 2L8 6H2L5 2Z"
                fill="currentColor"
              />
            </svg>
            {formattedChange}
          </div>
        </div>
      </div>

      {/* Chart */}
      {data.sparkline7d && data.sparkline7d.length > 0 && (
        <div className="relative">
          <SparklineChart
            data={data.sparkline7d}
            isPositive={isPositive}
            onHover={handleChartHover}
            width={212}
            height={52}
          />
          {/* 7d label */}
          <div className="absolute bottom-0 right-0 text-[10px] font-medium text-[var(--text-quaternary)] tracking-wide">
            7D
          </div>
        </div>
      )}
    </div>
  );
}

interface MessageTickerPreviewProps {
  /** Full message text to extract tickers from */
  text: string;
  /** Callback when user clicks to open detailed modal */
  onOpenModal: (symbol: string, type: TickerType, data: TickerPriceData) => void;
  /** Callback when content loads (for scroll adjustment) */
  onLoad?: () => void;
}

/**
 * Wrapper component that extracts the first ticker from message text
 * and renders a TickerPreview for it
 */
export function MessageTickerPreview({ text, onOpenModal, onLoad }: MessageTickerPreviewProps) {
  // Extract tickers (now supports both $ and #)
  const tickers = extractTickers(text);

  // Only show preview for first ticker (like link previews)
  if (tickers.length === 0) {
    return null;
  }

  const firstTicker = tickers[0];

  return (
    <TickerPreview
      symbol={firstTicker.symbol}
      type={firstTicker.type}
      onOpenModal={onOpenModal}
      onLoad={onLoad}
    />
  );
}
