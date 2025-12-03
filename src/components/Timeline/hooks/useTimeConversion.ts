/**
 * useTimeConversion Hook
 *
 * Provides pure utility functions for converting between time and pixel coordinates.
 * Single Responsibility: Time/pixel coordinate conversions only.
 */

import { useCallback, useMemo } from 'react';

const BASE_PIXELS_PER_SECOND = 600;

interface TimeConversionConfig {
  zoom: number;
  fps: number;
}

interface TimeConversion {
  timeToPixels: (seconds: number) => number;
  pixelsToTime: (pixels: number) => number;
  formatTime: (seconds: number, forRuler?: boolean) => string;
  basePixelsPerSecond: number;
}

export function useTimeConversion({ zoom, fps }: TimeConversionConfig): TimeConversion {
  const timeToPixels = useCallback((seconds: number): number => {
    return seconds * BASE_PIXELS_PER_SECOND * zoom;
  }, [zoom]);

  const pixelsToTime = useCallback((pixels: number): number => {
    return pixels / (BASE_PIXELS_PER_SECOND * zoom);
  }, [zoom]);

  const formatTime = useCallback((seconds: number, forRuler = false): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const frames = Math.floor((seconds % 1) * fps);

    if (forRuler && seconds < 60 && seconds % 1 !== 0) {
      return `${secs}:${frames.toString().padStart(2, '0')}f`;
    }

    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}:${frames.toString().padStart(2, '0')}`;
  }, [fps]);

  return useMemo(() => ({
    timeToPixels,
    pixelsToTime,
    formatTime,
    basePixelsPerSecond: BASE_PIXELS_PER_SECOND,
  }), [timeToPixels, pixelsToTime, formatTime]);
}
