/**
 * Timeline Component
 *
 * Main timeline for arranging and editing clips.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { Magnet, ZoomIn, ZoomOut } from 'lucide-react';
import type { RootState } from '../../store';
import { setPlayheadPosition, addClip, updateClip } from '../../store/timelineSlice';
import type { MediaItem, Clip } from '@types';
import './Timeline.css';

const Timeline: React.FC = () => {
  const dispatch = useDispatch();
  const tracks = useSelector((state: RootState) => state.timeline.tracks);
  const playhead = useSelector((state: RootState) => state.timeline.playheadPosition);
  const fps = useSelector((state: RootState) => state.project.fps);

  const timelineRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const justFinishedDraggingRef = useRef(false);

  const [zoom, setZoom] = useState(0.01); // Zoom multiplier (exponential scale), default 1%
  const [scrollLeft, setScrollLeft] = useState(0);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [draggingClip, setDraggingClip] = useState<{ id: string; initialStart: number; mouseOffset: number } | null>(null);
  const [snapEnabled, setSnapEnabled] = useState(true);

  // Snap threshold in pixels
  const SNAP_THRESHOLD_PX = 10;

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
    // Skip if we just finished dragging a clip
    if (justFinishedDraggingRef.current) {
      justFinishedDraggingRef.current = false;
      return;
    }

    if (!timelineRef.current) return;

    const rect = timelineRef.current.getBoundingClientRect();
    // getBoundingClientRect already accounts for scroll, so don't add scrollLeft
    const clickX = e.clientX - rect.left;
    const newTime = Math.max(0, clickX / (basePixelsPerSecond * zoom));

    dispatch(setPlayheadPosition(newTime));
  }, [dispatch, zoom]);

  // Scrub playhead (shared by playhead drag and ruler click)
  const startPlayheadScrub = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();

    // Move playhead to initial click position
    if (timelineRef.current) {
      const rect = timelineRef.current.getBoundingClientRect();
      // getBoundingClientRect already accounts for scroll, so don't add scrollLeft
      const mouseX = e.clientX - rect.left;
      const newTime = Math.max(0, mouseX / (basePixelsPerSecond * zoom));
      dispatch(setPlayheadPosition(newTime));
    }

    const onMouseMove = (moveEvent: MouseEvent) => {
      if (!timelineRef.current) return;

      const rect = timelineRef.current.getBoundingClientRect();
      const mouseX = moveEvent.clientX - rect.left;
      const newTime = Math.max(0, mouseX / (basePixelsPerSecond * zoom));

      dispatch(setPlayheadPosition(newTime));
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [dispatch, zoom]);

  // Playhead handle drag (doesn't move on initial click, just drags)
  const handlePlayheadMouseDown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();

    const onMouseMove = (moveEvent: MouseEvent) => {
      if (!timelineRef.current) return;

      const rect = timelineRef.current.getBoundingClientRect();
      const mouseX = moveEvent.clientX - rect.left;
      const newTime = Math.max(0, mouseX / (basePixelsPerSecond * zoom));

      dispatch(setPlayheadPosition(newTime));
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [dispatch, zoom]);

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
      // Images are treated as video clips (still frames)
      const clipType = mediaItem.type === 'audio' ? 'audio' : 'video';

      const clip: Clip = {
        id: `clip-${Date.now()}-${Math.random()}`,
        type: clipType,
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

  // Get all snap points (other clip edges and playhead)
  const getSnapPoints = useCallback((excludeClipId: string): number[] => {
    const points: number[] = [playhead]; // Always include playhead

    for (const track of tracks) {
      for (const c of track.clips) {
        if (c.id !== excludeClipId) {
          points.push(c.timelineStart); // Clip start
          points.push(c.timelineStart + c.duration); // Clip end
        }
      }
    }

    return points;
  }, [tracks, playhead]);

  // Find nearest snap point for a given time
  const findSnapPoint = useCallback((time: number, clipDuration: number, excludeClipId: string): number => {
    if (!snapEnabled) return time;

    const snapPoints = getSnapPoints(excludeClipId);
    const thresholdTime = pixelsToTime(SNAP_THRESHOLD_PX);

    let bestSnap = time;
    let bestDistance = Infinity;

    // Check clip start snapping to snap points
    for (const point of snapPoints) {
      const distance = Math.abs(time - point);
      if (distance < thresholdTime && distance < bestDistance) {
        bestSnap = point;
        bestDistance = distance;
      }
    }

    // Check clip end snapping to snap points
    const clipEnd = time + clipDuration;
    for (const point of snapPoints) {
      const distance = Math.abs(clipEnd - point);
      if (distance < thresholdTime && distance < bestDistance) {
        bestSnap = point - clipDuration;
        bestDistance = distance;
      }
    }

    return Math.max(0, bestSnap);
  }, [snapEnabled, getSnapPoints, pixelsToTime, SNAP_THRESHOLD_PX]);

  // Handle clip drag start
  const handleClipMouseDown = useCallback((e: React.MouseEvent, clip: Clip) => {
    e.stopPropagation();
    e.preventDefault();

    if (!timelineRef.current) return;

    const rect = timelineRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const clipStartPixels = timeToPixels(clip.timelineStart);
    const mouseOffset = mouseX - clipStartPixels;

    setDraggingClip({ id: clip.id, initialStart: clip.timelineStart, mouseOffset });

    const onMouseMove = (moveEvent: MouseEvent) => {
      if (!timelineRef.current) return;

      const rect = timelineRef.current.getBoundingClientRect();
      const mouseX = moveEvent.clientX - rect.left;
      const newStartPixels = mouseX - mouseOffset;
      let newStartTime = Math.max(0, pixelsToTime(newStartPixels));

      // Apply snapping
      newStartTime = findSnapPoint(newStartTime, clip.duration, clip.id);

      dispatch(updateClip({ id: clip.id, updates: { timelineStart: newStartTime } }));
    };

    const onMouseUp = () => {
      justFinishedDraggingRef.current = true;
      setDraggingClip(null);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [dispatch, timeToPixels, pixelsToTime, findSnapPoint]);

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

  // Zoom with centering on playhead (if visible)
  const zoomWithPlayheadCenter = useCallback((newZoom: number) => {
    if (!scrollContainerRef.current) {
      setZoom(newZoom);
      return;
    }

    const container = scrollContainerRef.current;
    const currentScrollLeft = container.scrollLeft;
    const containerWidth = container.clientWidth;

    // Calculate playhead position in current zoom
    const playheadPixels = playhead * basePixelsPerSecond * zoom;

    // Check if playhead is visible in viewport
    const playheadViewportOffset = playheadPixels - currentScrollLeft;
    const isPlayheadVisible = playheadViewportOffset >= 0 && playheadViewportOffset <= containerWidth;

    if (isPlayheadVisible) {
      // Calculate new playhead position at new zoom
      const newPlayheadPixels = playhead * basePixelsPerSecond * newZoom;

      // Adjust scroll to keep playhead at same viewport position
      const newScrollLeft = newPlayheadPixels - playheadViewportOffset;

      setZoom(newZoom);

      // Need to update scroll after state update
      requestAnimationFrame(() => {
        if (scrollContainerRef.current) {
          scrollContainerRef.current.scrollLeft = Math.max(0, newScrollLeft);
        }
      });
    } else {
      setZoom(newZoom);
    }
  }, [zoom, playhead]);

  // Handle wheel events: scroll horizontally or Ctrl+wheel to zoom
  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (e.ctrlKey) {
      // Ctrl + scroll = smooth exponential zoom
      e.preventDefault();

      // Multiplicative zoom: each scroll "tick" multiplies by a small factor
      // Negative deltaY = scroll up = zoom in, positive = scroll down = zoom out
      const scrollFactor = Math.pow(1.002, -e.deltaY);
      const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom * scrollFactor));

      zoomWithPlayheadCenter(newZoom);
    } else {
      // Normal scroll = horizontal scroll
      e.preventDefault();

      if (scrollContainerRef.current) {
        const newScrollLeft = scrollContainerRef.current.scrollLeft + e.deltaY;
        scrollContainerRef.current.scrollLeft = newScrollLeft;
      }
    }
  }, [zoom, zoomWithPlayheadCenter]);

  // Handle button zoom (exponential steps)
  const handleZoomIn = useCallback(() => {
    const newZoom = Math.min(zoom * ZOOM_FACTOR, MAX_ZOOM);
    zoomWithPlayheadCenter(newZoom);
  }, [zoom, zoomWithPlayheadCenter]);

  const handleZoomOut = useCallback(() => {
    const newZoom = Math.max(zoom / ZOOM_FACTOR, MIN_ZOOM);
    zoomWithPlayheadCenter(newZoom);
  }, [zoom, zoomWithPlayheadCenter]);

  return (
    <div className="timeline">
      {/* Timeline toolbar */}
      <div className="timeline-toolbar">
        <div className="timeline-timecode">{formatTime(playhead)}</div>
        <div className="timeline-toolbar-right">
          <button
            className={`snap-toggle ${snapEnabled ? 'active' : ''}`}
            onClick={() => setSnapEnabled(!snapEnabled)}
            title={snapEnabled ? 'Snapping On' : 'Snapping Off'}
          >
            <Magnet size={16} />
          </button>
          <div className="timeline-zoom-controls">
            <button onClick={handleZoomOut} title="Zoom Out">
              <ZoomOut size={14} />
            </button>
            <span className="zoom-level">
              {zoom * 100 < 10 ? (zoom * 100).toFixed(1) : Math.round(zoom * 100)}%
            </span>
            <button onClick={handleZoomIn} title="Zoom In">
              <ZoomIn size={14} />
            </button>
          </div>
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
              {/* Time ruler - click to move playhead, drag to scrub */}
              <div className="timeline-ruler" onMouseDown={startPlayheadScrub}>
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
                      className={`clip ${draggingClip?.id === clip.id ? 'dragging' : ''}`}
                      style={{
                        left: `${left}px`,
                        width: `${width}px`,
                      }}
                      onMouseDown={(e) => handleClipMouseDown(e, clip)}
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
