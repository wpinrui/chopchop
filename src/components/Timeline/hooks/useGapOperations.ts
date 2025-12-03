/**
 * useGapOperations Hook
 *
 * Handles gap detection and ripple delete operations.
 * Single Responsibility: Timeline gap management only.
 */

import { useCallback } from 'react';
import { useDispatch } from 'react-redux';
import type { AppDispatch } from '../../../store';
import { updateClip } from '../../../store/timelineSlice';
import { recordHistoryState } from '../../../store/historySlice';
import type { Track } from '@types';

interface GapOperationsConfig {
  tracks: Track[];
}

interface Gap {
  start: number;
  end: number;
}

interface GapOperations {
  findGapAtPosition: (trackId: string, time: number) => Gap | null;
  rippleDeleteGap: (gapStart: number) => void;
}

export function useGapOperations({ tracks }: GapOperationsConfig): GapOperations {
  const dispatch = useDispatch<AppDispatch>();

  const findGapAtPosition = useCallback((trackId: string, time: number): Gap | null => {
    const track = tracks.find(t => t.id === trackId);
    if (!track || track.clips.length === 0) return null;

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

  const rippleDeleteGap = useCallback((gapStart: number) => {
    dispatch(recordHistoryState('Ripple Delete'));

    // Find all clips across ALL tracks that start at or after the gap start
    const clipsToMove: { clipId: string; trackId: string; start: number }[] = [];

    for (const track of tracks) {
      for (const clip of track.clips) {
        if (clip.timelineStart >= gapStart) {
          clipsToMove.push({
            clipId: clip.id,
            trackId: track.id,
            start: clip.timelineStart,
          });
        }
      }
    }

    if (clipsToMove.length === 0) return;

    // Calculate maximum shift amount
    let maxShift = Infinity;

    for (const { trackId, start } of clipsToMove) {
      const track = tracks.find(t => t.id === trackId);
      if (!track) continue;

      const stationaryClips = track.clips.filter(c => c.timelineStart < gapStart);

      if (stationaryClips.length > 0) {
        const nearestEnd = Math.max(
          ...stationaryClips.map(c => c.timelineStart + c.duration)
        );
        const availableSpace = start - nearestEnd;
        maxShift = Math.min(maxShift, availableSpace);
      } else {
        maxShift = Math.min(maxShift, start);
      }
    }

    if (maxShift <= 0 || !isFinite(maxShift)) return;

    // Shift all clips
    for (const { clipId, start } of clipsToMove) {
      dispatch(updateClip({
        id: clipId,
        updates: { timelineStart: start - maxShift }
      }));
    }
  }, [tracks, dispatch]);

  return { findGapAtPosition, rippleDeleteGap };
}
