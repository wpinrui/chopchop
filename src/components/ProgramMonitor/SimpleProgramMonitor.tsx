/**
 * Simple Program Monitor
 *
 * A simplified program monitor that plays a single pre-rendered preview file.
 * No complex chunk transitions, no canvas mode, no frame extraction.
 *
 * Features:
 * - Single video element for playback
 * - Native seek/pause/play
 * - Renders preview when user clicks play (if not already rendered)
 * - Shows progress while rendering
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
import TimecodeInput from '../TimecodeInput/TimecodeInput';
import './ProgramMonitor.css';

// Playback speeds for J/L shuttle control
const PLAYBACK_SPEEDS = [0.5, 1, 2, 4];

interface PreviewState {
  isInitialized: boolean;
  isRendering: boolean;
  progress: number;
  fullPreviewPath: string | null;
  fullPreviewReady: boolean;
}

const SimpleProgramMonitor: React.FC = () => {
  const dispatch = useDispatch();

  // Refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrubBarRef = useRef<HTMLDivElement>(null);

  // Container size for calculating display dimensions
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });

  // Redux state
  const tracks = useSelector((state: RootState) => state.timeline.tracks);
  const playheadPosition = useSelector((state: RootState) => state.timeline.playheadPosition);
  const media = useSelector((state: RootState) => state.project.media);
  const settings = useSelector((state: RootState) => state.project.settings);
  const projectPath = useSelector((state: RootState) => state.project.path);
  const fps = settings.frameRate;
  const activePane = useSelector((state: RootState) => state.ui.activePane);
  const playingPane = useSelector((state: RootState) => state.ui.playingPane);

  // Sequence settings
  const sequenceResolution = settings.resolution;
  const backgroundColor = settings.backgroundColor;

  const [seqWidth, seqHeight] = sequenceResolution;

  const isActive = activePane === 'program';
  const shouldHandleKeyboard = playingPane === 'program' ||
    (playingPane === null && (isActive || activePane === 'timeline'));

  // Local state
  const [isMuted, setIsMuted] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);

  // Preview state from main process
  const [previewState, setPreviewState] = useState<PreviewState>({
    isInitialized: false,
    isRendering: false,
    progress: 0,
    fullPreviewPath: null,
    fullPreviewReady: false,
  });

  // Calculate timeline duration
  const timelineDuration = Math.max(
    ...tracks.flatMap(track =>
      track.clips.map(clip => clip.timelineStart + clip.duration)
    ),
    1
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

  // Calculate video display size to fill container while maintaining aspect ratio
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

  // Listen for preview state updates from main process
  useEffect(() => {
    if (!window.electronAPI) return;

    const cleanup1 = window.electronAPI.simplePreview.onStateUpdate((state: PreviewState) => {
      setPreviewState(state);

      // If preview just became ready and we were waiting, load it
      if (state.fullPreviewReady && state.fullPreviewPath) {
        const video = videoRef.current;
        if (video) {
          const videoUrl = `file:///${state.fullPreviewPath.replace(/\\/g, '/')}`;
          if (video.src !== videoUrl) {
            video.src = videoUrl;
          }
        }
      }
    });

    const cleanup2 = window.electronAPI.simplePreview.onProgress((data: { progress: number; isRendering: boolean }) => {
      setPreviewState(prev => ({
        ...prev,
        progress: data.progress,
        isRendering: data.isRendering,
      }));
    });

    return () => {
      cleanup1();
      cleanup2();
    };
  }, []);

  // Initialize preview engine with timeline data
  useEffect(() => {
    if (!window.electronAPI || timelineDuration <= 0) return;

    // Call preview:init with full timeline data to initialize the engine
    window.electronAPI.preview.init({
      timeline: { tracks },
      media: media.map(m => ({
        id: m.id,
        name: m.name,
        path: m.path,
        proxyPath: m.proxyPath,
        type: m.type,
        duration: m.duration,
        metadata: m.metadata,
      })),
      settings: {
        resolution: settings.resolution,
        frameRate: settings.frameRate,
        backgroundColor: settings.backgroundColor,
        proxyEnabled: settings.proxyEnabled,
        previewBitrate: settings.previewBitrate,
      },
      duration: timelineDuration,
      projectPath,
    });
  }, [timelineDuration, tracks, media, settings, projectPath]);

  // Play handler
  const handlePlay = useCallback(async () => {
    if (!window.electronAPI) return;

    const video = videoRef.current;
    if (!video) return;

    // If preview is ready, just play
    if (previewState.fullPreviewReady && previewState.fullPreviewPath) {
      const videoUrl = `file:///${previewState.fullPreviewPath.replace(/\\/g, '/')}`;
      if (video.src !== videoUrl) {
        video.src = videoUrl;
        await new Promise<void>(resolve => {
          video.onloadedmetadata = () => resolve();
          video.onerror = () => resolve();
        });
      }

      // Wrap around if at end
      if (playheadPosition >= timelineDuration) {
        video.currentTime = 0;
      } else {
        video.currentTime = playheadPosition;
      }

      video.playbackRate = playbackSpeed;
      video.muted = isMuted;
      video.play();
      setIsPlaying(true);
      dispatch(setPlayingPane('program'));
      return;
    }

    // Preview not ready - start rendering
    await window.electronAPI.simplePreview.renderFullPreview();
  }, [previewState, playheadPosition, timelineDuration, playbackSpeed, isMuted, dispatch]);

  // Pause handler
  const handlePause = useCallback(() => {
    const video = videoRef.current;
    if (video) {
      video.pause();
      dispatch(setPlayheadPosition(video.currentTime));
    }
    setIsPlaying(false);
    dispatch(setPlayingPane(null));
  }, [dispatch]);

  // Toggle play/pause
  const handlePlayPause = useCallback(() => {
    if (isPlaying) {
      handlePause();
    } else {
      handlePlay();
    }
  }, [isPlaying, handlePlay, handlePause]);

  // Frame step
  const handleFrameStep = useCallback((direction: -1 | 1) => {
    if (isPlaying) {
      handlePause();
    }

    const video = videoRef.current;
    if (!video) return;

    const frameDuration = 1 / fps;
    const newTime = Math.max(0, Math.min(timelineDuration, video.currentTime + direction * frameDuration));
    video.currentTime = newTime;
    dispatch(setPlayheadPosition(newTime));
  }, [isPlaying, handlePause, fps, timelineDuration, dispatch]);

  // Seek to position
  const handleSeek = useCallback((time: number) => {
    const clampedTime = Math.max(0, Math.min(timelineDuration, time));
    dispatch(setPlayheadPosition(clampedTime));

    const video = videoRef.current;
    if (video && video.src) {
      video.currentTime = clampedTime;
    }
  }, [timelineDuration, dispatch]);

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
  const handleScrubStart = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (isPlaying) handlePause();
    setIsScrubbing(true);

    const time = getTimeFromMouseX(e.clientX);
    handleSeek(time);
  }, [isPlaying, handlePause, getTimeFromMouseX, handleSeek]);

  // Handle scrub mouse move
  useEffect(() => {
    if (!isScrubbing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const time = getTimeFromMouseX(e.clientX);
      handleSeek(time);
    };

    const handleMouseUp = () => {
      setIsScrubbing(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isScrubbing, getTimeFromMouseX, handleSeek]);

  // Video timeupdate handler
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleTimeUpdate = () => {
      if (isPlaying && !isScrubbing) {
        dispatch(setPlayheadPosition(video.currentTime));
      }
    };

    const handleEnded = () => {
      setIsPlaying(false);
      dispatch(setPlayingPane(null));
      dispatch(setPlayheadPosition(timelineDuration));
    };

    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('ended', handleEnded);

    return () => {
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('ended', handleEnded);
    };
  }, [isPlaying, isScrubbing, timelineDuration, dispatch]);

  // Keyboard shortcuts
  useEffect(() => {
    if (!shouldHandleKeyboard) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      const video = videoRef.current;

      switch (e.key.toLowerCase()) {
        case 'k':
        case ' ':
          e.preventDefault();
          handlePlayPause();
          break;

        case 'j':
          e.preventDefault();
          // Decrease speed or play reverse (just slow down for now)
          if (isPlaying && video) {
            const currentIndex = PLAYBACK_SPEEDS.indexOf(playbackSpeed);
            if (currentIndex > 0) {
              const newSpeed = PLAYBACK_SPEEDS[currentIndex - 1];
              setPlaybackSpeed(newSpeed);
              video.playbackRate = newSpeed;
            }
          }
          break;

        case 'l':
          e.preventDefault();
          if (!isPlaying) {
            handlePlay();
          } else if (video) {
            const currentIndex = PLAYBACK_SPEEDS.indexOf(playbackSpeed);
            const nextIndex = Math.min(currentIndex + 1, PLAYBACK_SPEEDS.length - 1);
            const newSpeed = PLAYBACK_SPEEDS[nextIndex];
            setPlaybackSpeed(newSpeed);
            video.playbackRate = newSpeed;
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
            if (video) video.muted = !isMuted;
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [shouldHandleKeyboard, handlePlayPause, handleFrameStep, handleGoToStart, handleGoToEnd, handlePlay, isPlaying, isMuted, playbackSpeed]);

  // Set active pane when clicked
  const handlePaneClick = useCallback(() => {
    if (!isActive) {
      dispatch(setActivePane('program'));
    }
  }, [dispatch, isActive]);

  // Toggle mute
  const toggleMute = useCallback(() => {
    const video = videoRef.current;
    if (video) video.muted = !isMuted;
    setIsMuted(!isMuted);
  }, [isMuted]);

  // Handle timecode input change
  const handleTimecodeChange = useCallback((newTime: number) => {
    if (isPlaying) handlePause();
    handleSeek(newTime);
  }, [isPlaying, handlePause, handleSeek]);

  // Calculate playhead percentage for scrub bar
  const playheadPercent = timelineDuration > 0
    ? Math.min(100, Math.max(0, (playheadPosition / timelineDuration) * 100))
    : 0;

  const showRenderingOverlay = previewState.isRendering || (!previewState.fullPreviewReady && isPlaying);

  return (
    <div className="program-monitor" onClick={handlePaneClick}>
      <div className="program-video-container" ref={containerRef}>
        {/* Video element */}
        <video
          ref={videoRef}
          className="program-preview-video"
          muted={isMuted}
          style={{
            width: displaySize.width,
            height: displaySize.height,
            backgroundColor,
            display: 'block',
          }}
        />

        {/* Rendering overlay */}
        {showRenderingOverlay && (
          <div className="program-loading-overlay">
            <div className="program-loading-dialog">
              <Loader className="loading-spinner" size={32} />
              <p>Rendering preview...</p>
              <div className="loading-progress-bar">
                <div
                  className="loading-progress-fill"
                  style={{ width: `${previewState.progress}%` }}
                />
              </div>
              <p className="loading-progress-text">{previewState.progress.toFixed(1)}% complete</p>
            </div>
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
          {previewState.isRendering && (
            <span className="render-status" title="Rendering preview">
              {previewState.progress.toFixed(1)}%
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

export default SimpleProgramMonitor;
