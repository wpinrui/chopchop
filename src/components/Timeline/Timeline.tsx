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
  const timelineAreaRef = useRef<HTMLDivElement>(null);
  const scrollbarRef = useRef<HTMLDivElement>(null);

  const [zoom, setZoom] = useState(1); // Pixels per second
  const [isDraggingPlayhead, setIsDraggingPlayhead] = useState(false);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [viewportWidth, setViewportWidth] = useState(0);

  // Calculate maximum timeline duration: max(5 min, 2 * existing media length)
  const longestClipEnd = Math.max(
    ...tracks.map(track => {
      const lastClip = track.clips[track.clips.length - 1];
      return lastClip ? lastClip.timelineStart + lastClip.duration : 0;
    }),
    0
  );
  const maxDuration = Math.max(300, longestClipEnd * 2); // 5 minutes or 2x media length

  // Timeline width is the full content width at current zoom level
  const basePixelsPerSecond = 100; // Base scale: 100 pixels per second
  const timelineWidth = maxDuration * basePixelsPerSecond * zoom;

  // Convert time (seconds) to pixels based on current zoom
  const timeToPixels = (seconds: number): number => {
    return seconds * basePixelsPerSecond * zoom;
  };

  // Convert pixels to time (seconds) based on current zoom
  const pixelsToTime = (pixels: number): number => {
    return pixels / (basePixelsPerSecond * zoom);
  };

  // Calculate ruler interval based on zoom level
  const getRulerInterval = (): number => {
    const pixelsPerSecond = zoom * 100;
    const viewportSeconds = viewportWidth / pixelsPerSecond;

    // Aim for 8-12 markers across the viewport
    const targetMarkers = 10;
    const idealInterval = viewportSeconds / targetMarkers;

    // Snap to nice intervals: 1, 5, 10, 30, 60, 300, 600, etc.
    const intervals = [1, 5, 10, 30, 60, 300, 600, 1800, 3600];
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
  }, [dispatch, zoom, scrollLeft, pixelsToTime]);

  // Playhead dragging
  const handlePlayheadMouseDown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setIsDraggingPlayhead(true);
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
  }, [dispatch, zoom]);

  const handleTrackDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  // Format time as MM:SS:FF
  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const frames = Math.floor((seconds % 1) * fps);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}:${frames.toString().padStart(2, '0')}`;
  };

  // Track viewport width
  useEffect(() => {
    const updateViewportWidth = () => {
      if (timelineAreaRef.current) {
        setViewportWidth(timelineAreaRef.current.clientWidth);
      }
    };

    updateViewportWidth();
    window.addEventListener('resize', updateViewportWidth);
    return () => window.removeEventListener('resize', updateViewportWidth);
  }, []);

  // Horizontal scroll with mouse wheel
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const newScrollLeft = Math.max(0, Math.min(timelineWidth - viewportWidth, scrollLeft + e.deltaY));
    setScrollLeft(newScrollLeft);
  }, [scrollLeft, timelineWidth, viewportWidth]);

  // Custom scrollbar dragging
  const handleScrollbarThumbDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const scrollbarTrack = scrollbarRef.current;
    if (!scrollbarTrack) return;

    const startX = e.clientX;
    const startScrollLeft = scrollLeft;
    const trackWidth = scrollbarTrack.clientWidth;
    const thumbWidth = Math.max(50, (viewportWidth / timelineWidth) * trackWidth);
    const maxThumbLeft = trackWidth - thumbWidth;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaScroll = (deltaX / maxThumbLeft) * (timelineWidth - viewportWidth);
      const newScrollLeft = Math.max(0, Math.min(timelineWidth - viewportWidth, startScrollLeft + deltaScroll));
      setScrollLeft(newScrollLeft);
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [scrollLeft, timelineWidth, viewportWidth]);

  // Scrollbar handle resize (zoom)
  const handleScrollbarHandleDrag = useCallback((e: React.MouseEvent, side: 'left' | 'right') => {
    e.preventDefault();
    e.stopPropagation();

    const scrollbarTrack = scrollbarRef.current;
    if (!scrollbarTrack) return;

    const startX = e.clientX;
    const startZoom = zoom;
    const trackWidth = scrollbarTrack.clientWidth;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaPercent = deltaX / trackWidth;

      // Adjust zoom based on handle drag
      // Dragging handles inward = zoom in, outward = zoom out
      const zoomFactor = side === 'left' ? -deltaPercent * 5 : deltaPercent * 5;
      const newZoom = Math.max(0.1, Math.min(10, startZoom + zoomFactor));
      setZoom(newZoom);
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [zoom]);

  // Click on scrollbar track to jump
  const handleScrollbarTrackClick = useCallback((e: React.MouseEvent) => {
    if (!scrollbarRef.current) return;

    const rect = scrollbarRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const trackWidth = rect.width;
    const scrollRatio = clickX / trackWidth;
    const newScrollLeft = Math.max(0, Math.min(timelineWidth - viewportWidth, scrollRatio * timelineWidth));
    setScrollLeft(newScrollLeft);
  }, [timelineWidth, viewportWidth]);

  // Handle zoom
  const handleZoomIn = () => setZoom(prev => Math.min(prev * 1.5, 10));
  const handleZoomOut = () => setZoom(prev => Math.max(prev / 1.5, 0.1));

  return (
    <div className="timeline">
      {/* Timeline toolbar */}
      <div className="timeline-toolbar">
        <div className="timeline-timecode">{formatTime(playhead)}</div>
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
          ref={timelineAreaRef}
          onWheel={handleWheel}
        >
          <div className="timeline-viewport">
            <div
              className="timeline-scrollable-content"
              ref={timelineRef}
              onClick={handleTimelineClick}
            >
              {/* Time ruler */}
              <div className="timeline-ruler">
              {Array.from({ length: Math.ceil(maxDuration / rulerInterval) }).map((_, i) => {
                const seconds = i * rulerInterval;
                const position = timeToPixels(seconds) - scrollLeft;
                if (position < -100 || position > viewportWidth + 100) return null;
                return (
                  <div
                    key={i}
                    className="ruler-marker"
                    style={{ left: `${position}px` }}
                  >
                    <div className="ruler-tick" />
                    <div className="ruler-label">{formatTime(seconds)}</div>
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
                  const left = timeToPixels(clip.timelineStart) - scrollLeft;
                  const width = timeToPixels(clip.duration);

                  // Only render clips that are visible in viewport
                  if (left + width < -100 || left > viewportWidth + 100) return null;

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
              style={{ left: `${timeToPixels(playhead) - scrollLeft}px` }}
              onMouseDown={handlePlayheadMouseDown}
            >
              <div className="playhead-handle" />
              <div className="playhead-line" />
            </div>
            </div>
          </div>

          {/* Custom scrollbar */}
          <div
            className="timeline-scrollbar"
            ref={scrollbarRef}
            onClick={handleScrollbarTrackClick}
          >
            <div
              className="timeline-scrollbar-thumb"
              style={{
                width: `${Math.max(50, (viewportWidth / timelineWidth) * 100)}%`,
                left: `${(scrollLeft / timelineWidth) * 100}%`,
              }}
              onMouseDown={handleScrollbarThumbDrag}
            >
              <div
                className="timeline-scrollbar-handle timeline-scrollbar-handle-left"
                onMouseDown={(e) => handleScrollbarHandleDrag(e, 'left')}
              />
              <div
                className="timeline-scrollbar-handle timeline-scrollbar-handle-right"
                onMouseDown={(e) => handleScrollbarHandleDrag(e, 'right')}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Timeline;
