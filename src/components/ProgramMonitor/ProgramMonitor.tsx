/**
 * Program Monitor Component - Hybrid Preview Architecture
 *
 * High-performance video playback using:
 * - Native video.play() for forward playback of pre-rendered preview
 * - Canvas + frame extraction from source files for pause/scrub (full quality)
 * - Pitch-shifted audio during scrubbing
 * - Single-frame audio for frame stepping (accurate cutting)
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  ChevronsLeft,
  ChevronsRight,
  Volume2,
  VolumeX,
  Loader,
} from 'lucide-react';
import type { RootState } from '../../store';
import { setActivePane, setPlayingPane } from '../../store/uiSlice';
import { setPlayheadPosition } from '../../store/timelineSlice';
import { updateSettings } from '../../store/projectSlice';
import TimecodeInput from '../TimecodeInput/TimecodeInput';
import { useHybridPreview, useFrameRenderer } from '../../hooks/useHybridPreview';
import './ProgramMonitor.css';

// Preview quality options
const PREVIEW_QUALITY_OPTIONS = [
  { value: 1, label: 'Full' },
  { value: 0.5, label: '1/2' },
  { value: 0.25, label: '1/4' },
  { value: 0.125, label: '1/8' },
];

// Playback speeds for J/L shuttle control
const PLAYBACK_SPEEDS = [0.5, 1, 2, 4];

// Display mode: video for playback, canvas for pause/scrub
type DisplayMode = 'video' | 'canvas';

const ProgramMonitor: React.FC = () => {
  const dispatch = useDispatch();

  // Refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrubBarRef = useRef<HTMLDivElement>(null);

  // Container size for calculating display dimensions
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });

  // Redux state
  const tracks = useSelector((state: RootState) => state.timeline.tracks);
  const playheadPosition = useSelector((state: RootState) => state.timeline.playheadPosition);
  const fps = useSelector((state: RootState) => state.project.settings.frameRate);
  const activePane = useSelector((state: RootState) => state.ui.activePane);
  const playingPane = useSelector((state: RootState) => state.ui.playingPane);

  // Sequence settings
  const sequenceResolution = useSelector((state: RootState) => state.project.settings.resolution);
  const backgroundColor = useSelector((state: RootState) => state.project.settings.backgroundColor);
  const previewQuality = useSelector((state: RootState) => state.project.settings.previewQuality) ?? 1;

  // Preview file state (legacy - for video playback fallback)
  const preview = useSelector((state: RootState) => state.preview.preview);
  const previewReady = preview.status === 'ready';
  const previewRendering = preview.status === 'rendering';
  const renderProgress = preview.progress;

  const [fullWidth, fullHeight] = sequenceResolution;
  const seqWidth = Math.round(fullWidth * previewQuality);
  const seqHeight = Math.round(fullHeight * previewQuality);

  const isActive = activePane === 'program';
  const shouldHandleKeyboard = playingPane === 'program' ||
    (playingPane === null && (isActive || activePane === 'timeline'));

  // Local UI state
  const [isMuted, setIsMuted] = useState(false);
  const [showLoadingDialog, setShowLoadingDialog] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [displayMode, setDisplayMode] = useState<DisplayMode>('canvas');
  const [playbackSpeed, setPlaybackSpeed] = useState(1); // Current speed magnitude
  const [playbackDirection, setPlaybackDirection] = useState<-1 | 0 | 1>(0); // -1 = backward, 0 = paused, 1 = forward

  // Source playback mode - for playing directly from source files
  const [sourcePlaybackInfo, setSourcePlaybackInfo] = useState<{
    enabled: boolean;
    mediaPath: string;
    clipStart: number; // Timeline start of current clip
    clipEnd: number; // Timeline end of current clip
    mediaOffset: number; // Offset into the source file
  } | null>(null);
  const sourceVideoRef = useRef<HTMLVideoElement>(null);

  // Hybrid preview system
  const [previewState, previewActions] = useHybridPreview();
  const renderFrame = useFrameRenderer(canvasRef);

  // Scrub state for velocity tracking
  const scrubStateRef = useRef({
    lastTime: 0,
    lastPosition: 0,
    isActive: false,
  });

  // Calculate timeline duration
  const timelineDuration = Math.max(
    ...tracks.flatMap(track =>
      track.clips.map(clip => clip.timelineStart + clip.duration)
    ),
    1 // Minimum 1 second
  );

  // Track container size with ResizeObserver
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setContainerSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Calculate canvas/video display size to fill container while maintaining aspect ratio
  const displaySize = (() => {
    if (containerSize.width === 0 || containerSize.height === 0) {
      return { width: seqWidth, height: seqHeight };
    }

    const containerAspect = containerSize.width / containerSize.height;
    const seqAspect = seqWidth / seqHeight;

    if (seqAspect > containerAspect) {
      return {
        width: containerSize.width,
        height: containerSize.width / seqAspect,
      };
    } else {
      return {
        width: containerSize.height * seqAspect,
        height: containerSize.height,
      };
    }
  })();

  // Format timecode as HH:MM:SS:FF
  const formatTimecode = useCallback((seconds: number): string => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const frames = Math.floor((seconds % 1) * fps);

    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}:${frames.toString().padStart(2, '0')}`;
  }, [fps]);

  // Extract and render frame at current playhead
  const extractAndRenderFrame = useCallback(async (time: number) => {
    const frame = await previewActions.extractFrame(time);
    if (frame.success && frame.data) {
      renderFrame(frame);
    }
  }, [previewActions, renderFrame]);

  // Initialize preview and extract first frame when ready
  useEffect(() => {
    if (previewState.isInitialized && !isPlaying) {
      extractAndRenderFrame(playheadPosition);
    }
  }, [previewState.isInitialized]);

  // Extract frame when paused and playhead changes (from timeline scrub, timecode input, etc.)
  const lastExtractedTimeRef = useRef<number>(-1);
  useEffect(() => {
    if (!isPlaying && !isScrubbing && previewState.isInitialized) {
      // Avoid extracting the same frame multiple times
      if (Math.abs(playheadPosition - lastExtractedTimeRef.current) > 0.001) {
        lastExtractedTimeRef.current = playheadPosition;
        extractAndRenderFrame(playheadPosition);
      }
    }
  }, [playheadPosition, isPlaying, isScrubbing, previewState.isInitialized, extractAndRenderFrame]);

  // Play handler - supports progressive playback from source
  const handlePlay = useCallback(async (speed: number = 1) => {
    // Wrap around to start if playhead is at or beyond timeline duration
    const startTime = playheadPosition >= timelineDuration ? 0 : playheadPosition;
    if (startTime !== playheadPosition) {
      dispatch(setPlayheadPosition(startTime));
    }

    // Check if we can play directly from source (simple segment)
    const playbackInfo = await previewActions.getPlaybackInfo(startTime);
    const clipInfo = await previewActions.getClipAtTime(startTime);

    // If this is a simple segment and we have a clip, play from source
    if (!playbackInfo.isComplex && clipInfo?.hasClip && clipInfo.mediaPath) {
      const sourceVideo = sourceVideoRef.current;
      if (sourceVideo) {
        // Find the clip boundaries for monitoring when to switch
        const clip = tracks.flatMap(t => t.clips).find(c => {
          const clipStart = c.timelineStart;
          const clipEnd = c.timelineStart + c.duration;
          return startTime >= clipStart && startTime < clipEnd;
        });

        if (clip) {
          setSourcePlaybackInfo({
            enabled: true,
            mediaPath: clipInfo.mediaPath,
            clipStart: clip.timelineStart,
            clipEnd: clip.timelineStart + clip.duration,
            mediaOffset: clip.mediaIn - clip.timelineStart,
          });

          setIsPlaying(true);
          setDisplayMode('video');
          setPlaybackDirection(1);
          setPlaybackSpeed(speed);
          dispatch(setPlayingPane('program'));

          // Set source and seek to correct position
          const srcUrl = `file:///${clipInfo.mediaPath.replace(/\\/g, '/')}`;
          if (sourceVideo.src !== srcUrl) {
            sourceVideo.src = srcUrl;
            await new Promise<void>((resolve) => {
              sourceVideo.onloadedmetadata = () => resolve();
              sourceVideo.onerror = () => resolve();
            });
          }

          sourceVideo.playbackRate = speed;
          sourceVideo.currentTime = clipInfo.mediaTime;
          sourceVideo.muted = isMuted;
          sourceVideo.play();
          return;
        }
      }
    }

    // Fall back to pre-rendered preview if available
    if (previewReady) {
      const video = videoRef.current;
      if (!video) return;

      setSourcePlaybackInfo(null);
      setIsPlaying(true);
      setDisplayMode('video');
      setPlaybackDirection(1);
      setPlaybackSpeed(speed);
      dispatch(setPlayingPane('program'));

      video.playbackRate = speed;
      video.currentTime = startTime;
      video.play();
      return;
    }

    // No source clip and no preview ready - show loading dialog
    setShowLoadingDialog(true);
  }, [previewReady, playheadPosition, timelineDuration, dispatch, previewActions, tracks, isMuted]);

  // Pause handler
  const handlePause = useCallback(async () => {
    // Pause both video elements
    const video = videoRef.current;
    const sourceVideo = sourceVideoRef.current;

    if (video) {
      video.pause();
    }
    if (sourceVideo) {
      sourceVideo.pause();
    }

    setIsPlaying(false);
    setDisplayMode('canvas');
    setPlaybackDirection(0);
    dispatch(setPlayingPane(null));

    // Extract frame at pause position for full quality display
    // Determine current time based on which playback mode we're in
    let currentTime: number;
    if (playbackDirection === -1) {
      // Reverse playback - use playheadPosition
      currentTime = playheadPosition;
    } else if (sourcePlaybackInfo?.enabled && sourceVideo) {
      // Source playback - calculate timeline time from source video
      currentTime = sourceVideo.currentTime - sourcePlaybackInfo.mediaOffset;
    } else if (video) {
      // Preview playback
      currentTime = video.currentTime;
    } else {
      currentTime = playheadPosition;
    }

    setSourcePlaybackInfo(null);
    dispatch(setPlayheadPosition(currentTime));
    lastExtractedTimeRef.current = currentTime;
    await extractAndRenderFrame(currentTime);
  }, [dispatch, playheadPosition, extractAndRenderFrame, playbackDirection, sourcePlaybackInfo]);

  // Toggle play/pause
  const handlePlayPause = useCallback(() => {
    if (isPlaying) {
      handlePause();
    } else {
      handlePlay();
    }
  }, [isPlaying, handlePlay, handlePause]);

  // Frame step with audio
  const handleFrameStep = useCallback(async (direction: -1 | 1) => {
    // Pause if playing
    if (isPlaying) {
      const video = videoRef.current;
      if (video) video.pause();
      setIsPlaying(false);
      setDisplayMode('canvas');
      setPlaybackDirection(0);
      dispatch(setPlayingPane(null));
    }

    // Use hybrid preview frame step (includes audio)
    // Pass fps from sequence settings so frame stepping uses the correct frame rate
    const frame = await previewActions.frameStep(direction, fps);

    if (frame && frame.success && frame.data) {
      renderFrame(frame);
      // Update Redux with new time
      if (frame.time !== undefined) {
        lastExtractedTimeRef.current = frame.time;
        dispatch(setPlayheadPosition(frame.time));
      }
    } else {
      // Fallback: manual step
      const frameDuration = 1 / fps;
      const newTime = Math.max(0, Math.min(timelineDuration, playheadPosition + direction * frameDuration));
      lastExtractedTimeRef.current = newTime;
      dispatch(setPlayheadPosition(newTime));
      await extractAndRenderFrame(newTime);
    }
  }, [isPlaying, previewActions, renderFrame, fps, timelineDuration, playheadPosition, dispatch, extractAndRenderFrame]);

  // Seek to position
  const handleSeek = useCallback(async (time: number) => {
    const clampedTime = Math.max(0, Math.min(timelineDuration, time));
    lastExtractedTimeRef.current = clampedTime;
    dispatch(setPlayheadPosition(clampedTime));

    if (isPlaying) {
      const video = videoRef.current;
      if (video) {
        video.currentTime = clampedTime;
      }
    } else {
      await extractAndRenderFrame(clampedTime);
    }
  }, [timelineDuration, isPlaying, dispatch, extractAndRenderFrame]);

  // Go to start
  const handleGoToStart = useCallback(() => {
    if (isPlaying) handlePause();
    handleSeek(0);
  }, [isPlaying, handlePause, handleSeek]);

  // Go to end
  const handleGoToEnd = useCallback(() => {
    if (isPlaying) handlePause();
    handleSeek(timelineDuration);
  }, [isPlaying, handlePause, handleSeek, timelineDuration]);

  // Scrub bar handlers
  const getTimeFromMouseX = useCallback((clientX: number): number => {
    const scrubBar = scrubBarRef.current;
    if (!scrubBar) return 0;

    const rect = scrubBar.getBoundingClientRect();
    const percent = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return percent * timelineDuration;
  }, [timelineDuration]);

  // Start scrubbing
  const handleScrubStart = useCallback(async (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();

    // Pause if playing
    if (isPlaying) {
      const video = videoRef.current;
      if (video) video.pause();
      setIsPlaying(false);
      dispatch(setPlayingPane(null));
    }

    setIsScrubbing(true);
    setDisplayMode('canvas');

    const time = getTimeFromMouseX(e.clientX);
    lastExtractedTimeRef.current = time;
    dispatch(setPlayheadPosition(time));

    // Start hybrid scrub (for audio)
    await previewActions.startScrub(time);

    // Initialize scrub velocity tracking
    scrubStateRef.current = {
      lastTime: performance.now(),
      lastPosition: time,
      isActive: true,
    };

    // Extract initial frame
    await extractAndRenderFrame(time);
  }, [isPlaying, getTimeFromMouseX, previewActions, dispatch, extractAndRenderFrame]);

  // Handle scrub mouse move
  useEffect(() => {
    if (!isScrubbing) return;

    const handleMouseMove = async (e: MouseEvent) => {
      const time = getTimeFromMouseX(e.clientX);
      lastExtractedTimeRef.current = time;
      dispatch(setPlayheadPosition(time));

      // Calculate velocity for scrub audio
      const now = performance.now();
      const deltaTime = (now - scrubStateRef.current.lastTime) / 1000;
      const deltaPosition = time - scrubStateRef.current.lastPosition;
      const velocity = deltaTime > 0 ? deltaPosition / deltaTime : 0;

      scrubStateRef.current.lastTime = now;
      scrubStateRef.current.lastPosition = time;

      // Update scrub (includes audio)
      const frame = await previewActions.updateScrub(time, velocity);
      if (frame && frame.success && frame.data) {
        renderFrame(frame);
      } else {
        // Fallback to regular frame extraction
        await extractAndRenderFrame(time);
      }
    };

    const handleMouseUp = async () => {
      setIsScrubbing(false);
      scrubStateRef.current.isActive = false;

      // End hybrid scrub
      await previewActions.endScrub();
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isScrubbing, getTimeFromMouseX, previewActions, renderFrame, dispatch, extractAndRenderFrame]);

  // Video timeupdate handler - sync to Redux during playback (preview video)
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleTimeUpdate = () => {
      // Only sync if we're playing from preview (not source)
      if (isPlaying && !sourcePlaybackInfo?.enabled) {
        dispatch(setPlayheadPosition(video.currentTime));
      }
    };

    const handleEnded = () => {
      if (!sourcePlaybackInfo?.enabled) {
        setIsPlaying(false);
        setDisplayMode('canvas');
        dispatch(setPlayingPane(null));
        dispatch(setPlayheadPosition(timelineDuration));
        lastExtractedTimeRef.current = timelineDuration;
        extractAndRenderFrame(timelineDuration);
      }
    };

    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('ended', handleEnded);

    return () => {
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('ended', handleEnded);
    };
  }, [isPlaying, timelineDuration, dispatch, extractAndRenderFrame, sourcePlaybackInfo?.enabled]);

  // Source video timeupdate handler - sync to Redux and detect clip boundaries
  useEffect(() => {
    const sourceVideo = sourceVideoRef.current;
    if (!sourceVideo || !sourcePlaybackInfo?.enabled) return;

    const handleTimeUpdate = () => {
      if (!isPlaying || !sourcePlaybackInfo) return;

      // Calculate timeline time from source video time
      const timelineTime = sourceVideo.currentTime - sourcePlaybackInfo.mediaOffset;
      dispatch(setPlayheadPosition(timelineTime));

      // Check if we've reached the end of the current clip
      if (timelineTime >= sourcePlaybackInfo.clipEnd - 0.05) {
        // Clip ended - check if there's another clip to play
        handleClipBoundary(sourcePlaybackInfo.clipEnd);
      }
    };

    const handleEnded = () => {
      // Source file ended - pause playback
      handlePause();
    };

    sourceVideo.addEventListener('timeupdate', handleTimeUpdate);
    sourceVideo.addEventListener('ended', handleEnded);

    return () => {
      sourceVideo.removeEventListener('timeupdate', handleTimeUpdate);
      sourceVideo.removeEventListener('ended', handleEnded);
    };
  }, [isPlaying, sourcePlaybackInfo, dispatch, handlePause]);

  // Handle transition between clips during source playback
  const handleClipBoundary = useCallback(async (boundaryTime: number) => {
    // Check what's at the next position
    const nextInfo = await previewActions.getPlaybackInfo(boundaryTime);
    const nextClip = await previewActions.getClipAtTime(boundaryTime);

    if (!nextInfo.isComplex && nextClip?.hasClip && nextClip.mediaPath) {
      // Another simple clip - switch to it
      const clip = tracks.flatMap(t => t.clips).find(c => {
        const clipStart = c.timelineStart;
        const clipEnd = c.timelineStart + c.duration;
        return boundaryTime >= clipStart && boundaryTime < clipEnd;
      });

      if (clip) {
        const sourceVideo = sourceVideoRef.current;
        if (sourceVideo) {
          setSourcePlaybackInfo({
            enabled: true,
            mediaPath: nextClip.mediaPath,
            clipStart: clip.timelineStart,
            clipEnd: clip.timelineStart + clip.duration,
            mediaOffset: clip.mediaIn - clip.timelineStart,
          });

          const srcUrl = `file:///${nextClip.mediaPath.replace(/\\/g, '/')}`;
          if (sourceVideo.src !== srcUrl) {
            sourceVideo.src = srcUrl;
            await new Promise<void>((resolve) => {
              sourceVideo.onloadedmetadata = () => resolve();
              sourceVideo.onerror = () => resolve();
            });
          }

          sourceVideo.currentTime = nextClip.mediaTime;
          sourceVideo.play();
          return;
        }
      }
    }

    // No more simple clips or hit a complex segment - pause
    handlePause();
  }, [previewActions, tracks, handlePause]);

  // Handle reverse playback using requestAnimationFrame (HTML5 video doesn't support negative playbackRate)
  // Use refs to avoid effect restarting when callbacks change
  const reverseTimeRef = useRef(playheadPosition);
  const extractFrameRef = useRef(extractAndRenderFrame);
  const prefetchFramesRef = useRef(previewActions.prefetchFrames);
  const startScrubRef = useRef(previewActions.startScrub);
  const updateScrubRef = useRef(previewActions.updateScrub);
  const endScrubRef = useRef(previewActions.endScrub);

  useEffect(() => {
    reverseTimeRef.current = playheadPosition;
  }, [playheadPosition]);

  useEffect(() => {
    extractFrameRef.current = extractAndRenderFrame;
  }, [extractAndRenderFrame]);

  useEffect(() => {
    prefetchFramesRef.current = previewActions.prefetchFrames;
  }, [previewActions.prefetchFrames]);

  useEffect(() => {
    startScrubRef.current = previewActions.startScrub;
    updateScrubRef.current = previewActions.updateScrub;
    endScrubRef.current = previewActions.endScrub;
  }, [previewActions.startScrub, previewActions.updateScrub, previewActions.endScrub]);

  useEffect(() => {
    if (playbackDirection !== -1) return;

    let animationId: number;
    let lastTime = performance.now();
    let lastPrefetchTime = 0;
    let lastAudioUpdateTime = 0;
    let cancelled = false;

    // Start scrub audio for reverse playback
    startScrubRef.current(reverseTimeRef.current);

    const updateReverse = async (now: number) => {
      if (cancelled) return;

      const delta = (now - lastTime) / 1000;
      lastTime = now;

      const newTime = reverseTimeRef.current - delta * playbackSpeed;

      if (newTime <= 0) {
        reverseTimeRef.current = 0;
        dispatch(setPlayheadPosition(0));
        lastExtractedTimeRef.current = 0;
        setPlaybackDirection(0);
        setIsPlaying(false);
        setDisplayMode('canvas');
        dispatch(setPlayingPane(null));
        endScrubRef.current();
        await extractFrameRef.current(0);
        return;
      }

      reverseTimeRef.current = newTime;
      dispatch(setPlayheadPosition(newTime));
      lastExtractedTimeRef.current = newTime;

      // Prefetch frames ahead (in reverse direction) every 100ms
      if (now - lastPrefetchTime > 100) {
        lastPrefetchTime = now;
        prefetchFramesRef.current(newTime, 5, -1);
      }

      // Update scrub audio with negative velocity every 50ms
      if (now - lastAudioUpdateTime > 50) {
        lastAudioUpdateTime = now;
        // Velocity is negative for reverse playback (time units per second)
        updateScrubRef.current(newTime, -playbackSpeed);
      }

      await extractFrameRef.current(newTime);

      if (!cancelled) {
        animationId = requestAnimationFrame(updateReverse);
      }
    };

    // Initial prefetch
    prefetchFramesRef.current(reverseTimeRef.current, 10, -1);

    animationId = requestAnimationFrame(updateReverse);

    return () => {
      cancelled = true;
      endScrubRef.current();
      if (animationId) {
        cancelAnimationFrame(animationId);
      }
    };
  }, [playbackDirection, playbackSpeed, dispatch]);

  // Keyboard shortcuts
  useEffect(() => {
    if (!shouldHandleKeyboard) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle if typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      const video = videoRef.current;

      switch (e.key.toLowerCase()) {
        case 'k':
        case ' ':
          e.preventDefault();
          if (playbackDirection === 0) {
            handlePlay(1);
          } else {
            handlePause();
          }
          break;

        case 'j':
          e.preventDefault();
          if (playbackDirection === 1) {
            // Was playing forward, switch to backward at first speed
            if (video) video.pause();
            setPlaybackSpeed(PLAYBACK_SPEEDS[0]);
            setPlaybackDirection(-1);
            setDisplayMode('canvas');
            setIsPlaying(true);
            dispatch(setPlayingPane('program'));
          } else if (playbackDirection === -1) {
            // Already playing backward, increase speed
            const currentIndex = PLAYBACK_SPEEDS.indexOf(playbackSpeed);
            const nextIndex = Math.min(currentIndex + 1, PLAYBACK_SPEEDS.length - 1);
            setPlaybackSpeed(PLAYBACK_SPEEDS[nextIndex]);
          } else {
            // Was paused, start backward at first speed
            setPlaybackSpeed(PLAYBACK_SPEEDS[0]);
            setPlaybackDirection(-1);
            setDisplayMode('canvas');
            setIsPlaying(true);
            dispatch(setPlayingPane('program'));
          }
          break;

        case 'l':
          e.preventDefault();
          if (playbackDirection === -1) {
            // Was playing backward, switch to forward at first speed
            setPlaybackDirection(1);
            setPlaybackSpeed(PLAYBACK_SPEEDS[0]);
            setDisplayMode('video');
            if (video) {
              video.playbackRate = PLAYBACK_SPEEDS[0];
              video.currentTime = playheadPosition;
              video.play();
            }
          } else if (playbackDirection === 1) {
            // Already playing forward, increase speed
            const currentIndex = PLAYBACK_SPEEDS.indexOf(playbackSpeed);
            const nextIndex = Math.min(currentIndex + 1, PLAYBACK_SPEEDS.length - 1);
            setPlaybackSpeed(PLAYBACK_SPEEDS[nextIndex]);
            if (video) {
              video.playbackRate = PLAYBACK_SPEEDS[nextIndex];
            }
          } else {
            // Was paused, start forward at first speed - use progressive playback
            handlePlay(PLAYBACK_SPEEDS[0]);
          }
          break;

        case 'arrowleft':
          e.preventDefault();
          handleFrameStep(-1);
          break;

        case 'arrowright':
          e.preventDefault();
          handleFrameStep(1);
          break;

        case 'home':
          e.preventDefault();
          handleGoToStart();
          break;

        case 'end':
          e.preventDefault();
          handleGoToEnd();
          break;

        case 'm':
          if (!e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            setIsMuted(!isMuted);
            if (videoRef.current) {
              videoRef.current.muted = !isMuted;
            }
            if (sourceVideoRef.current) {
              sourceVideoRef.current.muted = !isMuted;
            }
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [shouldHandleKeyboard, handlePlayPause, handleFrameStep, handleGoToStart, handleGoToEnd, handlePlay, handlePause, isPlaying, isMuted, playbackDirection, playbackSpeed, playheadPosition, previewReady, dispatch, timelineDuration]);

  // Set active pane when clicked
  const handlePaneClick = useCallback(() => {
    if (!isActive) {
      dispatch(setActivePane('program'));
    }
  }, [dispatch, isActive]);

  // Toggle mute
  const toggleMute = useCallback(() => {
    const video = videoRef.current;
    const sourceVideo = sourceVideoRef.current;
    if (video) {
      video.muted = !isMuted;
    }
    if (sourceVideo) {
      sourceVideo.muted = !isMuted;
    }
    setIsMuted(!isMuted);
  }, [isMuted]);

  // Handle timecode input change
  const handleTimecodeChange = useCallback((newTime: number) => {
    if (isPlaying) {
      handlePause();
    }
    handleSeek(newTime);
  }, [isPlaying, handlePause, handleSeek]);

  // Cancel loading dialog
  const handleCancelLoading = useCallback(() => {
    setShowLoadingDialog(false);
  }, []);

  // Auto-start playback when preview becomes ready (if loading dialog is showing)
  useEffect(() => {
    if (showLoadingDialog && previewReady) {
      setShowLoadingDialog(false);
      handlePlay();
    }
  }, [showLoadingDialog, previewReady, handlePlay]);

  // Calculate playhead percentage for scrub bar (clamped to prevent overflow)
  const playheadPercent = timelineDuration > 0
    ? Math.min(100, Math.max(0, (playheadPosition / timelineDuration) * 100))
    : 0;

  // Preview video source
  const previewSrc = preview.filePath
    ? `file:///${preview.filePath.replace(/\\/g, '/')}`
    : '';

  return (
    <div className="program-monitor" onClick={handlePaneClick}>
      <div className="program-video-container" ref={containerRef}>
        {/* Preview video element - for pre-rendered preview playback */}
        {previewSrc && (
          <video
            key={previewSrc}
            ref={videoRef}
            src={previewSrc}
            className="program-preview-video"
            muted={isMuted}
            style={{
              width: displaySize.width,
              height: displaySize.height,
              backgroundColor,
              display: displayMode === 'video' && !sourcePlaybackInfo?.enabled ? 'block' : 'none',
            }}
          />
        )}

        {/* Source video element - for direct source file playback (progressive) */}
        <video
          ref={sourceVideoRef}
          className="program-preview-video"
          muted={isMuted}
          style={{
            width: displaySize.width,
            height: displaySize.height,
            backgroundColor,
            display: displayMode === 'video' && sourcePlaybackInfo?.enabled ? 'block' : 'none',
          }}
        />

        {/* Canvas - for pause/scrub display (full quality from source) */}
        <canvas
          ref={canvasRef}
          width={fullWidth}
          height={fullHeight}
          className="program-preview-canvas"
          style={{
            width: displaySize.width,
            height: displaySize.height,
            backgroundColor,
            display: displayMode === 'canvas' ? 'block' : 'none',
          }}
        />

        {/* Loading dialog overlay - blocks playback when preview not ready */}
        {showLoadingDialog && (
          <div className="program-loading-overlay">
            <div className="program-loading-dialog">
              <Loader className="loading-spinner" size={32} />
              <p>Rendering preview...</p>
              <div className="loading-progress-bar">
                <div
                  className="loading-progress-fill"
                  style={{ width: `${renderProgress}%` }}
                />
              </div>
              <p className="loading-progress-text">{renderProgress.toFixed(1)}% complete</p>
              <button onClick={handleCancelLoading} className="loading-cancel-btn">
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Frame extraction indicator */}
        {previewState.isExtracting && displayMode === 'canvas' && (
          <div className="program-extracting-indicator">
            <Loader className="extracting-spinner" size={16} />
          </div>
        )}

        {/* Indicator when preview not ready (not blocking) */}
        {!previewReady && !showLoadingDialog && (
          <div className="program-preview-not-ready">
            <p>Preview {preview.status === 'rendering' ? 'rendering' : 'not ready'}</p>
            {previewRendering && (
              <p className="render-progress">{renderProgress.toFixed(1)}%</p>
            )}
          </div>
        )}
      </div>

      {/* Timecode display */}
      <div className="program-info-bar">
        <TimecodeInput
          value={playheadPosition}
          fps={fps}
          onChange={handleTimecodeChange}
          max={timelineDuration}
          className="program-timecode"
        />
        <span className="program-duration">{formatTimecode(timelineDuration)}</span>
      </div>

      {/* Scrub bar */}
      <div className="program-scrub-container">
        <div
          ref={scrubBarRef}
          className={`program-scrub-bar ${isScrubbing ? 'scrubbing' : ''}`}
          onMouseDown={handleScrubStart}
        >
          <div className="program-playhead" style={{ left: `${playheadPercent}%` }} />
        </div>
      </div>

      {/* Transport controls */}
      <div className="program-transport">
        <div className="transport-left">
          <button onClick={toggleMute} title="Mute (M)">
            {isMuted ? <VolumeX size={14} /> : <Volume2 size={14} />}
          </button>
        </div>

        <div className="transport-center">
          <button onClick={handleGoToStart} title="Go to Start (Home)">
            <ChevronsLeft size={16} />
          </button>
          <button onClick={() => handleFrameStep(-1)} title="Step Back (Left Arrow)">
            <SkipBack size={16} />
          </button>
          <button onClick={handlePlayPause} className="play-button" title="Play/Pause (Space)">
            {isPlaying ? <Pause size={20} /> : <Play size={20} />}
          </button>
          <button onClick={() => handleFrameStep(1)} title="Step Forward (Right Arrow)">
            <SkipForward size={16} />
          </button>
          <button onClick={handleGoToEnd} title="Go to End (End)">
            <ChevronsRight size={16} />
          </button>
        </div>

        <div className="transport-right">
          {previewRendering && (
            <span className="render-status" title="Background rendering in progress">
              {renderProgress.toFixed(1)}%
            </span>
          )}
          <span className="preview-quality-label">Quality:</span>
          <select
            className="preview-quality-select"
            value={previewQuality}
            onChange={(e) => dispatch(updateSettings({ previewQuality: parseFloat(e.target.value) }))}
            title="Preview Quality"
          >
            {PREVIEW_QUALITY_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
};

export default ProgramMonitor;
