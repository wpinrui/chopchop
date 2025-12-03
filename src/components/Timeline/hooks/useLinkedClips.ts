/**
 * useLinkedClips Hook
 *
 * Provides functions for working with linked clips.
 * Single Responsibility: Linked clip operations only.
 */

import { useCallback, useMemo } from 'react';
import { useDispatch } from 'react-redux';
import type { AppDispatch } from '../../../store';
import { linkClips, unlinkClips } from '../../../store/timelineSlice';
import type { Track, Clip } from '@types';

interface LinkedClipsConfig {
  tracks: Track[];
  selectedClipIds: string[];
}

interface LinkStatus {
  canToggle: boolean;
  areLinked: boolean;
}

interface LinkedClipsResult {
  getLinkedClips: (clipId: string) => Clip[];
  linkStatus: LinkStatus;
  handleLinkToggle: () => void;
}

export function useLinkedClips({ tracks, selectedClipIds }: LinkedClipsConfig): LinkedClipsResult {
  const dispatch = useDispatch<AppDispatch>();

  const getLinkedClips = useCallback((clipId: string): Clip[] => {
    let targetClip: Clip | undefined;
    for (const track of tracks) {
      targetClip = track.clips.find(c => c.id === clipId);
      if (targetClip) break;
    }

    if (!targetClip || !targetClip.linkId) {
      return targetClip ? [targetClip] : [];
    }

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

  const linkStatus = useMemo((): LinkStatus => {
    if (selectedClipIds.length < 2) {
      return { canToggle: false, areLinked: false };
    }

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

    const areLinked = linkIds.size === 1 && !linkIds.has(undefined);
    return { canToggle: true, areLinked };
  }, [tracks, selectedClipIds]);

  const handleLinkToggle = useCallback(() => {
    if (selectedClipIds.length < 2) return;

    if (linkStatus.areLinked) {
      dispatch(unlinkClips(selectedClipIds));
    } else {
      dispatch(linkClips(selectedClipIds));
    }
  }, [dispatch, selectedClipIds, linkStatus.areLinked]);

  return { getLinkedClips, linkStatus, handleLinkToggle };
}
