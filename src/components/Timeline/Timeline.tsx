/**
 * Timeline Component
 *
 * Main timeline for arranging and editing clips.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { Magnet, ZoomIn, ZoomOut, Link } from 'lucide-react';
import type { RootState, AppDispatch } from '../../store';
import { setPlayheadPosition, addClip, updateClip, removeClip, unlinkClips, linkClips, addTrack, removeTrack, updateTrack } from '../../store/timelineSlice';
import { selectClip, addToSelection, removeFromSelection, clearSelection } from '../../store/uiSlice';
import { initializeSequenceFromMedia } from '../../store/projectSlice';
import { recordHistoryState } from '../../store/historySlice';
import type { Clip, Track } from '@types';
import WaveformCanvas from './WaveformCanvas';
import './Timeline.css';

const Timeline: React.FC = () => {
  const dispatch = useDispatch<AppDispatch>();
  const tracks = useSelector((state: RootState) => state.timeline.tracks);
  const playhead = useSelector((state: RootState) => state.timeline.playheadPosition);
  const fps = useSelector((state: RootState) => state.project.settings.frameRate);
  const media = useSelector((state: RootState) => state.project.media);
  const selectedClipIds = useSelector((state: RootState) => state.ui.selectedClipIds);
  const activePane = useSelector((state: RootState) => state.ui.activePane);
  const sequenceInitialized = useSelector((state: RootState) => state.project.settings.sequenceInitialized);

  const timelineRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const tracksContainerRef = useRef<HTMLDivElement>(null);
  const justFinishedDraggingRef = useRef(false);

  const [zoom, setZoom] = useState(0.01); // Zoom multiplier (exponential scale), default 1%
  const [viewportWidth, setViewportWidth] = useState(0);
  // Enhanced drag state for cross-track clip movement
  const [draggingClip, setDraggingClip] = useState<{
    id: string;
    initialStart: number;
    mouseOffsetX: number;
    mouseOffsetY: number;
    sourceTrackId: string;
    targetTrackId: string | null;  // null = invalid target or same track
    clipType: 'video' | 'audio' | 'title' | 'solid' | 'adjustment';
  } | null>(null);
  const [snapEnabled, setSnapEnabled] = useState(true);

  // Drag preview state for showing ghost clips during drag from source
  const [dragPreview, setDragPreview] = useState<{
    mediaId: string;
    type: 'video' | 'audio' | 'both';
    duration: number;
    xPosition: number;
    targetTrackId: string | null;  // Track being hovered over
  } | null>(null);

  // Context menu state for gap operations
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    gapStart: number;
  } | null>(null);

  // Track context menu state
  const [trackContextMenu, setTrackContextMenu] = useState<{
    x: number;
    y: number;
    trackId: string;
  } | null>(null);

  // Track renaming state
  const [editingTrackId, setEditingTrackId] = useState<string | null>(null);
  const [editingTrackName, setEditingTrackName] = useState('');

  // Snap threshold in pixels
  const SNAP_THRESHOLD_PX = 10;

  // Zoom constraints (exponential scale)
  const MIN_ZOOM = 0.005; // 0.5% - can see ~5+ minutes in viewport
  const MAX_ZOOM = 1.0;   // 100% - frame-by-frame at 60fps (10px per frame)
  const ZOOM_FACTOR = 1.25; // Multiplicative factor for button clicks

  // Calculate maximum timeline duration: max(5 min, clips end + generous padding)
  const longestClipEnd = Math.max(
    ...tracks.flatMap(track =>
      track.clips.map(clip => clip.timelineStart + clip.duration)
    ),
    0
  );
  // Always provide at least 60 seconds of empty space after the last clip, or 5 minutes minimum
  const maxDuration = Math.max(300, longestClipEnd + 60);

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

  // Handle timeline click to move playhead and clear selection
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

    // Clear selection when clicking on empty timeline space
    if (selectedClipIds.length > 0) {
      dispatch(clearSelection());
    }
  }, [dispatch, zoom, selectedClipIds]);

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

  // Handle overlapping clips when placing a new clip
  // Cuts/splits existing clips to make room for the new clip
  const handleOverlapsOnDrop = useCallback((trackId: string, newStart: number, newEnd: number, excludeClipIds?: string[]) => {
    const track = tracks.find(t => t.id === trackId);
    if (!track) return;

    for (const clip of track.clips) {
      // Skip the clips being moved
      if (excludeClipIds && excludeClipIds.includes(clip.id)) continue;

      const clipStart = clip.timelineStart;
      const clipEnd = clip.timelineStart + clip.duration;

      // Check for overlap
      if (newStart >= clipEnd || newEnd <= clipStart) {
        // No overlap
        continue;
      }

      // Calculate media timing ratio for adjusting mediaIn/mediaOut
      const mediaRange = clip.mediaOut - clip.mediaIn;
      const timeToMedia = mediaRange / clip.duration;

      if (newStart <= clipStart && newEnd >= clipEnd) {
        // New clip completely covers existing clip - delete it
        dispatch(removeClip(clip.id));
      } else if (newStart <= clipStart && newEnd < clipEnd) {
        // New clip overlaps the start - trim the existing clip's start
        const trimAmount = newEnd - clipStart;
        const newMediaIn = clip.mediaIn + (trimAmount * timeToMedia);
        dispatch(updateClip({
          id: clip.id,
          updates: {
            timelineStart: newEnd,
            duration: clip.duration - trimAmount,
            mediaIn: newMediaIn,
          }
        }));
      } else if (newStart > clipStart && newEnd >= clipEnd) {
        // New clip overlaps the end - trim the existing clip's end
        const newDuration = newStart - clipStart;
        const newMediaOut = clip.mediaIn + (newDuration * timeToMedia);
        dispatch(updateClip({
          id: clip.id,
          updates: {
            duration: newDuration,
            mediaOut: newMediaOut,
          }
        }));
      } else if (newStart > clipStart && newEnd < clipEnd) {
        // New clip is in the middle - split existing clip into two
        // First part: from original start to new clip start
        const firstDuration = newStart - clipStart;
        const firstMediaOut = clip.mediaIn + (firstDuration * timeToMedia);
        dispatch(updateClip({
          id: clip.id,
          updates: {
            duration: firstDuration,
            mediaOut: firstMediaOut,
          }
        }));

        // Second part: from new clip end to original end
        const secondStart = newEnd;
        const secondDuration = clipEnd - newEnd;
        const secondMediaIn = clip.mediaIn + ((newEnd - clipStart) * timeToMedia);
        const secondClip: Clip = {
          id: `clip-${Date.now()}-${Math.random()}-split`,
          type: clip.type,
          mediaId: clip.mediaId,
          trackId: clip.trackId,
          timelineStart: secondStart,
          duration: secondDuration,
          mediaIn: secondMediaIn,
          mediaOut: clip.mediaOut,
          name: clip.name,
          enabled: clip.enabled,
          effects: [...clip.effects],
          linkId: clip.linkId,
        };
        dispatch(addClip(secondClip));
      }
    }
  }, [tracks, dispatch]);

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

  // Find gap at a specific time position on a track
  const findGapAtPosition = useCallback((trackId: string, time: number): { start: number; end: number } | null => {
    const track = tracks.find(t => t.id === trackId);
    if (!track || track.clips.length === 0) return null;

    // Sort clips by start time
    const sortedClips = [...track.clips].sort((a, b) => a.timelineStart - b.timelineStart);

    // Check gap before first clip
    if (time < sortedClips[0].timelineStart && time >= 0) {
      return { start: 0, end: sortedClips[0].timelineStart };
    }

    // Check gaps between clips
    for (let i = 0; i < sortedClips.length - 1; i++) {
      const currentClipEnd = sortedClips[i].timelineStart + sortedClips[i].duration;
      const nextClipStart = sortedClips[i + 1].timelineStart;

      if (currentClipEnd < nextClipStart && time >= currentClipEnd && time < nextClipStart) {
        return { start: currentClipEnd, end: nextClipStart };
      }
    }

    return null;
  }, [tracks]);

  // Ripple delete a gap - shift all clips on all tracks to the left until any clip hits another
  const rippleDeleteGap = useCallback((gapStart: number) => {
    // Record history before ripple delete
    dispatch(recordHistoryState('Ripple Delete'));

    // Find all clips across ALL tracks that start at or after the gap start
    const clipsToMove: { clipId: string; trackId: string; start: number }[] = [];

    for (const track of tracks) {
      for (const clip of track.clips) {
        if (clip.timelineStart >= gapStart) {
          clipsToMove.push({ clipId: clip.id, trackId: track.id, start: clip.timelineStart });
        }
      }
    }

    if (clipsToMove.length === 0) {
      setContextMenu(null);
      return;
    }

    // Calculate the maximum amount we can shift left
    // Limited by how far each moving clip can go before hitting a stationary clip on its track
    let maxShift = Infinity;

    for (const { trackId, start } of clipsToMove) {
      const track = tracks.find(t => t.id === trackId);
      if (!track) continue;

      // Find clips on the same track that are NOT moving (start before gapStart)
      const stationaryClips = track.clips.filter(c =>
        c.timelineStart < gapStart
      );

      if (stationaryClips.length > 0) {
        // Find the nearest stationary clip's end
        const nearestEnd = Math.max(...stationaryClips.map(c => c.timelineStart + c.duration));
        const availableSpace = start - nearestEnd;
        maxShift = Math.min(maxShift, availableSpace);
      } else {
        // No stationary clips on this track, can move all the way to 0
        maxShift = Math.min(maxShift, start);
      }
    }

    if (maxShift <= 0 || !isFinite(maxShift)) {
      setContextMenu(null);
      return;
    }

    // Shift all clips
    for (const { clipId, start } of clipsToMove) {
      dispatch(updateClip({
        id: clipId,
        updates: { timelineStart: start - maxShift }
      }));
    }

    setContextMenu(null);
  }, [tracks, dispatch]);

  // Handle right-click on track to show context menu for gaps
  const handleTrackContextMenu = useCallback((e: React.MouseEvent, trackId: string) => {
    e.preventDefault();

    if (!timelineRef.current) return;

    const rect = timelineRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickTime = pixelsToTime(clickX);

    // Check if we clicked on a gap on the clicked track
    const gap = findGapAtPosition(trackId, clickTime);
    if (!gap || gap.end - gap.start <= 0) return;

    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      gapStart: gap.start,
    });
  }, [pixelsToTime, findGapAtPosition]);

  // Close context menu when clicking elsewhere
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

  // Handle drop from SourcePreview
  const handleTrackDrop = useCallback((e: React.DragEvent, trackId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDragPreview(null); // Clear preview on drop

    const sourceData = e.dataTransfer.getData('application/chopchop-source');
    if (!sourceData) return;

    try {
      const { mediaId, type, inPoint, outPoint } = JSON.parse(sourceData) as {
        mediaId: string;
        type: 'video' | 'audio' | 'both';
        inPoint: number;
        outPoint: number;
      };

      // Find the media item
      const mediaItem = media.find(m => m.id === mediaId);
      if (!mediaItem) {
        console.error('Media item not found:', mediaId);
        return;
      }

      // Calculate drop position in timeline
      // getBoundingClientRect already accounts for scroll, so don't add scrollLeft
      if (!timelineRef.current) return;
      const rect = timelineRef.current.getBoundingClientRect();
      const dropX = e.clientX - rect.left;
      const rawDropTime = pixelsToTime(dropX);

      // Calculate clip duration from in/out points
      const clipDuration = outPoint - inPoint;

      // Apply snapping to the drop position (use empty string since this is a new clip)
      const dropTime = findSnapPoint(rawDropTime, clipDuration, '');

      // Determine which track to use based on drag type and target track
      const track = tracks.find(t => t.id === trackId);
      if (!track) return;

      // Generate linkId if dropping both video and audio
      const linkId = type === 'both' ? `link-${Date.now()}-${Math.random()}` : undefined;

      const clipStart = Math.max(0, dropTime);
      const clipEnd = clipStart + clipDuration;

      // Create clip(s) based on type
      // 'video' = video only, 'audio' = audio only, 'both' = linked video+audio
      if (type === 'video' || type === 'both') {
        // Find video track (or use current if it's a video track)
        const videoTrack = track.type === 'video' ? track : tracks.find(t => t.type === 'video');
        if (videoTrack) {
          // Auto-initialize sequence from first video clip
          if (!sequenceInitialized && mediaItem.metadata.width && mediaItem.metadata.height) {
            dispatch(initializeSequenceFromMedia({
              width: mediaItem.metadata.width,
              height: mediaItem.metadata.height,
              frameRate: mediaItem.metadata.frameRate,
            }));
          }

          // Handle overlaps before adding the new clip
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
        // Find audio track (or use current if it's an audio track)
        const audioTrack = track.type === 'audio' ? track : tracks.find(t => t.type === 'audio');
        if (audioTrack && mediaItem.type !== 'image') {
          // Handle overlaps before adding the new clip
          handleOverlapsOnDrop(audioTrack.id, clipStart, clipEnd, []);

          // Images don't have audio
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

  const handleTrackDragLeave = useCallback((e: React.DragEvent) => {
    // Only clear if leaving the timeline area entirely
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDragPreview(null);
    }
  }, []);

  const handleTimelineDragEnd = useCallback(() => {
    setDragPreview(null);
  }, []);

  // Get the track at a given Y position relative to the tracks container
  const getTrackAtY = useCallback((mouseY: number): Track | null => {
    if (!tracksContainerRef.current) return null;

    const containerRect = tracksContainerRef.current.getBoundingClientRect();
    const relativeY = mouseY - containerRect.top;

    // Track height is 60px (from CSS)
    const trackHeight = 60;
    const trackIndex = Math.floor(relativeY / trackHeight);

    if (trackIndex >= 0 && trackIndex < tracks.length) {
      return tracks[trackIndex];
    }
    return null;
  }, [tracks]);

  // Get all clips linked to a given clip (including the clip itself)
  const getLinkedClips = useCallback((clipId: string): Clip[] => {
    // Find the clip first
    let targetClip: Clip | undefined;
    for (const track of tracks) {
      targetClip = track.clips.find(c => c.id === clipId);
      if (targetClip) break;
    }

    if (!targetClip || !targetClip.linkId) {
      return targetClip ? [targetClip] : [];
    }

    // Find all clips with the same linkId
    const linkedClips: Clip[] = [];
    for (const track of tracks) {
      for (const clip of track.clips) {
        if (clip.linkId === targetClip.linkId) {
          linkedClips.push(clip);
        }
      }
    }

    return linkedClips;
  }, [tracks]);

  // Handle drag over for source preview drops (with snapping)
  const handleTrackDragOver = useCallback((e: React.DragEvent, trackId: string) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';

    // Read from global drag source (dataTransfer.getData is blocked during dragOver for security)
    const dragSource = (window as any).__chopchopDragSource as {
      mediaId: string;
      type: 'video' | 'audio' | 'both';
      inPoint: number;
      outPoint: number;
    } | null;

    if (dragSource && timelineRef.current) {
      const rect = timelineRef.current.getBoundingClientRect();
      const rawXPosition = e.clientX - rect.left;
      const duration = dragSource.outPoint - dragSource.inPoint;

      // Apply snapping to the preview position
      let xPosition = rawXPosition;
      if (snapEnabled) {
        const rawTime = pixelsToTime(rawXPosition);
        // Use empty string for excludeClipId since this is a new clip being dragged in
        const snappedTime = findSnapPoint(rawTime, duration, '');
        xPosition = timeToPixels(snappedTime);
      }

      setDragPreview({
        mediaId: dragSource.mediaId,
        type: dragSource.type,
        duration,
        xPosition,
        targetTrackId: trackId,  // Track being hovered
      });
    }
  }, [snapEnabled, pixelsToTime, timeToPixels, findSnapPoint]);

  // Handle clip drag start
  const handleClipMouseDown = useCallback((e: React.MouseEvent, clip: Clip) => {
    e.stopPropagation();
    e.preventDefault();

    if (!timelineRef.current) return;

    const rect = timelineRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const clipStartPixels = timeToPixels(clip.timelineStart);
    const mouseOffsetX = mouseX - clipStartPixels;

    // Get the source track for cross-track movement
    const sourceTrack = tracks.find(t => t.clips.some(c => c.id === clip.id));
    if (!sourceTrack) return;

    // Calculate Y offset within the clip for cross-track dragging
    const mouseOffsetY = e.clientY;

    // Get all linked clips for this clip
    const linkedClips = getLinkedClips(clip.id);
    const linkedClipIds = linkedClips.map(c => c.id);

    // Handle selection with Ctrl key for multi-select
    const isSelected = selectedClipIds.includes(clip.id);
    if (e.ctrlKey || e.metaKey) {
      // Ctrl+click: toggle selection of clip and all its linked clips
      if (isSelected) {
        // Deselect this clip and all linked clips
        for (const id of linkedClipIds) {
          dispatch(removeFromSelection(id));
        }
        return; // Don't start drag if deselecting
      } else {
        // Add this clip and all linked clips to selection
        for (const id of linkedClipIds) {
          if (!selectedClipIds.includes(id)) {
            dispatch(addToSelection(id));
          }
        }
      }
    } else {
      // Normal click: select this clip and all linked clips
      if (!isSelected) {
        // Clear selection and select all linked clips
        dispatch(clearSelection());
        dispatch(selectClip(clip.id));
        for (const id of linkedClipIds) {
          if (id !== clip.id) {
            dispatch(addToSelection(id));
          }
        }
      }
    }

    // Get clips to drag: if clip is in selection, drag all selected; otherwise just this clip
    const clipsToDrag = selectedClipIds.includes(clip.id) && selectedClipIds.length > 1
      ? selectedClipIds
      : [clip.id];

    // Also include linked clips for all clips being dragged
    const allClipIds = new Set<string>();
    for (const id of clipsToDrag) {
      const linked = getLinkedClips(id);
      for (const c of linked) {
        allClipIds.add(c.id);
      }
    }

    // Get initial positions for all clips to be moved
    const initialPositions: { id: string; trackId: string; start: number; duration: number; type: string }[] = [];
    for (const track of tracks) {
      for (const c of track.clips) {
        if (allClipIds.has(c.id)) {
          initialPositions.push({ id: c.id, trackId: track.id, start: c.timelineStart, duration: c.duration, type: c.type });
        }
      }
    }

    // Track the list of all clip IDs being moved
    const movedClipIds = Array.from(allClipIds);
    // Track the final applied delta (updated during drag)
    let finalDelta = 0;
    // Track the target track for cross-track movement
    let currentTargetTrackId: string | null = null;

    // Record history state BEFORE starting the drag
    dispatch(recordHistoryState('Move Clip'));

    setDraggingClip({
      id: clip.id,
      initialStart: clip.timelineStart,
      mouseOffsetX,
      mouseOffsetY,
      sourceTrackId: sourceTrack.id,
      targetTrackId: null,
      clipType: clip.type as 'video' | 'audio' | 'title' | 'solid' | 'adjustment',
    });

    const onMouseMove = (moveEvent: MouseEvent) => {
      if (!timelineRef.current) return;

      const rect = timelineRef.current.getBoundingClientRect();
      const mouseX = moveEvent.clientX - rect.left;
      const newStartPixels = mouseX - mouseOffsetX;
      let newStartTime = Math.max(0, pixelsToTime(newStartPixels));

      // Apply snapping
      newStartTime = findSnapPoint(newStartTime, clip.duration, clip.id);

      // Calculate the delta from original position
      finalDelta = newStartTime - clip.timelineStart;

      // Detect target track for cross-track movement
      const targetTrack = getTrackAtY(moveEvent.clientY);
      const isValidTarget = targetTrack &&
        targetTrack.id !== sourceTrack.id &&
        // Video clips can only go to video tracks, audio to audio
        ((clip.type === 'video' && targetTrack.type === 'video') ||
         (clip.type === 'audio' && targetTrack.type === 'audio'));

      currentTargetTrackId = isValidTarget ? targetTrack.id : null;

      // Update drag state with target track info
      setDraggingClip(prev => prev ? {
        ...prev,
        targetTrackId: currentTargetTrackId,
      } : null);

      // Move all selected/linked clips by the same delta (horizontal only during drag)
      for (const pos of initialPositions) {
        const newStart = Math.max(0, pos.start + finalDelta);
        dispatch(updateClip({ id: pos.id, updates: { timelineStart: newStart } }));
      }
    };

    const onMouseUp = () => {
      justFinishedDraggingRef.current = true;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);

      // Handle cross-track movement if we have a valid target track
      if (currentTargetTrackId && currentTargetTrackId !== sourceTrack.id) {
        // Move clips of the same type as the primary clip to the new track
        // Linked clips of different types stay on their original tracks
        for (const pos of initialPositions) {
          const newStart = Math.max(0, pos.start + finalDelta);
          const newEnd = newStart + pos.duration;

          // Only move clips of the same type to the new track
          if (pos.type === clip.type) {
            // Update trackId to move to new track
            dispatch(updateClip({
              id: pos.id,
              updates: {
                trackId: currentTargetTrackId,
                timelineStart: newStart,
              }
            }));
            // Handle overlaps on the new track
            handleOverlapsOnDrop(currentTargetTrackId, newStart, newEnd, movedClipIds);
          } else {
            // Different type - just update position on original track
            handleOverlapsOnDrop(pos.trackId, newStart, newEnd, movedClipIds);
          }
        }
      } else if (finalDelta !== 0) {
        // No cross-track movement, just handle horizontal movement overlaps
        for (const pos of initialPositions) {
          const newStart = Math.max(0, pos.start + finalDelta);
          const newEnd = newStart + pos.duration;
          handleOverlapsOnDrop(pos.trackId, newStart, newEnd, movedClipIds);
        }
      }

      setDraggingClip(null);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [dispatch, timeToPixels, pixelsToTime, findSnapPoint, getLinkedClips, getTrackAtY, selectedClipIds, tracks, handleOverlapsOnDrop]);

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

  // Keyboard handler for Delete key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle if typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      // Only handle delete if timeline is the active pane
      if (activePane !== 'timeline') return;

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedClipIds.length > 0) {
          e.preventDefault();
          // Delete all selected clips
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

  // Check if all selected clips share the same linkId (are linked together)
  const selectionLinkStatus = (() => {
    if (selectedClipIds.length < 2) return { canToggle: false, areLinked: false };

    // Get linkIds for all selected clips
    const linkIds = new Set<string | undefined>();
    for (const clipId of selectedClipIds) {
      for (const track of tracks) {
        const clip = track.clips.find(c => c.id === clipId);
        if (clip) {
          linkIds.add(clip.linkId);
          break;
        }
      }
    }

    // If all clips have the same linkId (and it's not undefined), they're linked
    const areLinked = linkIds.size === 1 && !linkIds.has(undefined);
    return { canToggle: true, areLinked };
  })();

  // Handle link toggle - links or unlinks selected clips
  const handleLinkToggle = useCallback(() => {
    if (selectedClipIds.length < 2) return;

    if (selectionLinkStatus.areLinked) {
      // Unlink: remove linkId from all selected clips
      dispatch(unlinkClips(selectedClipIds));
    } else {
      // Link: assign same linkId to all selected clips
      dispatch(linkClips(selectedClipIds));
    }
  }, [dispatch, selectedClipIds, selectionLinkStatus.areLinked]);

  // Handle adding a new track
  const handleAddTrack = useCallback((type: 'video' | 'audio') => {
    // Count existing tracks of this type to generate name
    const existingCount = tracks.filter(t => t.type === type).length;
    const name = type === 'video' ? `Video ${existingCount + 1}` : `Audio ${existingCount + 1}`;

    const newTrack: Track = {
      id: `${type}-${Date.now()}-${Math.random()}`,
      type,
      name,
      clips: [],
      muted: false,
      locked: false,
      visible: true,
      volume: 1,
    };

    dispatch(recordHistoryState('Add Track'));
    dispatch(addTrack(newTrack));
    setTrackContextMenu(null);
  }, [dispatch, tracks]);

  // Handle track header right-click for context menu
  const handleTrackHeaderContextMenu = useCallback((e: React.MouseEvent, trackId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setTrackContextMenu({
      x: e.clientX,
      y: e.clientY,
      trackId,
    });
  }, []);

  // Handle deleting a track
  const handleDeleteTrack = useCallback((trackId: string) => {
    const track = tracks.find(t => t.id === trackId);
    if (!track) return;

    // If track has clips, confirm deletion
    if (track.clips.length > 0) {
      const confirmed = window.confirm(
        `This track contains ${track.clips.length} clip(s). Delete track and all clips?`
      );
      if (!confirmed) {
        setTrackContextMenu(null);
        return;
      }
    }

    dispatch(recordHistoryState('Delete Track'));
    dispatch(removeTrack(trackId));
    setTrackContextMenu(null);
  }, [dispatch, tracks]);

  // Handle starting track rename
  const handleStartRename = useCallback((trackId: string) => {
    const track = tracks.find(t => t.id === trackId);
    if (track) {
      setEditingTrackId(trackId);
      setEditingTrackName(track.name);
    }
    setTrackContextMenu(null);
  }, [tracks]);

  // Handle saving track rename
  const handleSaveRename = useCallback(() => {
    if (editingTrackId && editingTrackName.trim()) {
      dispatch(updateTrack({ id: editingTrackId, updates: { name: editingTrackName.trim() } }));
    }
    setEditingTrackId(null);
    setEditingTrackName('');
  }, [dispatch, editingTrackId, editingTrackName]);

  // Handle canceling track rename
  const handleCancelRename = useCallback(() => {
    setEditingTrackId(null);
    setEditingTrackName('');
  }, []);

  // Close track context menu when clicking elsewhere
  useEffect(() => {
    const handleClick = () => {
      setTrackContextMenu(null);
    };
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

  return (
    <div className="timeline">
      {/* Timeline toolbar */}
      <div className="timeline-toolbar">
        <div className="timeline-timecode">{formatTime(playhead)}</div>
        <div className="timeline-toolbar-right">
          <button
            className={`link-toggle ${selectionLinkStatus.canToggle ? '' : 'disabled'} ${selectionLinkStatus.areLinked ? 'linked' : ''}`}
            onClick={handleLinkToggle}
            disabled={!selectionLinkStatus.canToggle}
            title={selectionLinkStatus.areLinked ? 'Unlink clips' : 'Link clips'}
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
        <div
          className="timeline-track-headers"
          onContextMenu={(e) => {
            // Only handle if clicking on empty space (not on a track header)
            if ((e.target as HTMLElement).classList.contains('timeline-track-headers')) {
              e.preventDefault();
              e.stopPropagation();
              setTrackContextMenu({
                x: e.clientX,
                y: e.clientY,
                trackId: '', // Empty = no specific track, just adding
              });
            }
          }}
        >
          {/* Spacer to align with timeline ruler */}
          <div className="track-headers-spacer" />
          {tracks.map((track) => (
            <div
              key={track.id}
              className="track-header"
              onContextMenu={(e) => handleTrackHeaderContextMenu(e, track.id)}
            >
              {/* Track name - editable on double-click */}
              {editingTrackId === track.id ? (
                <input
                  type="text"
                  className="track-name-input"
                  value={editingTrackName}
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
                <span
                  className="track-name"
                  onDoubleClick={() => handleStartRename(track.id)}
                >
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

        {/* Timeline area (right side) */}
        <div
          className="timeline-area"
          ref={scrollContainerRef}
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
          <div
            className="timeline-tracks"
            ref={tracksContainerRef}
            onDragLeave={handleTrackDragLeave}
            onDragEnd={handleTimelineDragEnd}
          >
            {tracks.map((track) => {
              // Determine if this track should show a ghost clip
              // For 'video' or 'audio' only: show on hovered track of matching type
              // For 'both': show video on hovered video track (or first video track if hovering audio),
              //             audio always on first audio track
              let showGhost = false;
              if (dragPreview) {
                const hoveredTrack = tracks.find(t => t.id === dragPreview.targetTrackId);
                const firstVideoTrack = tracks.find(t => t.type === 'video');
                const firstAudioTrack = tracks.find(t => t.type === 'audio');

                if (dragPreview.type === 'both') {
                  // Video ghost: show on hovered video track, or first video track if hovering audio
                  if (track.type === 'video') {
                    if (hoveredTrack?.type === 'video' && dragPreview.targetTrackId === track.id) {
                      showGhost = true;
                    } else if (hoveredTrack?.type === 'audio' && firstVideoTrack && track.id === firstVideoTrack.id) {
                      showGhost = true;
                    }
                  }
                  // Audio ghost: always on first audio track
                  if (track.type === 'audio' && firstAudioTrack && track.id === firstAudioTrack.id) {
                    showGhost = true;
                  }
                } else if (dragPreview.type === 'video' && track.type === 'video') {
                  showGhost = dragPreview.targetTrackId === track.id;
                } else if (dragPreview.type === 'audio' && track.type === 'audio') {
                  showGhost = dragPreview.targetTrackId === track.id;
                }
              }
              const ghostLeft = dragPreview ? dragPreview.xPosition : 0;
              const ghostWidth = dragPreview ? timeToPixels(dragPreview.duration) : 0;
              const ghostMedia = dragPreview ? media.find(m => m.id === dragPreview.mediaId) : null;

              // Determine drop target state for cross-track clip movement
              const isValidDropTarget = draggingClip &&
                draggingClip.sourceTrackId !== track.id &&
                ((draggingClip.clipType === 'video' && track.type === 'video') ||
                 (draggingClip.clipType === 'audio' && track.type === 'audio'));
              const isCurrentDropTarget = draggingClip?.targetTrackId === track.id;
              const isInvalidDropTarget = draggingClip &&
                draggingClip.sourceTrackId !== track.id &&
                !isValidDropTarget;

              // Show ghost on target track during cross-track drag
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
                {/* Ghost clip preview during drag from source */}
                {showGhost && (
                  <div
                    className={`clip ghost-clip ${track.type === 'video' ? 'video-clip' : 'audio-clip'}`}
                    style={{
                      left: `${ghostLeft}px`,
                      width: `${ghostWidth}px`,
                    }}
                  >
                    <div className="clip-content">
                      <div className="clip-info">
                        <span className="clip-name">{ghostMedia?.name || 'Clip'}</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Ghost clip preview during cross-track drag */}
                {showCrossTrackGhost && crossTrackGhostClip && (
                  <div
                    className={`clip ghost-clip ${track.type === 'video' ? 'video-clip' : 'audio-clip'}`}
                    style={{
                      left: `${timeToPixels(crossTrackGhostClip.timelineStart)}px`,
                      width: `${timeToPixels(crossTrackGhostClip.duration)}px`,
                    }}
                  >
                    <div className="clip-content">
                      <div className="clip-info">
                        <span className="clip-name">{crossTrackGhostClip.name}</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Render clips */}
                {track.clips.map(clip => {
                  const left = timeToPixels(clip.timelineStart);
                  const width = timeToPixels(clip.duration);

                  const isSelected = selectedClipIds.includes(clip.id);
                  const clipMedia = clip.mediaId ? media.find(m => m.id === clip.mediaId) : null;
                  const isVideoClip = clip.type === 'video';
                  const isAudioClip = clip.type === 'audio';

                  return (
                    <div
                      key={clip.id}
                      className={`clip ${isVideoClip ? 'video-clip' : ''} ${isAudioClip ? 'audio-clip' : ''} ${isSelected ? 'selected' : ''} ${draggingClip?.id === clip.id ? 'dragging' : ''}`}
                      style={{
                        left: `${left}px`,
                        width: `${width}px`,
                      }}
                      onMouseDown={(e) => handleClipMouseDown(e, clip)}
                    >
                      <div className="clip-content">
                        {/* Clip name overlay */}
                        <div className="clip-info">
                          {clip.linkId && (
                            <Link size={12} className="clip-link-indicator" />
                          )}
                          <span className="clip-name">{clip.name}</span>
                        </div>

                        {/* Video clips: thumbnail fills the clip */}
                        {isVideoClip && (
                          <div className="clip-thumbnail">
                            {clipMedia?.thumbnailPath ? (
                              <img src={clipMedia.thumbnailPath} alt="" />
                            ) : (
                              <div className="clip-thumbnail-placeholder">▶</div>
                            )}
                          </div>
                        )}

                        {/* Audio clips: waveform visualization */}
                        {isAudioClip && (
                          <div className="clip-waveform">
                            {clipMedia?.waveformData ? (
                              <WaveformCanvas
                                waveformData={clipMedia.waveformData}
                                mediaDuration={clipMedia.duration}
                                mediaIn={clip.mediaIn}
                                mediaOut={clip.mediaOut}
                                width={width}
                                height={52}
                              />
                            ) : (
                              <div className="clip-waveform-placeholder" />
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
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

      {/* Gap Context Menu */}
      {contextMenu && (
        <div
          className="timeline-context-menu"
          style={{
            position: 'fixed',
            left: contextMenu.x,
            top: contextMenu.y,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="context-menu-item"
            onClick={() => rippleDeleteGap(contextMenu.gapStart)}
          >
            Ripple Delete
          </button>
        </div>
      )}

      {/* Track Context Menu */}
      {trackContextMenu && (
        <div
          className="timeline-context-menu"
          style={{
            position: 'fixed',
            left: trackContextMenu.x,
            top: trackContextMenu.y,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="context-menu-item"
            onClick={() => handleAddTrack('video')}
          >
            Add Video Track
          </button>
          <button
            className="context-menu-item"
            onClick={() => handleAddTrack('audio')}
          >
            Add Audio Track
          </button>
          {trackContextMenu.trackId && (
            <>
              <button
                className="context-menu-item"
                onClick={() => handleStartRename(trackContextMenu.trackId)}
              >
                Rename Track
              </button>
              <button
                className="context-menu-item context-menu-item-danger"
                onClick={() => handleDeleteTrack(trackContextMenu.trackId)}
              >
                Delete Track
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default Timeline;
