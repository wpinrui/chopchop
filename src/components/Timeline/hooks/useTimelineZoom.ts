/**
 * useTimelineZoom Hook
 *
 * Manages timeline zoom level with playhead-centered zooming.
 * Single Responsibility: Zoom state and zoom operations.
 */

import { useState, useCallback, RefObject } from 'react';

const MIN_ZOOM = 0.005;
const MAX_ZOOM = 1.0;
const ZOOM_FACTOR = 1.25;
const BASE_PIXELS_PER_SECOND = 600;

interface ZoomConfig {
  playhead: number;
  scrollContainerRef: RefObject<HTMLDivElement>;
}

interface ZoomState {
  zoom: number;
  handleZoomIn: () => void;
  handleZoomOut: () => void;
  handleWheelZoom: (deltaY: number) => void;
  zoomWithPlayheadCenter: (newZoom: number) => void;
}

export function useTimelineZoom({ playhead, scrollContainerRef }: ZoomConfig): ZoomState {
  const [zoom, setZoom] = useState(0.01);

  const zoomWithPlayheadCenter = useCallback((newZoom: number) => {
    const container = scrollContainerRef.current;
    if (!container) {
      setZoom(newZoom);
      return;
    }

    const currentScrollLeft = container.scrollLeft;
    const containerWidth = container.clientWidth;
    const playheadPixels = playhead * BASE_PIXELS_PER_SECOND * zoom;
    const playheadViewportOffset = playheadPixels - currentScrollLeft;
    const isPlayheadVisible = playheadViewportOffset >= 0 && playheadViewportOffset <= containerWidth;

    if (isPlayheadVisible) {
      const newPlayheadPixels = playhead * BASE_PIXELS_PER_SECOND * newZoom;
      const newScrollLeft = newPlayheadPixels - playheadViewportOffset;

      setZoom(newZoom);

      requestAnimationFrame(() => {
        if (scrollContainerRef.current) {
          scrollContainerRef.current.scrollLeft = Math.max(0, newScrollLeft);
        }
      });
    } else {
      setZoom(newZoom);
    }
  }, [zoom, playhead, scrollContainerRef]);

  const handleZoomIn = useCallback(() => {
    const newZoom = Math.min(zoom * ZOOM_FACTOR, MAX_ZOOM);
    zoomWithPlayheadCenter(newZoom);
  }, [zoom, zoomWithPlayheadCenter]);

  const handleZoomOut = useCallback(() => {
    const newZoom = Math.max(zoom / ZOOM_FACTOR, MIN_ZOOM);
    zoomWithPlayheadCenter(newZoom);
  }, [zoom, zoomWithPlayheadCenter]);

  const handleWheelZoom = useCallback((deltaY: number) => {
    const scrollFactor = Math.pow(1.002, -deltaY);
    const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom * scrollFactor));
    zoomWithPlayheadCenter(newZoom);
  }, [zoom, zoomWithPlayheadCenter]);

  return {
    zoom,
    handleZoomIn,
    handleZoomOut,
    handleWheelZoom,
    zoomWithPlayheadCenter,
  };
}
