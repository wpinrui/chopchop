/**
 * useSnapToGrid Hook
 *
 * Provides snapping functionality for timeline clips.
 * Single Responsibility: Calculate snap points and find nearest snap targets.
 */

import { useCallback } from 'react';
import type { Track } from '@types';

const SNAP_THRESHOLD_PX = 10;

interface SnapConfig {
  tracks: Track[];
  playhead: number;
  snapEnabled: boolean;
  pixelsToTime: (pixels: number) => number;
}

interface SnapResult {
  getSnapPoints: (excludeClipId: string) => number[];
  findSnapPoint: (time: number, clipDuration: number, excludeClipId: string) => number;
}

export function useSnapToGrid({
  tracks,
  playhead,
  snapEnabled,
  pixelsToTime,
}: SnapConfig): SnapResult {
  const getSnapPoints = useCallback((excludeClipId: string): number[] => {
    const points: number[] = [playhead];

    for (const track of tracks) {
      for (const clip of track.clips) {
        if (clip.id !== excludeClipId) {
          points.push(clip.timelineStart);
          points.push(clip.timelineStart + clip.duration);
        }
      }
    }

    return points;
  }, [tracks, playhead]);

  const findSnapPoint = useCallback((
    time: number,
    clipDuration: number,
    excludeClipId: string
  ): number => {
    if (!snapEnabled) return time;

    const snapPoints = getSnapPoints(excludeClipId);
    const thresholdTime = pixelsToTime(SNAP_THRESHOLD_PX);

    let bestSnap = time;
    let bestDistance = Infinity;

    // Check clip start snapping
    for (const point of snapPoints) {
      const distance = Math.abs(time - point);
      if (distance < thresholdTime && distance < bestDistance) {
        bestSnap = point;
        bestDistance = distance;
      }
    }

    // Check clip end snapping
    const clipEnd = time + clipDuration;
    for (const point of snapPoints) {
      const distance = Math.abs(clipEnd - point);
      if (distance < thresholdTime && distance < bestDistance) {
        bestSnap = point - clipDuration;
        bestDistance = distance;
      }
    }

    return Math.max(0, bestSnap);
  }, [snapEnabled, getSnapPoints, pixelsToTime]);

  return { getSnapPoints, findSnapPoint };
}
