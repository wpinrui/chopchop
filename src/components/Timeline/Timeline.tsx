/**
 * Timeline Component
 *
 * Main timeline for arranging and editing clips.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import type { RootState } from '../../store';
import { setPlayheadPosition, addClip } from '../../store/timelineSlice';
import type { MediaItem, Clip } from '@types';
import './Timeline.css';

const Timeline: React.FC = () => {
  const dispatch = useDispatch();
  const tracks = useSelector((state: RootState) => state.timeline.tracks);
  const playhead = useSelector((state: RootState) => state.timeline.playheadPosition);
  const fps = useSelector((state: RootState) => state.project.fps);

  const timelineRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const [zoom, setZoom] = useState(0.01); // Zoom multiplier (exponential scale), default 1%
  const [scrollLeft, setScrollLeft] = useState(0);
  const [viewportWidth, setViewportWidth] = useState(0);

  // Zoom constraints (exponential scale)
  const MIN_ZOOM = 0.005; // 0.5% - can see ~5+ minutes in viewport
  const MAX_ZOOM = 1.0;   // 100% - frame-by-frame at 60fps (10px per frame)
  const ZOOM_FACTOR = 1.25; // Multiplicative factor for button clicks

  // Calculate maximum timeline duration: max(5 min, 2 * existing media length)
  const longestClipEnd = Math.max(
    ...tracks.map(track => {
      const lastClip = track.clips[track.clips.length - 1];
      return lastClip ? lastClip.timelineStart + lastClip.duration : 0;
    }),
    0
  );
  const maxDuration = Math.max(300, longestClipEnd * 2); // 5 minutes or 2x media length

  // At 100% zoom (zoom=1.0), 600 pixels = 1 second, so 10 pixels per frame at 60fps
  const basePixelsPerSecond = 600;
  const timelineWidth = maxDuration * basePixelsPerSecond * zoom;

  // Convert time (seconds) to pixels based on current zoom
  const timeToPixels = useCallback((seconds: number): number => {
    return seconds * basePixelsPerSecond * zoom;
  }, [zoom]);

  // Convert pixels to time (seconds) based on current zoom
  const pixelsToTime = useCallback((pixels: number): number => {
    return pixels / (basePixelsPerSecond * zoom);
  }, [zoom]);

  // Calculate ruler interval based on zoom level
  const getRulerInterval = (): number => {
    const pixelsPerSecond = zoom * basePixelsPerSecond;
    const viewportSeconds = viewportWidth / pixelsPerSecond;

    // Aim for 8-12 markers across the viewport
    const targetMarkers = 10;
    const idealInterval = viewportSeconds / targetMarkers;

    // Snap to nice intervals - include sub-second for high zoom
    const intervals = [1/60, 1/30, 1/10, 0.5, 1, 5, 10, 30, 60, 300, 600, 1800, 3600];
    return intervals.find(i => i >= idealInterval) || 3600;
  };

  const rulerInterval = getRulerInterval();

  // Handle timeline click to move playhead
  const handleTimelineClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!timelineRef.current) return;

    const rect = timelineRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const newTime = pixelsToTime(clickX + scrollLeft);

    dispatch(setPlayheadPosition(Math.max(0, newTime)));
  }, [dispatch, scrollLeft, pixelsToTime]);

  // Playhead dragging
  const handlePlayheadMouseDown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    // TODO: Implement playhead dragging
  }, []);

  // Handle drop from MediaBin
  const handleTrackDrop = useCallback((e: React.DragEvent, trackId: string) => {
    e.preventDefault();
    e.stopPropagation();

    const mediaData = e.dataTransfer.getData('application/chopchop-media');
    if (!mediaData) return;

    try {
      const mediaItem: MediaItem = JSON.parse(mediaData);

      // Calculate drop position in timeline
      if (!timelineRef.current) return;
      const rect = timelineRef.current.getBoundingClientRect();
      const dropX = e.clientX - rect.left;
      const dropTime = pixelsToTime(dropX + scrollLeft);

      // Create clip from media item
      const clip: Clip = {
        id: `clip-${Date.now()}-${Math.random()}`,
        type: mediaItem.type === 'video' ? 'video' : 'audio',
        mediaId: mediaItem.id,
        trackId: trackId,
        timelineStart: Math.max(0, dropTime),
        duration: mediaItem.duration,
        mediaIn: 0,
        mediaOut: mediaItem.duration,
        name: mediaItem.name,
        enabled: true,
        effects: [],
      };

      dispatch(addClip(clip));
    } catch (error) {
      console.error('Error dropping media on timeline:', error);
    }
  }, [dispatch, pixelsToTime, scrollLeft]);

  const handleTrackDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  // Format time as MM:SS:FF (or just frames for sub-second markers)
  const formatTime = (seconds: number, forRuler = false): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const frames = Math.floor((seconds % 1) * fps);

    // For ruler markers at sub-second intervals, show frames prominently
    if (forRuler && seconds < 60 && seconds % 1 !== 0) {
      return `${secs}:${frames.toString().padStart(2, '0')}f`;
    }

    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}:${frames.toString().padStart(2, '0')}`;
  };

  // Track viewport width and sync scroll position
  useEffect(() => {
    const updateViewportWidth = () => {
      if (scrollContainerRef.current) {
        setViewportWidth(scrollContainerRef.current.clientWidth);
      }
    };

    updateViewportWidth();
    window.addEventListener('resize', updateViewportWidth);
    return () => window.removeEventListener('resize', updateViewportWidth);
  }, []);

  // Sync scroll position from native scrollbar
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollLeft(e.currentTarget.scrollLeft);
  }, []);

  // Handle wheel events: scroll horizontally or Ctrl+wheel to zoom
  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (e.ctrlKey) {
      // Ctrl + scroll = smooth exponential zoom
      e.preventDefault();

      // Multiplicative zoom: each scroll "tick" multiplies by a small factor
      // Negative deltaY = scroll up = zoom in, positive = scroll down = zoom out
      const scrollFactor = Math.pow(1.002, -e.deltaY);

      setZoom(prev => {
        const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, prev * scrollFactor));
        return newZoom;
      });
    } else {
      // Normal scroll = horizontal scroll
      e.preventDefault();

      if (scrollContainerRef.current) {
        const newScrollLeft = scrollContainerRef.current.scrollLeft + e.deltaY;
        scrollContainerRef.current.scrollLeft = newScrollLeft;
      }
    }
  }, []);

  // Handle button zoom (exponential steps)
  const handleZoomIn = () => setZoom(prev => Math.min(prev * ZOOM_FACTOR, MAX_ZOOM));
  const handleZoomOut = () => setZoom(prev => Math.max(prev / ZOOM_FACTOR, MIN_ZOOM));

  return (
    <div className="timeline">
      {/* Timeline toolbar */}
      <div className="timeline-toolbar">
        <div className="timeline-timecode">{formatTime(playhead)}</div>
        <div className="timeline-zoom-controls">
          <button onClick={handleZoomOut} title="Zoom Out">−</button>
          <span className="zoom-level">
            {zoom * 100 < 10 ? (zoom * 100).toFixed(1) : Math.round(zoom * 100)}%
          </span>
          <button onClick={handleZoomIn} title="Zoom In">+</button>
        </div>
      </div>

      {/* Timeline ruler and tracks */}
      <div className="timeline-content">
        {/* Track headers (left side) */}
        <div className="timeline-track-headers">
          {tracks.map(track => (
            <div key={track.id} className="track-header">
              <span className="track-name">{track.name}</span>
              <div className="track-controls">
                <button className="track-toggle" title="Mute">M</button>
                <button className="track-toggle" title="Solo">S</button>
                <button className="track-toggle" title="Lock">L</button>
              </div>
            </div>
          ))}
        </div>

        {/* Timeline area (right side) */}
        <div
          className="timeline-area"
          ref={scrollContainerRef}
          onScroll={handleScroll}
          onWheel={handleWheel}
        >
          <div
            className="timeline-scrollable-content"
            ref={timelineRef}
            onClick={handleTimelineClick}
            style={{ width: `${timelineWidth}px` }}
          >
              {/* Time ruler */}
              <div className="timeline-ruler">
                {Array.from({ length: Math.ceil(maxDuration / rulerInterval) }).map((_, i) => {
                  const seconds = i * rulerInterval;
                  const position = timeToPixels(seconds);
                  return (
                    <div
                      key={i}
                      className="ruler-marker"
                      style={{ left: `${position}px` }}
                    >
                      <div className="ruler-tick" />
                      <div className="ruler-label">{formatTime(seconds, true)}</div>
                    </div>
                  );
                })}
              </div>

          {/* Tracks */}
          <div className="timeline-tracks">
            {tracks.map(track => (
              <div
                key={track.id}
                className="track"
                onDragOver={handleTrackDragOver}
                onDrop={(e) => handleTrackDrop(e, track.id)}
              >
                {/* Render clips */}
                {track.clips.map(clip => {
                  const left = timeToPixels(clip.timelineStart);
                  const width = timeToPixels(clip.duration);

                  return (
                    <div
                      key={clip.id}
                      className="clip"
                      style={{
                        left: `${left}px`,
                        width: `${width}px`,
                      }}
                    >
                      <div className="clip-content">
                        <span className="clip-name">{clip.name}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

            {/* Playhead */}
            <div
              className="playhead"
              style={{ left: `${timeToPixels(playhead)}px` }}
              onMouseDown={handlePlayheadMouseDown}
            >
              <div className="playhead-handle" />
              <div className="playhead-line" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Timeline;
