/**
 * Playback Engine Hook - Hybrid Architecture
 *
 * This hook implements a high-performance playback system with two modes:
 * 1. native-preview: Uses video.play() for continuous forward playback (best performance)
 * 2. driven-preview: Uses RAF loop to drive video.currentTime (for scrubbing, stepping, reverse)
 *
 * Key performance optimizations:
 * - Redux sync at 4Hz (configurable) instead of 60Hz
 * - Playback state in refs to avoid React re-renders
 * - Video element handles rendering natively (hardware accelerated)
 *
 * @see PROGRAM_MONITOR_REQUIREMENTS.md for architecture details
 */

import { useRef, useCallback, useEffect } from 'react';
import { useDispatch } from 'react-redux';
import { setPlayheadPosition } from '../store/timelineSlice';
import type { PlaybackStateRef } from '@types';

// Configuration: Redux sync interval
// 250ms = 4Hz (matches native timeupdate events)
// Change to 100ms for 10Hz if 4Hz feels laggy
const REDUX_SYNC_INTERVAL = 250; // 4Hz, configurable

interface UsePlaybackEngineOptions {
  videoRef: React.RefObject<HTMLVideoElement>;
  reduxPlayheadPosition: number;
  timelineDuration: number;
  previewReady: boolean;
}

interface PlaybackEngineControls {
  playbackStateRef: React.RefObject<PlaybackStateRef>;
  play: () => void;
  pause: () => void;
  togglePlayPause: () => void;
  seek: (time: number) => void;
  setSpeed: (speed: number, direction: 1 | -1) => void;
  stepFrame: (direction: 1 | -1, fps: number) => void;
  goToStart: () => void;
  goToEnd: () => void;
}

export const usePlaybackEngine = ({
  videoRef,
  reduxPlayheadPosition,
  timelineDuration,
  previewReady,
}: UsePlaybackEngineOptions): PlaybackEngineControls => {
  const dispatch = useDispatch();

  // High-frequency playback state (refs - no re-renders)
  const playbackStateRef = useRef<PlaybackStateRef>({
    isPlaying: false,
    playheadTime: reduxPlayheadPosition,
    playbackSpeed: 1,
    direction: 0,
    rafHandle: null,
    lastFrameTime: 0,
    lastReduxSyncTime: 0,
    mode: 'native-preview',
    isScrubbing: false,
    wasPlayingBeforeScrub: false,
  });

  // Sync Redux playhead to ref when changed externally (e.g., timeline scrub, timecode input)
  useEffect(() => {
    const state = playbackStateRef.current;
    // Only sync if not playing and not scrubbing (avoid fighting with playback loop)
    if (!state.isPlaying && !state.isScrubbing) {
      const drift = Math.abs(state.playheadTime - reduxPlayheadPosition);
      if (drift > 0.05) {
        state.playheadTime = reduxPlayheadPosition;
        // Seek video if paused
        if (videoRef.current && state.mode === 'native-preview') {
          videoRef.current.currentTime = reduxPlayheadPosition;
        }
      }
    }
  }, [reduxPlayheadPosition, videoRef]);

  // Throttled Redux sync
  const syncToRedux = useCallback((time: number, timestamp: number) => {
    const state = playbackStateRef.current;
    const timeSinceSync = timestamp - state.lastReduxSyncTime;

    if (timeSinceSync >= REDUX_SYNC_INTERVAL) {
      // Batch update in next microtask to avoid blocking RAF loop
      queueMicrotask(() => {
        dispatch(setPlayheadPosition(time));
      });
      state.lastReduxSyncTime = timestamp;
    }
  }, [dispatch]);

  // Native-preview mode: Video element plays natively, we just sync to Redux
  const nativePreviewLoop = useCallback((now: number) => {
    const state = playbackStateRef.current;
    const video = videoRef.current;

    if (!video || !state.isPlaying || state.mode !== 'native-preview') return;

    // Get current time from video element
    const videoTime = video.currentTime;
    state.playheadTime = videoTime;

    // Check if we've reached end
    if (videoTime >= timelineDuration) {
      dispatch(setPlayheadPosition(timelineDuration));
      state.isPlaying = false;
      state.direction = 0;
      video.pause();
      return;
    }

    // Sync to Redux at 4Hz
    syncToRedux(videoTime, now);

    // Continue loop
    state.rafHandle = requestAnimationFrame(nativePreviewLoop);
  }, [videoRef, timelineDuration, dispatch, syncToRedux]);

  // Driven-preview mode: RAF loop drives video.currentTime
  const drivenPreviewLoop = useCallback((now: number) => {
    const state = playbackStateRef.current;
    const video = videoRef.current;

    if (!video || !state.isPlaying || state.mode !== 'driven-preview') return;

    // Calculate delta time
    const delta = (now - state.lastFrameTime) / 1000;
    state.lastFrameTime = now;

    // Update playhead time
    const newTime = state.playheadTime + (delta * state.playbackSpeed * state.direction);

    // Check boundaries
    if (newTime >= timelineDuration) {
      state.playheadTime = timelineDuration;
      state.isPlaying = false;
      state.direction = 0;
      video.pause();
      dispatch(setPlayheadPosition(timelineDuration));
      return;
    }

    if (newTime <= 0) {
      state.playheadTime = 0;
      state.isPlaying = false;
      state.direction = 0;
      video.pause();
      dispatch(setPlayheadPosition(0));
      return;
    }

    state.playheadTime = newTime;

    // Drive video element
    video.currentTime = newTime;

    // Sync to Redux at 4Hz
    syncToRedux(newTime, now);

    // Continue loop
    state.rafHandle = requestAnimationFrame(drivenPreviewLoop);
  }, [videoRef, timelineDuration, dispatch, syncToRedux]);

  // Start playback
  const play = useCallback(() => {
    const state = playbackStateRef.current;
    const video = videoRef.current;

    if (!video || !previewReady) return;

    // Initialize playback
    state.isPlaying = true;
    state.lastFrameTime = performance.now();
    state.lastReduxSyncTime = performance.now();

    if (state.direction === 0) {
      state.direction = 1; // Default to forward
      state.playbackSpeed = 1;
    }

    // Determine mode based on direction
    if (state.direction === 1) {
      // Forward playback: use native-preview for best performance
      state.mode = 'native-preview';
      video.currentTime = state.playheadTime;
      video.playbackRate = state.playbackSpeed;
      video.play();
      state.rafHandle = requestAnimationFrame(nativePreviewLoop);
    } else {
      // Reverse playback: use driven-preview (video element doesn't support reverse)
      state.mode = 'driven-preview';
      video.muted = true; // Reverse is preview only, no audio (per user decision)
      video.pause(); // Don't use native play
      state.rafHandle = requestAnimationFrame(drivenPreviewLoop);
    }
  }, [videoRef, previewReady, nativePreviewLoop, drivenPreviewLoop]);

  // Pause playback
  const pause = useCallback(() => {
    const state = playbackStateRef.current;
    const video = videoRef.current;

    // Cancel RAF loop
    if (state.rafHandle !== null) {
      cancelAnimationFrame(state.rafHandle);
      state.rafHandle = null;
    }

    // Stop video
    if (video) {
      video.pause();
    }

    // Update state
    state.isPlaying = false;
    state.direction = 0;

    // Final sync to Redux
    dispatch(setPlayheadPosition(state.playheadTime));
  }, [videoRef, dispatch]);

  // Toggle play/pause
  const togglePlayPause = useCallback(() => {
    const state = playbackStateRef.current;
    if (state.isPlaying) {
      pause();
    } else {
      play();
    }
  }, [play, pause]);

  // Seek to position
  const seek = useCallback((time: number) => {
    const state = playbackStateRef.current;
    const video = videoRef.current;

    const clampedTime = Math.max(0, Math.min(timelineDuration, time));
    state.playheadTime = clampedTime;

    // Seek video element
    if (video) {
      video.currentTime = clampedTime;
    }

    // Update Redux immediately (user-driven action)
    dispatch(setPlayheadPosition(clampedTime));
  }, [videoRef, timelineDuration, dispatch]);

  // Set playback speed and direction
  const setSpeed = useCallback((speed: number, direction: 1 | -1) => {
    const state = playbackStateRef.current;
    const video = videoRef.current;

    const wasPlaying = state.isPlaying;

    // Pause first
    if (wasPlaying) {
      pause();
    }

    // Update speed and direction
    state.playbackSpeed = speed;
    state.direction = direction;

    // Resume if was playing
    if (wasPlaying) {
      play();
    } else {
      // Just update video playback rate if paused
      if (video && direction === 1) {
        video.playbackRate = speed;
      }
    }
  }, [videoRef, play, pause]);

  // Step frame forward/backward
  const stepFrame = useCallback((direction: 1 | -1, fps: number) => {
    const state = playbackStateRef.current;

    // Pause if playing
    if (state.isPlaying) {
      pause();
    }

    const frameDuration = 1 / fps;
    const newTime = state.playheadTime + (direction * frameDuration);
    seek(newTime);
  }, [pause, seek]);

  // Go to start
  const goToStart = useCallback(() => {
    const state = playbackStateRef.current;
    if (state.isPlaying) {
      pause();
    }
    seek(0);
  }, [pause, seek]);

  // Go to end
  const goToEnd = useCallback(() => {
    const state = playbackStateRef.current;
    if (state.isPlaying) {
      pause();
    }
    seek(timelineDuration);
  }, [pause, seek, timelineDuration]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      const state = playbackStateRef.current;
      if (state.rafHandle !== null) {
        cancelAnimationFrame(state.rafHandle);
      }
    };
  }, []);

  return {
    playbackStateRef,
    play,
    pause,
    togglePlayPause,
    seek,
    setSpeed,
    stepFrame,
    goToStart,
    goToEnd,
  };
};
