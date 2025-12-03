/**
 * useClipDrag Hook
 *
 * Manages clip dragging state and logic.
 * Single Responsibility: Handle clip drag interactions.
 */

import { useState, useCallback, RefObject } from 'react';
import { useDispatch } from 'react-redux';
import type { AppDispatch } from '../../../store';
import { updateClip } from '../../../store/timelineSlice';
import { selectClip, addToSelection, removeFromSelection, clearSelection } from '../../../store/uiSlice';
import { recordHistoryState } from '../../../store/historySlice';
import type { Track, Clip } from '@types';

type ClipType = 'video' | 'audio' | 'title' | 'solid' | 'adjustment';

interface DraggingClipState {
  id: string;
  initialStart: number;
  mouseOffsetX: number;
  mouseOffsetY: number;
  sourceTrackId: string;
  targetTrackId: string | null;
  clipType: ClipType;
}

interface ClipDragConfig {
  tracks: Track[];
  selectedClipIds: string[];
  timelineRef: RefObject<HTMLDivElement>;
  tracksContainerRef: RefObject<HTMLDivElement>;
  timeToPixels: (seconds: number) => number;
  pixelsToTime: (pixels: number) => number;
  findSnapPoint: (time: number, clipDuration: number, excludeClipId: string) => number;
  getLinkedClips: (clipId: string) => Clip[];
  handleOverlapsOnDrop: (trackId: string, newStart: number, newEnd: number, excludeClipIds?: string[]) => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
}

interface ClipDragResult {
  draggingClip: DraggingClipState | null;
  handleClipMouseDown: (e: React.MouseEvent, clip: Clip) => void;
}

export function useClipDrag({
  tracks,
  selectedClipIds,
  timelineRef,
  tracksContainerRef,
  timeToPixels,
  pixelsToTime,
  findSnapPoint,
  getLinkedClips,
  handleOverlapsOnDrop,
  onDragStart,
  onDragEnd,
}: ClipDragConfig): ClipDragResult {
  const dispatch = useDispatch<AppDispatch>();
  const [draggingClip, setDraggingClip] = useState<DraggingClipState | null>(null);

  const getTrackAtY = useCallback((mouseY: number): Track | null => {
    if (!tracksContainerRef.current) return null;

    const containerRect = tracksContainerRef.current.getBoundingClientRect();
    const relativeY = mouseY - containerRect.top;
    const trackHeight = 60;
    const trackIndex = Math.floor(relativeY / trackHeight);

    if (trackIndex >= 0 && trackIndex < tracks.length) {
      return tracks[trackIndex];
    }
    return null;
  }, [tracks, tracksContainerRef]);

  const handleClipMouseDown = useCallback((e: React.MouseEvent, clip: Clip) => {
    e.stopPropagation();
    e.preventDefault();

    if (!timelineRef.current) return;

    const rect = timelineRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const clipStartPixels = timeToPixels(clip.timelineStart);
    const mouseOffsetX = mouseX - clipStartPixels;

    const sourceTrack = tracks.find(t => t.clips.some(c => c.id === clip.id));
    if (!sourceTrack) return;

    const mouseOffsetY = e.clientY;
    const linkedClips = getLinkedClips(clip.id);
    const linkedClipIds = linkedClips.map(c => c.id);

    // Handle selection
    const isSelected = selectedClipIds.includes(clip.id);
    if (e.ctrlKey || e.metaKey) {
      if (isSelected) {
        for (const id of linkedClipIds) {
          dispatch(removeFromSelection(id));
        }
        return;
      } else {
        for (const id of linkedClipIds) {
          if (!selectedClipIds.includes(id)) {
            dispatch(addToSelection(id));
          }
        }
      }
    } else {
      if (!isSelected) {
        dispatch(clearSelection());
        dispatch(selectClip(clip.id));
        for (const id of linkedClipIds) {
          if (id !== clip.id) {
            dispatch(addToSelection(id));
          }
        }
      }
    }

    // Get clips to drag
    const clipsToDrag = selectedClipIds.includes(clip.id) && selectedClipIds.length > 1
      ? selectedClipIds
      : [clip.id];

    const allClipIds = new Set<string>();
    for (const id of clipsToDrag) {
      const linked = getLinkedClips(id);
      for (const c of linked) {
        allClipIds.add(c.id);
      }
    }

    // Get initial positions
    const initialPositions: { id: string; trackId: string; start: number; duration: number; type: string }[] = [];
    for (const track of tracks) {
      for (const c of track.clips) {
        if (allClipIds.has(c.id)) {
          initialPositions.push({
            id: c.id,
            trackId: track.id,
            start: c.timelineStart,
            duration: c.duration,
            type: c.type,
          });
        }
      }
    }

    const movedClipIds = Array.from(allClipIds);
    let finalDelta = 0;
    let currentTargetTrackId: string | null = null;

    dispatch(recordHistoryState('Move Clip'));
    onDragStart?.();

    setDraggingClip({
      id: clip.id,
      initialStart: clip.timelineStart,
      mouseOffsetX,
      mouseOffsetY,
      sourceTrackId: sourceTrack.id,
      targetTrackId: null,
      clipType: clip.type as ClipType,
    });

    const onMouseMove = (moveEvent: MouseEvent) => {
      if (!timelineRef.current) return;

      const rect = timelineRef.current.getBoundingClientRect();
      const mouseX = moveEvent.clientX - rect.left;
      const newStartPixels = mouseX - mouseOffsetX;
      let newStartTime = Math.max(0, pixelsToTime(newStartPixels));

      newStartTime = findSnapPoint(newStartTime, clip.duration, clip.id);
      finalDelta = newStartTime - clip.timelineStart;

      // Detect target track
      const targetTrack = getTrackAtY(moveEvent.clientY);
      const isValidTarget = targetTrack &&
        targetTrack.id !== sourceTrack.id &&
        ((clip.type === 'video' && targetTrack.type === 'video') ||
         (clip.type === 'audio' && targetTrack.type === 'audio'));

      currentTargetTrackId = isValidTarget ? targetTrack.id : null;

      setDraggingClip(prev => prev ? {
        ...prev,
        targetTrackId: currentTargetTrackId,
      } : null);

      // Move all clips
      for (const pos of initialPositions) {
        const newStart = Math.max(0, pos.start + finalDelta);
        dispatch(updateClip({ id: pos.id, updates: { timelineStart: newStart } }));
      }
    };

    const onMouseUp = () => {
      onDragEnd?.();
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);

      if (currentTargetTrackId && currentTargetTrackId !== sourceTrack.id) {
        for (const pos of initialPositions) {
          const newStart = Math.max(0, pos.start + finalDelta);
          const newEnd = newStart + pos.duration;

          if (pos.type === clip.type) {
            dispatch(updateClip({
              id: pos.id,
              updates: {
                trackId: currentTargetTrackId,
                timelineStart: newStart,
              }
            }));
            handleOverlapsOnDrop(currentTargetTrackId, newStart, newEnd, movedClipIds);
          } else {
            handleOverlapsOnDrop(pos.trackId, newStart, newEnd, movedClipIds);
          }
        }
      } else if (finalDelta !== 0) {
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
  }, [
    dispatch,
    timeToPixels,
    pixelsToTime,
    findSnapPoint,
    getLinkedClips,
    getTrackAtY,
    selectedClipIds,
    tracks,
    handleOverlapsOnDrop,
    timelineRef,
    tracksContainerRef,
    onDragStart,
    onDragEnd,
  ]);

  return { draggingClip, handleClipMouseDown };
}
