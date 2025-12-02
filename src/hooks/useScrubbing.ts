/**
 * Scrubbing Hook
 *
 * Handles mouse-based scrubbing on the scrub bar.
 * Pauses playback during scrub, seeks video directly, resumes after if was playing.
 *
 * Performance: Direct video.currentTime updates for < 16ms frame updates.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import type { PlaybackStateRef } from '@types';

interface UseScrubbingOptions {
  playbackStateRef: React.RefObject<PlaybackStateRef>;
  scrubBarRef: React.RefObject<HTMLDivElement>;
  timelineDuration: number;
  seek: (time: number) => void;
  pause: () => void;
  play: () => void;
}

interface ScrubbingControls {
  isScrubbing: boolean;
  handleScrubStart: (e: React.MouseEvent<HTMLDivElement>) => void;
}

export const useScrubbing = ({
  playbackStateRef,
  scrubBarRef,
  timelineDuration,
  seek,
  pause,
  play,
}: UseScrubbingOptions): ScrubbingControls => {
  const [isScrubbing, setIsScrubbing] = useState(false);
  const wasPlayingRef = useRef(false);

  // Calculate time from mouse X position
  const getTimeFromMouseX = useCallback((clientX: number): number => {
    const scrubBar = scrubBarRef.current;
    if (!scrubBar) return 0;

    const rect = scrubBar.getBoundingClientRect();
    const percent = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return percent * timelineDuration;
  }, [scrubBarRef, timelineDuration]);

  // Start scrubbing
  const handleScrubStart = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();

    const state = playbackStateRef.current;
    if (!state) return;

    // Remember if was playing
    wasPlayingRef.current = state.isPlaying;

    // Pause if playing
    if (state.isPlaying) {
      pause();
    }

    // Mark scrubbing
    state.isScrubbing = true;
    setIsScrubbing(true);

    // Seek to initial position
    const time = getTimeFromMouseX(e.clientX);
    seek(time);
  }, [playbackStateRef, getTimeFromMouseX, seek, pause]);

  // Handle mouse move (scrub)
  useEffect(() => {
    if (!isScrubbing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const time = getTimeFromMouseX(e.clientX);
      seek(time);
    };

    const handleMouseUp = () => {
      const state = playbackStateRef.current;
      if (state) {
        state.isScrubbing = false;
      }
      setIsScrubbing(false);

      // Resume playback if was playing before
      if (wasPlayingRef.current) {
        play();
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isScrubbing, getTimeFromMouseX, seek, play, playbackStateRef]);

  return {
    isScrubbing,
    handleScrubStart,
  };
};
