/**
 * useOverlapHandler Hook
 *
 * Handles clip overlap detection and resolution when dropping clips.
 * Single Responsibility: Overlap detection and clip splitting/trimming.
 */

import { useCallback } from 'react';
import { useDispatch } from 'react-redux';
import type { AppDispatch } from '../../../store';
import { addClip, updateClip, removeClip } from '../../../store/timelineSlice';
import type { Track, Clip } from '@types';

interface OverlapHandlerConfig {
  tracks: Track[];
}

interface OverlapHandler {
  handleOverlapsOnDrop: (
    trackId: string,
    newStart: number,
    newEnd: number,
    excludeClipIds?: string[]
  ) => void;
}

export function useOverlapHandler({ tracks }: OverlapHandlerConfig): OverlapHandler {
  const dispatch = useDispatch<AppDispatch>();

  const handleOverlapsOnDrop = useCallback((
    trackId: string,
    newStart: number,
    newEnd: number,
    excludeClipIds: string[] = []
  ) => {
    const track = tracks.find(t => t.id === trackId);
    if (!track) return;

    for (const clip of track.clips) {
      if (excludeClipIds.includes(clip.id)) continue;

      const clipStart = clip.timelineStart;
      const clipEnd = clip.timelineStart + clip.duration;

      // No overlap
      if (newStart >= clipEnd || newEnd <= clipStart) continue;

      const mediaRange = clip.mediaOut - clip.mediaIn;
      const timeToMedia = mediaRange / clip.duration;

      if (newStart <= clipStart && newEnd >= clipEnd) {
        // Complete overlap - delete existing clip
        dispatch(removeClip(clip.id));
      } else if (newStart <= clipStart && newEnd < clipEnd) {
        // Overlap at start - trim beginning
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
        // Overlap at end - trim end
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
        // Middle overlap - split into two clips
        const firstDuration = newStart - clipStart;
        const firstMediaOut = clip.mediaIn + (firstDuration * timeToMedia);

        dispatch(updateClip({
          id: clip.id,
          updates: {
            duration: firstDuration,
            mediaOut: firstMediaOut,
          }
        }));

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

  return { handleOverlapsOnDrop };
}
