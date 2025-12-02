/**
 * JKL Shuttle Control Hook
 *
 * Implements J/K/L keyboard shuttle control for video playback:
 * - J: Reverse playback (preview only, muted per user decision)
 * - K: Stop/Pause
 * - L: Forward playback at increasing speeds
 *
 * Pressing J or L multiple times increases speed.
 * Switching direction resets to slowest speed.
 */

import { useCallback } from 'react';
import { useDispatch } from 'react-redux';
import { setPlayingPane } from '../store/uiSlice';
import type { PlaybackStateRef } from '@types';

// Playback speeds for shuttle control
const PLAYBACK_SPEEDS = [0.5, 1, 2, 4];

interface UseJKLShuttleOptions {
  playbackStateRef: React.RefObject<PlaybackStateRef>;
  play: () => void;
  pause: () => void;
  setSpeed: (speed: number, direction: 1 | -1) => void;
}

interface JKLShuttleControls {
  handleJ: () => void;
  handleK: () => void;
  handleL: () => void;
}

export const useJKLShuttle = ({
  playbackStateRef,
  play,
  pause,
  setSpeed,
}: UseJKLShuttleOptions): JKLShuttleControls => {
  const dispatch = useDispatch();

  // J key - Reverse playback (preview only, muted)
  const handleJ = useCallback(() => {
    const state = playbackStateRef.current;
    if (!state) return;

    if (state.direction === 1) {
      // Switch from forward to reverse
      pause();
      setSpeed(PLAYBACK_SPEEDS[0], -1);
      play();
      dispatch(setPlayingPane('program'));
    } else if (state.direction === -1) {
      // Already reversing - increase speed
      const currentIndex = PLAYBACK_SPEEDS.indexOf(state.playbackSpeed);
      const nextIndex = Math.min(currentIndex + 1, PLAYBACK_SPEEDS.length - 1);
      setSpeed(PLAYBACK_SPEEDS[nextIndex], -1);
      if (!state.isPlaying) {
        play();
        dispatch(setPlayingPane('program'));
      }
    } else {
      // Start reverse playback
      setSpeed(PLAYBACK_SPEEDS[0], -1);
      play();
      dispatch(setPlayingPane('program'));
    }
  }, [playbackStateRef, play, pause, setSpeed, dispatch]);

  // K key - Stop
  const handleK = useCallback(() => {
    pause();
    dispatch(setPlayingPane(null));
  }, [pause, dispatch]);

  // L key - Forward playback
  const handleL = useCallback(() => {
    const state = playbackStateRef.current;
    if (!state) return;

    if (state.direction === -1) {
      // Switch from reverse to forward
      pause();
      setSpeed(PLAYBACK_SPEEDS[0], 1);
      play();
      dispatch(setPlayingPane('program'));
    } else if (state.direction === 1) {
      // Already playing forward - increase speed
      const currentIndex = PLAYBACK_SPEEDS.indexOf(state.playbackSpeed);
      const nextIndex = Math.min(currentIndex + 1, PLAYBACK_SPEEDS.length - 1);
      setSpeed(PLAYBACK_SPEEDS[nextIndex], 1);
      if (!state.isPlaying) {
        play();
        dispatch(setPlayingPane('program'));
      }
    } else {
      // Start forward playback
      setSpeed(PLAYBACK_SPEEDS[0], 1);
      play();
      dispatch(setPlayingPane('program'));
    }
  }, [playbackStateRef, play, pause, setSpeed, dispatch]);

  return {
    handleJ,
    handleK,
    handleL,
  };
};
