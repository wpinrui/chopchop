/**
 * Timeline Component
 *
 * Main timeline for arranging and editing clips.
 * Refactored to use custom hooks following Single Responsibility Principle.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { Magnet, ZoomIn, ZoomOut, Link } from 'lucide-react';
import type { RootState, AppDispatch } from '../../store';
import { setPlayheadPosition, addClip, removeClip } from '../../store/timelineSlice';
import { clearSelection } from '../../store/uiSlice';
import { initializeSequenceFromMedia } from '../../store/projectSlice';
import type { Clip } from '@types';
import {
  useTimeConversion,
  useSnapToGrid,
  useTimelineZoom,
  useTrackOperations,
  useGapOperations,
  useLinkedClips,
  useOverlapHandler,
  useClipDrag,
} from './hooks';
import { TimelineContextMenu, TrackContextMenu, TimelineClip } from './components';
import './Timeline.css';

// Context menu state types
interface GapContextMenuState {
  x: number;
  y: number;
  gapStart: number;
}

interface TrackContextMenuState {
  x: number;
  y: number;
  trackId: string;
}

// Drag preview state type
interface DragPreviewState {
  mediaId: string;
  type: 'video' | 'audio' | 'both';
  duration: number;
  xPosition: number;
  targetTrackId: string | null;
}

const Timeline: React.FC = () => {
  const dispatch = useDispatch<AppDispatch>();

  // Redux state
  const tracks = useSelector((state: RootState) => state.timeline.tracks);
  const playhead = useSelector((state: RootState) => state.timeline.playheadPosition);
  const fps = useSelector((state: RootState) => state.project.settings.frameRate);
  const media = useSelector((state: RootState) => state.project.media);
  const selectedClipIds = useSelector((state: RootState) => state.ui.selectedClipIds);
  const activePane = useSelector((state: RootState) => state.ui.activePane);
  const sequenceInitialized = useSelector((state: RootState) => state.project.settings.sequenceInitialized);

  // Refs
  const timelineRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const tracksContainerRef = useRef<HTMLDivElement>(null);
  const justFinishedDraggingRef = useRef(false);

  // Local state
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [contextMenu, setContextMenu] = useState<GapContextMenuState | null>(null);
  const [trackContextMenu, setTrackContextMenu] = useState<TrackContextMenuState | null>(null);
  const [dragPreview, setDragPreview] = useState<DragPreviewState | null>(null);

  // Custom hooks
  const { zoom, handleZoomIn, handleZoomOut, handleWheelZoom } = useTimelineZoom({
    playhead,
    scrollContainerRef,
  });

  const { timeToPixels, pixelsToTime, formatTime, basePixelsPerSecond } = useTimeConversion({
    zoom,
    fps,
  });

  const { findSnapPoint } = useSnapToGrid({
    tracks,
    playhead,
    snapEnabled,
    pixelsToTime,
  });

  const { getLinkedClips, linkStatus, handleLinkToggle } = useLinkedClips({
    tracks,
    selectedClipIds,
  });

  const { handleOverlapsOnDrop } = useOverlapHandler({ tracks });

  const { findGapAtPosition, rippleDeleteGap } = useGapOperations({ tracks });

  const {
    renameState,
    handleAddTrack,
    handleDeleteTrack,
    handleStartRename,
    handleSaveRename,
    handleCancelRename,
    setEditingTrackName,
  } = useTrackOperations({ tracks });

  const { draggingClip, handleClipMouseDown } = useClipDrag({
    tracks,
    selectedClipIds,
    timelineRef,
    tracksContainerRef,
    timeToPixels,
    pixelsToTime,
    findSnapPoint,
    getLinkedClips,
    handleOverlapsOnDrop,
    onDragEnd: () => { justFinishedDraggingRef.current = true; },
  });

  // Calculate timeline dimensions
  const longestClipEnd = Math.max(
    ...tracks.flatMap(track => track.clips.map(clip => clip.timelineStart + clip.duration)),
    0
  );
  const maxDuration = Math.max(300, longestClipEnd + 60);
  const timelineWidth = maxDuration * basePixelsPerSecond * zoom;

  // Calculate ruler interval
  const getRulerInterval = (): number => {
    const pixelsPerSecond = zoom * basePixelsPerSecond;
    const viewportSeconds = viewportWidth / pixelsPerSecond;
    const targetMarkers = 10;
    const idealInterval = viewportSeconds / targetMarkers;
    const intervals = [1/60, 1/30, 1/10, 0.5, 1, 5, 10, 30, 60, 300, 600, 1800, 3600];
    return intervals.find(i => i >= idealInterval) || 3600;
  };

  const rulerInterval = getRulerInterval();

  // Event handlers
  const handleTimelineClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (justFinishedDraggingRef.current) {
      justFinishedDraggingRef.current = false;
      return;
    }

    if (!timelineRef.current) return;

    const rect = timelineRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const newTime = Math.max(0, clickX / (basePixelsPerSecond * zoom));

    dispatch(setPlayheadPosition(newTime));

    if (selectedClipIds.length > 0) {
      dispatch(clearSelection());
    }
  }, [dispatch, zoom, selectedClipIds, basePixelsPerSecond]);

  const startPlayheadScrub = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();

    if (timelineRef.current) {
      const rect = timelineRef.current.getBoundingClientRect();
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
  }, [dispatch, zoom, basePixelsPerSecond]);

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
  }, [dispatch, zoom, basePixelsPerSecond]);

  const handleTrackContextMenu = useCallback((e: React.MouseEvent, trackId: string) => {
    e.preventDefault();
    if (!timelineRef.current) return;

    const rect = timelineRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickTime = pixelsToTime(clickX);

    const gap = findGapAtPosition(trackId, clickTime);
    if (!gap || gap.end - gap.start <= 0) return;

    setContextMenu({ x: e.clientX, y: e.clientY, gapStart: gap.start });
  }, [pixelsToTime, findGapAtPosition]);

  const handleTrackHeaderContextMenu = useCallback((e: React.MouseEvent, trackId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setTrackContextMenu({ x: e.clientX, y: e.clientY, trackId });
  }, []);

  const handleTrackDrop = useCallback((e: React.DragEvent, trackId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDragPreview(null);

    const sourceData = e.dataTransfer.getData('application/chopchop-source');
    if (!sourceData) return;

    try {
      const { mediaId, type, inPoint, outPoint } = JSON.parse(sourceData);
      const mediaItem = media.find(m => m.id === mediaId);
      if (!mediaItem || !timelineRef.current) return;

      const rect = timelineRef.current.getBoundingClientRect();
      const dropX = e.clientX - rect.left;
      const rawDropTime = pixelsToTime(dropX);
      const clipDuration = outPoint - inPoint;
      const dropTime = findSnapPoint(rawDropTime, clipDuration, '');

      const track = tracks.find(t => t.id === trackId);
      if (!track) return;

      const linkId = type === 'both' ? `link-${Date.now()}-${Math.random()}` : undefined;
      const clipStart = Math.max(0, dropTime);
      const clipEnd = clipStart + clipDuration;

      if (type === 'video' || type === 'both') {
        const videoTrack = track.type === 'video' ? track : tracks.find(t => t.type === 'video');
        if (videoTrack) {
          if (!sequenceInitialized && mediaItem.metadata.width && mediaItem.metadata.height) {
            dispatch(initializeSequenceFromMedia({
              width: mediaItem.metadata.width,
              height: mediaItem.metadata.height,
              frameRate: mediaItem.metadata.frameRate,
            }));
          }

          handleOverlapsOnDrop(videoTrack.id, clipStart, clipEnd, []);

          const videoClip: Clip = {
            id: `clip-${Date.now()}-${Math.random()}`,
            type: 'video',
            mediaId: mediaItem.id,
            trackId: videoTrack.id,
            timelineStart: clipStart,
            duration: clipDuration,
            mediaIn: inPoint,
            mediaOut: outPoint,
            name: mediaItem.name,
            enabled: true,
            effects: [],
            linkId,
          };
          dispatch(addClip(videoClip));
        }
      }

      if (type === 'audio' || type === 'both') {
        const audioTrack = track.type === 'audio' ? track : tracks.find(t => t.type === 'audio');
        if (audioTrack && mediaItem.type !== 'image') {
          handleOverlapsOnDrop(audioTrack.id, clipStart, clipEnd, []);

          const audioClip: Clip = {
            id: `clip-${Date.now()}-${Math.random()}-audio`,
            type: 'audio',
            mediaId: mediaItem.id,
            trackId: audioTrack.id,
            timelineStart: clipStart,
            duration: clipDuration,
            mediaIn: inPoint,
            mediaOut: outPoint,
            name: mediaItem.name,
            enabled: true,
            effects: [],
            linkId,
          };
          dispatch(addClip(audioClip));
        }
      }
    } catch (error) {
      console.error('Error dropping media on timeline:', error);
    }
  }, [dispatch, pixelsToTime, findSnapPoint, media, tracks, handleOverlapsOnDrop, sequenceInitialized]);

  const handleTrackDragOver = useCallback((e: React.DragEvent, trackId: string) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';

    const dragSource = (window as any).__chopchopDragSource;
    if (dragSource && timelineRef.current) {
      const rect = timelineRef.current.getBoundingClientRect();
      const rawXPosition = e.clientX - rect.left;
      const duration = dragSource.outPoint - dragSource.inPoint;

      let xPosition = rawXPosition;
      if (snapEnabled) {
        const rawTime = pixelsToTime(rawXPosition);
        const snappedTime = findSnapPoint(rawTime, duration, '');
        xPosition = timeToPixels(snappedTime);
      }

      setDragPreview({ mediaId: dragSource.mediaId, type: dragSource.type, duration, xPosition, targetTrackId: trackId });
    }
  }, [snapEnabled, pixelsToTime, timeToPixels, findSnapPoint]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (e.ctrlKey) {
      e.preventDefault();
      handleWheelZoom(e.deltaY);
    } else {
      e.preventDefault();
      if (scrollContainerRef.current) {
        scrollContainerRef.current.scrollLeft += e.deltaY;
      }
    }
  }, [handleWheelZoom]);

  // Effects
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

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (activePane !== 'timeline') return;

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedClipIds.length > 0) {
          e.preventDefault();
          for (const clipId of selectedClipIds) {
            dispatch(removeClip(clipId));
          }
          dispatch(clearSelection());
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [dispatch, selectedClipIds, activePane]);

  useEffect(() => {
    const handleClick = () => setContextMenu(null);
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setContextMenu(null);
    };

    if (contextMenu) {
      window.addEventListener('click', handleClick);
      window.addEventListener('keydown', handleKeyDown);
      return () => {
        window.removeEventListener('click', handleClick);
        window.removeEventListener('keydown', handleKeyDown);
      };
    }
  }, [contextMenu]);

  useEffect(() => {
    const handleClick = () => setTrackContextMenu(null);
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setTrackContextMenu(null);
        handleCancelRename();
      }
    };

    if (trackContextMenu) {
      window.addEventListener('click', handleClick);
      window.addEventListener('keydown', handleKeyDown);
      return () => {
        window.removeEventListener('click', handleClick);
        window.removeEventListener('keydown', handleKeyDown);
      };
    }
  }, [trackContextMenu, handleCancelRename]);

  // Helper function to determine ghost clip visibility
  const shouldShowGhostClip = (trackId: string): boolean => {
    if (!dragPreview) return false;

    const hoveredTrack = tracks.find(t => t.id === dragPreview.targetTrackId);
    const firstVideoTrack = tracks.find(t => t.type === 'video');
    const firstAudioTrack = tracks.find(t => t.type === 'audio');
    const track = tracks.find(t => t.id === trackId);

    if (!track) return false;

    if (dragPreview.type === 'both') {
      if (track.type === 'video') {
        if (hoveredTrack?.type === 'video' && dragPreview.targetTrackId === trackId) return true;
        if (hoveredTrack?.type === 'audio' && firstVideoTrack?.id === trackId) return true;
      }
      if (track.type === 'audio' && firstAudioTrack?.id === trackId) return true;
    } else if (dragPreview.type === 'video' && track.type === 'video') {
      return dragPreview.targetTrackId === trackId;
    } else if (dragPreview.type === 'audio' && track.type === 'audio') {
      return dragPreview.targetTrackId === trackId;
    }

    return false;
  };

  return (
    <div className="timeline">
      {/* Timeline toolbar */}
      <div className="timeline-toolbar">
        <div className="timeline-timecode">{formatTime(playhead)}</div>
        <div className="timeline-toolbar-right">
          <button
            className={`link-toggle ${linkStatus.canToggle ? '' : 'disabled'} ${linkStatus.areLinked ? 'linked' : ''}`}
            onClick={handleLinkToggle}
            disabled={!linkStatus.canToggle}
            title={linkStatus.areLinked ? 'Unlink clips' : 'Link clips'}
          >
            <Link size={16} />
          </button>
          <button
            className={`snap-toggle ${snapEnabled ? 'active' : ''}`}
            onClick={() => setSnapEnabled(!snapEnabled)}
            title={snapEnabled ? 'Snapping On' : 'Snapping Off'}
          >
            <Magnet size={16} />
          </button>
          <div className="timeline-zoom-controls">
            <button onClick={handleZoomOut} title="Zoom Out"><ZoomOut size={14} /></button>
            <span className="zoom-level">
              {zoom * 100 < 10 ? (zoom * 100).toFixed(1) : Math.round(zoom * 100)}%
            </span>
            <button onClick={handleZoomIn} title="Zoom In"><ZoomIn size={14} /></button>
          </div>
        </div>
      </div>

      {/* Timeline content */}
      <div className="timeline-content">
        {/* Track headers */}
        <div
          className="timeline-track-headers"
          onContextMenu={(e) => {
            if ((e.target as HTMLElement).classList.contains('timeline-track-headers')) {
              e.preventDefault();
              e.stopPropagation();
              setTrackContextMenu({ x: e.clientX, y: e.clientY, trackId: '' });
            }
          }}
        >
          <div className="track-headers-spacer" />
          {tracks.map((track) => (
            <div
              key={track.id}
              className="track-header"
              onContextMenu={(e) => handleTrackHeaderContextMenu(e, track.id)}
            >
              {renameState.editingTrackId === track.id ? (
                <input
                  type="text"
                  className="track-name-input"
                  value={renameState.editingTrackName}
                  onChange={(e) => setEditingTrackName(e.target.value)}
                  onBlur={handleSaveRename}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSaveRename();
                    if (e.key === 'Escape') handleCancelRename();
                  }}
                  autoFocus
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <span className="track-name" onDoubleClick={() => handleStartRename(track.id)}>
                  {track.name}
                </span>
              )}
              <div className="track-controls">
                <button className="track-toggle" title="Mute">M</button>
                <button className="track-toggle" title="Solo">S</button>
                <button className="track-toggle" title="Lock">L</button>
              </div>
            </div>
          ))}
        </div>

        {/* Timeline area */}
        <div className="timeline-area" ref={scrollContainerRef} onWheel={handleWheel}>
          <div
            className="timeline-scrollable-content"
            ref={timelineRef}
            onClick={handleTimelineClick}
            style={{ width: `${timelineWidth}px` }}
          >
            {/* Time ruler */}
            <div className="timeline-ruler" onMouseDown={startPlayheadScrub}>
              {Array.from({ length: Math.ceil(maxDuration / rulerInterval) }).map((_, i) => {
                const seconds = i * rulerInterval;
                const position = timeToPixels(seconds);
                return (
                  <div key={i} className="ruler-marker" style={{ left: `${position}px` }}>
                    <div className="ruler-tick" />
                    <div className="ruler-label">{formatTime(seconds, true)}</div>
                  </div>
                );
              })}
            </div>

            {/* Tracks */}
            <div
              className="timeline-tracks"
              ref={tracksContainerRef}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragPreview(null);
              }}
              onDragEnd={() => setDragPreview(null)}
            >
              {tracks.map((track) => {
                const showGhost = shouldShowGhostClip(track.id);
                const ghostMedia = dragPreview ? media.find(m => m.id === dragPreview.mediaId) : null;

                const isValidDropTarget = draggingClip &&
                  draggingClip.sourceTrackId !== track.id &&
                  ((draggingClip.clipType === 'video' && track.type === 'video') ||
                   (draggingClip.clipType === 'audio' && track.type === 'audio'));
                const isCurrentDropTarget = draggingClip?.targetTrackId === track.id;
                const isInvalidDropTarget = draggingClip &&
                  draggingClip.sourceTrackId !== track.id && !isValidDropTarget;

                const showCrossTrackGhost = isCurrentDropTarget && draggingClip;
                const crossTrackGhostClip = showCrossTrackGhost
                  ? tracks.flatMap(t => t.clips).find(c => c.id === draggingClip.id)
                  : null;

                return (
                  <div
                    key={track.id}
                    className={`track ${isCurrentDropTarget ? 'drop-target' : ''} ${isInvalidDropTarget ? 'drop-invalid' : ''}`}
                    onDragOver={(e) => handleTrackDragOver(e, track.id)}
                    onDrop={(e) => handleTrackDrop(e, track.id)}
                    onContextMenu={(e) => handleTrackContextMenu(e, track.id)}
                  >
                    {/* Ghost clip during drag from source */}
                    {showGhost && dragPreview && (
                      <div
                        className={`clip ghost-clip ${track.type === 'video' ? 'video-clip' : 'audio-clip'}`}
                        style={{ left: `${dragPreview.xPosition}px`, width: `${timeToPixels(dragPreview.duration)}px` }}
                      >
                        <div className="clip-content">
                          <div className="clip-info">
                            <span className="clip-name">{ghostMedia?.name || 'Clip'}</span>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Ghost clip during cross-track drag */}
                    {showCrossTrackGhost && crossTrackGhostClip && (
                      <div
                        className={`clip ghost-clip ${track.type === 'video' ? 'video-clip' : 'audio-clip'}`}
                        style={{ left: `${timeToPixels(crossTrackGhostClip.timelineStart)}px`, width: `${timeToPixels(crossTrackGhostClip.duration)}px` }}
                      >
                        <div className="clip-content">
                          <div className="clip-info">
                            <span className="clip-name">{crossTrackGhostClip.name}</span>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Render clips */}
                    {track.clips.map(clip => (
                      <TimelineClip
                        key={clip.id}
                        clip={clip}
                        media={clip.mediaId ? media.find(m => m.id === clip.mediaId) || null : null}
                        isSelected={selectedClipIds.includes(clip.id)}
                        isDragging={draggingClip?.id === clip.id}
                        left={timeToPixels(clip.timelineStart)}
                        width={timeToPixels(clip.duration)}
                        onMouseDown={handleClipMouseDown}
                      />
                    ))}
                  </div>
                );
              })}
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

      {/* Context Menus */}
      {contextMenu && (
        <TimelineContextMenu
          contextMenu={contextMenu}
          onRippleDelete={(gapStart) => {
            rippleDeleteGap(gapStart);
            setContextMenu(null);
          }}
        />
      )}

      {trackContextMenu && (
        <TrackContextMenu
          contextMenu={trackContextMenu}
          onAddVideoTrack={() => { handleAddTrack('video'); setTrackContextMenu(null); }}
          onAddAudioTrack={() => { handleAddTrack('audio'); setTrackContextMenu(null); }}
          onRename={(id) => { handleStartRename(id); setTrackContextMenu(null); }}
          onDelete={(id) => { handleDeleteTrack(id); setTrackContextMenu(null); }}
        />
      )}
    </div>
  );
};

export default Timeline;
