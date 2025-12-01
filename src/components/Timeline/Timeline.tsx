/**
 * Timeline Component
 *
 * Main timeline for arranging and editing clips.
 */

import React, { useCallback, useRef, useState } from 'react';
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
  const [zoom, setZoom] = useState(1); // Pixels per second
  const [isDraggingPlayhead, setIsDraggingPlayhead] = useState(false);

  // Get the longest track duration for timeline width
  const maxDuration = Math.max(
    ...tracks.map(track => {
      const lastClip = track.clips[track.clips.length - 1];
      return lastClip ? lastClip.timelineStart + lastClip.duration : 0;
    }),
    60 // Minimum 60 seconds
  );

  const timelineWidth = maxDuration * zoom * 100; // Convert to pixels

  // Convert time (seconds) to pixels
  const timeToPixels = (seconds: number): number => {
    return seconds * zoom * 100;
  };

  // Convert pixels to time (seconds)
  const pixelsToTime = (pixels: number): number => {
    return pixels / (zoom * 100);
  };

  // Handle timeline click to move playhead
  const handleTimelineClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!timelineRef.current) return;

    const rect = timelineRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const newTime = pixelsToTime(clickX);

    dispatch(setPlayheadPosition(Math.max(0, newTime)));
  }, [dispatch, zoom]);

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
      const dropTime = pixelsToTime(dropX);

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

  // Handle zoom
  const handleZoomIn = () => setZoom(prev => Math.min(prev * 1.5, 10));
  const handleZoomOut = () => setZoom(prev => Math.max(prev / 1.5, 0.1));

  return (
    <div className="timeline">
      {/* Timeline toolbar */}
      <div className="timeline-toolbar">
        <div className="timeline-timecode">{formatTime(playhead)}</div>
        <div className="timeline-zoom-controls">
          <button onClick={handleZoomOut} title="Zoom Out">−</button>
          <div className="zoom-level">{Math.round(zoom * 100)}%</div>
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
        <div className="timeline-area" ref={timelineRef} onClick={handleTimelineClick}>
          {/* Time ruler */}
          <div className="timeline-ruler" style={{ width: `${timelineWidth}px` }}>
            {Array.from({ length: Math.ceil(maxDuration / 5) }).map((_, i) => {
              const seconds = i * 5;
              return (
                <div
                  key={i}
                  className="ruler-marker"
                  style={{ left: `${timeToPixels(seconds)}px` }}
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
                style={{ width: `${timelineWidth}px` }}
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
  );
};

export default Timeline;
