/**
 * Program Monitor Component
 *
 * Displays timeline preview at current playhead position.
 * For simple cases (single clip), uses native video element.
 * Future: FFmpeg-based compositing for complex timelines.
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
} from 'lucide-react';
import type { RootState } from '../../store';
import { setPlayheadPosition } from '../../store/timelineSlice';
import { setActivePane, setPlayingPane } from '../../store/uiSlice';
import type { Track, Clip, MediaItem } from '@types';
import './ProgramMonitor.css';

// Playback speeds for J/L shuttle control
const PLAYBACK_SPEEDS = [0.5, 1, 2, 4];

interface ClipAtPlayhead {
  clip: Clip;
  track: Track;
  media: MediaItem;
  // The time within the source media file to display
  mediaTime: number;
}

const ProgramMonitor: React.FC = () => {
  const dispatch = useDispatch();
  const videoRef = useRef<HTMLVideoElement>(null);

  // Get timeline state from Redux
  const tracks = useSelector((state: RootState) => state.timeline.tracks);
  const playheadPosition = useSelector((state: RootState) => state.timeline.playheadPosition);
  const media = useSelector((state: RootState) => state.project.media);
  const fps = useSelector((state: RootState) => state.project.settings.frameRate);
  const activePane = useSelector((state: RootState) => state.ui.activePane);
  const playingPane = useSelector((state: RootState) => state.ui.playingPane);

  const isActive = activePane === 'program';
  // Program monitor handles playback shortcuts when:
  // 1. It's currently playing, OR
  // 2. No player is playing AND (program is active OR timeline is active)
  // This allows JKL/space to control program monitor while editing on timeline
  const shouldHandleKeyboard = playingPane === 'program' ||
    (playingPane === null && (isActive || activePane === 'timeline'));

  // Local state
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [playbackDirection, setPlaybackDirection] = useState<-1 | 0 | 1>(0);
  const [videoError, setVideoError] = useState<string | null>(null);

  // Track which clip we're currently showing to avoid re-seeking unnecessarily
  const currentClipRef = useRef<string | null>(null);
  const seekingRef = useRef(false);

  // Calculate timeline duration
  const timelineDuration = Math.max(
    ...tracks.flatMap(track =>
      track.clips.map(clip => clip.timelineStart + clip.duration)
    ),
    1 // Minimum 1 second
  );

  // Find the topmost video clip at the current playhead position
  const findClipAtPlayhead = useCallback((): ClipAtPlayhead | null => {
    // Go through video tracks from top to bottom (reverse order since first track is topmost)
    const videoTracks = tracks.filter(t => t.type === 'video');

    for (const track of videoTracks) {
      for (const clip of track.clips) {
        if (!clip.enabled) continue;

        const clipStart = clip.timelineStart;
        const clipEnd = clip.timelineStart + clip.duration;

        if (playheadPosition >= clipStart && playheadPosition < clipEnd) {
          // Find the media item for this clip
          const mediaItem = media.find(m => m.id === clip.mediaId);
          if (!mediaItem) continue;

          // Calculate the time within the source media
          const timeInClip = playheadPosition - clipStart;
          const mediaTime = clip.mediaIn + timeInClip;

          return { clip, track, media: mediaItem, mediaTime };
        }
      }
    }

    return null;
  }, [tracks, playheadPosition, media]);

  const clipAtPlayhead = findClipAtPlayhead();

  // Format timecode as HH:MM:SS:FF
  const formatTimecode = useCallback((seconds: number): string => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const frames = Math.floor((seconds % 1) * fps);

    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}:${frames.toString().padStart(2, '0')}`;
  }, [fps]);

  // Sync video element with playhead position when not playing
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !clipAtPlayhead || isPlaying || seekingRef.current) return;

    // Only seek if we're showing a different position
    const targetTime = clipAtPlayhead.mediaTime;
    const timeDiff = Math.abs(video.currentTime - targetTime);

    // If we're on a different clip or time is significantly different, seek
    if (currentClipRef.current !== clipAtPlayhead.clip.id || timeDiff > 0.1) {
      currentClipRef.current = clipAtPlayhead.clip.id;
      seekingRef.current = true;
      video.currentTime = targetTime;
    }
  }, [clipAtPlayhead, isPlaying]);

  // Handle video events
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleTimeUpdate = () => {
      if (!isPlaying || !clipAtPlayhead) return;

      // Update timeline playhead based on video time
      const timeInClip = video.currentTime - clipAtPlayhead.clip.mediaIn;
      const newPlayheadPosition = clipAtPlayhead.clip.timelineStart + timeInClip;

      // Check if we've reached the end of the clip
      if (video.currentTime >= clipAtPlayhead.clip.mediaOut) {
        // Stop at end of clip (future: advance to next clip)
        video.pause();
        setIsPlaying(false);
        setPlaybackDirection(0);
        return;
      }

      dispatch(setPlayheadPosition(newPlayheadPosition));
    };

    const handleSeeked = () => {
      seekingRef.current = false;
    };

    const handleEnded = () => {
      setIsPlaying(false);
      setPlaybackDirection(0);
    };

    const handleError = () => {
      const error = video.error;
      let errorMsg = 'Unknown error';
      if (error) {
        switch (error.code) {
          case MediaError.MEDIA_ERR_ABORTED:
            errorMsg = 'Playback aborted';
            break;
          case MediaError.MEDIA_ERR_NETWORK:
            errorMsg = 'Network error';
            break;
          case MediaError.MEDIA_ERR_DECODE:
            errorMsg = 'Decoding error - format may not be supported';
            break;
          case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
            errorMsg = 'Format not supported by browser';
            break;
        }
      }
      console.error('Video error:', errorMsg, error);
      setVideoError(errorMsg);
    };

    const handleLoadedMetadata = () => {
      setVideoError(null);
      // Seek to current position
      if (clipAtPlayhead) {
        video.currentTime = clipAtPlayhead.mediaTime;
      }
    };

    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('seeked', handleSeeked);
    video.addEventListener('ended', handleEnded);
    video.addEventListener('error', handleError);
    video.addEventListener('loadedmetadata', handleLoadedMetadata);

    return () => {
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('seeked', handleSeeked);
      video.removeEventListener('ended', handleEnded);
      video.removeEventListener('error', handleError);
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
    };
  }, [clipAtPlayhead, isPlaying, dispatch]);

  // Handle play state changes
  useEffect(() => {
    if (isPlaying) {
      dispatch(setPlayingPane('program'));
    } else if (playingPane === 'program') {
      dispatch(setPlayingPane(null));
    }
  }, [isPlaying, dispatch, playingPane]);

  // Handle reverse playback using requestAnimationFrame
  useEffect(() => {
    const video = videoRef.current;
    if (!video || playbackDirection !== -1 || !clipAtPlayhead) return;

    let animationId: number;
    let lastTime = performance.now();

    const updateReverse = (now: number) => {
      const delta = (now - lastTime) / 1000;
      lastTime = now;

      const newMediaTime = video.currentTime - delta * playbackSpeed;

      // Check if we've reached the start of the clip
      if (newMediaTime <= clipAtPlayhead.clip.mediaIn) {
        video.currentTime = clipAtPlayhead.clip.mediaIn;
        const newPlayhead = clipAtPlayhead.clip.timelineStart;
        dispatch(setPlayheadPosition(newPlayhead));
        setPlaybackDirection(0);
        setIsPlaying(false);
        return;
      }

      video.currentTime = newMediaTime;
      const timeInClip = newMediaTime - clipAtPlayhead.clip.mediaIn;
      dispatch(setPlayheadPosition(clipAtPlayhead.clip.timelineStart + timeInClip));
      animationId = requestAnimationFrame(updateReverse);
    };

    animationId = requestAnimationFrame(updateReverse);

    return () => {
      if (animationId) {
        cancelAnimationFrame(animationId);
      }
    };
  }, [playbackDirection, playbackSpeed, clipAtPlayhead, dispatch]);

  // Keyboard shortcuts
  useEffect(() => {
    if (!shouldHandleKeyboard) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const video = videoRef.current;
      if (!video || !clipAtPlayhead) return;

      // Don't handle if typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      switch (e.key.toLowerCase()) {
        case 'k':
        case ' ':
          e.preventDefault();
          if (playbackDirection === 0) {
            video.playbackRate = 1;
            setPlaybackSpeed(1);
            setPlaybackDirection(1);
            video.play();
            setIsPlaying(true);
          } else {
            video.pause();
            setIsPlaying(false);
            setPlaybackDirection(0);
          }
          break;

        case 'j':
          e.preventDefault();
          if (playbackDirection === 1) {
            video.pause();
            setPlaybackSpeed(PLAYBACK_SPEEDS[0]);
            setPlaybackDirection(-1);
            setIsPlaying(true);
          } else if (playbackDirection === -1) {
            const currentIndex = PLAYBACK_SPEEDS.indexOf(playbackSpeed);
            const nextIndex = Math.min(currentIndex + 1, PLAYBACK_SPEEDS.length - 1);
            setPlaybackSpeed(PLAYBACK_SPEEDS[nextIndex]);
          } else {
            setPlaybackSpeed(PLAYBACK_SPEEDS[0]);
            setPlaybackDirection(-1);
            setIsPlaying(true);
          }
          break;

        case 'l':
          e.preventDefault();
          if (playbackDirection === -1) {
            setPlaybackDirection(1);
            setPlaybackSpeed(PLAYBACK_SPEEDS[0]);
            video.playbackRate = PLAYBACK_SPEEDS[0];
            video.play();
            setIsPlaying(true);
          } else if (playbackDirection === 1) {
            const currentIndex = PLAYBACK_SPEEDS.indexOf(playbackSpeed);
            const nextIndex = Math.min(currentIndex + 1, PLAYBACK_SPEEDS.length - 1);
            setPlaybackSpeed(PLAYBACK_SPEEDS[nextIndex]);
            video.playbackRate = PLAYBACK_SPEEDS[nextIndex];
          } else {
            setPlaybackSpeed(PLAYBACK_SPEEDS[0]);
            setPlaybackDirection(1);
            video.playbackRate = PLAYBACK_SPEEDS[0];
            video.play();
            setIsPlaying(true);
          }
          break;

        case 'arrowleft':
          e.preventDefault();
          video.pause();
          setIsPlaying(false);
          setPlaybackDirection(0);
          {
            const frameDuration = 1 / fps;
            const newPlayhead = Math.max(0, playheadPosition - frameDuration);
            dispatch(setPlayheadPosition(newPlayhead));
          }
          break;

        case 'arrowright':
          e.preventDefault();
          video.pause();
          setIsPlaying(false);
          setPlaybackDirection(0);
          {
            const frameDuration = 1 / fps;
            const newPlayhead = Math.min(timelineDuration, playheadPosition + frameDuration);
            dispatch(setPlayheadPosition(newPlayhead));
          }
          break;

        case 'home':
          e.preventDefault();
          video.pause();
          setIsPlaying(false);
          setPlaybackDirection(0);
          dispatch(setPlayheadPosition(0));
          break;

        case 'end':
          e.preventDefault();
          video.pause();
          setIsPlaying(false);
          setPlaybackDirection(0);
          dispatch(setPlayheadPosition(timelineDuration));
          break;

        case 'm':
          // Mute toggle (only if not Ctrl+M for export)
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
  }, [shouldHandleKeyboard, clipAtPlayhead, playbackDirection, playbackSpeed, fps, playheadPosition, timelineDuration, isMuted, dispatch]);

  // Set active pane when clicked
  const handlePaneClick = useCallback(() => {
    if (!isActive) {
      dispatch(setActivePane('program'));
    }
  }, [dispatch, isActive]);

  // Play/Pause toggle
  const handlePlayPause = useCallback(() => {
    const video = videoRef.current;
    if (!video || !clipAtPlayhead) return;

    if (isPlaying) {
      video.pause();
      setIsPlaying(false);
      setPlaybackDirection(0);
    } else {
      video.playbackRate = 1;
      setPlaybackSpeed(1);
      setPlaybackDirection(1);
      video.play();
      setIsPlaying(true);
    }
  }, [isPlaying, clipAtPlayhead]);

  // Step frame forward/back
  const stepFrame = useCallback((direction: 1 | -1) => {
    const video = videoRef.current;
    if (!video) return;

    video.pause();
    setIsPlaying(false);
    setPlaybackDirection(0);

    const frameDuration = 1 / fps;
    const newPlayhead = Math.max(0, Math.min(timelineDuration, playheadPosition + direction * frameDuration));
    dispatch(setPlayheadPosition(newPlayhead));
  }, [fps, playheadPosition, timelineDuration, dispatch]);

  // Go to start/end
  const goToStart = useCallback(() => {
    dispatch(setPlayheadPosition(0));
    setIsPlaying(false);
    setPlaybackDirection(0);
  }, [dispatch]);

  const goToEnd = useCallback(() => {
    dispatch(setPlayheadPosition(timelineDuration));
    setIsPlaying(false);
    setPlaybackDirection(0);
  }, [dispatch, timelineDuration]);

  // Toggle mute
  const toggleMute = useCallback(() => {
    const video = videoRef.current;
    if (video) {
      video.muted = !isMuted;
    }
    setIsMuted(!isMuted);
  }, [isMuted]);

  // Calculate playhead percentage for scrub bar
  const playheadPercent = timelineDuration > 0 ? (playheadPosition / timelineDuration) * 100 : 0;

  // Scrub bar click handler
  const handleScrubClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const percent = (e.clientX - rect.left) / rect.width;
    const newPosition = percent * timelineDuration;

    // Pause if playing
    if (isPlaying) {
      videoRef.current?.pause();
      setIsPlaying(false);
      setPlaybackDirection(0);
    }

    dispatch(setPlayheadPosition(newPosition));
  }, [timelineDuration, isPlaying, dispatch]);

  // Convert file path to file:// URL
  const mediaSrc = clipAtPlayhead?.media.path
    ? `file:///${clipAtPlayhead.media.path.replace(/\\/g, '/')}`
    : '';

  // Empty state
  if (!clipAtPlayhead) {
    return (
      <div className="program-monitor" onClick={handlePaneClick}>
        <div className="program-empty">
          <p>No clip at playhead</p>
          <p className="hint">Add clips to the timeline and position the playhead over them</p>
        </div>

        {/* Still show transport controls */}
        <div className="program-info-bar">
          <span className="program-timecode">{formatTimecode(playheadPosition)}</span>
          <span className="program-name">Program</span>
          <span className="program-duration">{formatTimecode(timelineDuration)}</span>
        </div>

        <div className="program-scrub-container">
          <div className="program-scrub-bar" onClick={handleScrubClick}>
            <div className="program-playhead" style={{ left: `${playheadPercent}%` }} />
          </div>
        </div>

        <div className="program-transport">
          <div className="transport-left">
            <button onClick={toggleMute} title="Mute (M)">
              {isMuted ? <VolumeX size={14} /> : <Volume2 size={14} />}
            </button>
          </div>

          <div className="transport-center">
            <button onClick={goToStart} title="Go to Start (Home)">
              <ChevronsLeft size={16} />
            </button>
            <button onClick={() => stepFrame(-1)} title="Step Back (Left Arrow)">
              <SkipBack size={16} />
            </button>
            <button onClick={handlePlayPause} className="play-button" title="Play/Pause (Space)" disabled>
              <Play size={20} />
            </button>
            <button onClick={() => stepFrame(1)} title="Step Forward (Right Arrow)">
              <SkipForward size={16} />
            </button>
            <button onClick={goToEnd} title="Go to End (End)">
              <ChevronsRight size={16} />
            </button>
          </div>

          <div className="transport-right">
            {playbackDirection !== 0 && (
              <span className="playback-speed">{playbackSpeed}x</span>
            )}
          </div>
        </div>
      </div>
    );
  }

  const isImage = clipAtPlayhead.media.type === 'image';

  // Image preview
  if (isImage) {
    return (
      <div className="program-monitor" onClick={handlePaneClick}>
        <div className="program-video-container">
          <img
            src={mediaSrc}
            className="program-video"
            alt={clipAtPlayhead.media.name}
          />
        </div>

        <div className="program-info-bar">
          <span className="program-timecode">{formatTimecode(playheadPosition)}</span>
          <span className="program-name">{clipAtPlayhead.clip.name}</span>
          <span className="program-duration">{formatTimecode(timelineDuration)}</span>
        </div>

        <div className="program-scrub-container">
          <div className="program-scrub-bar" onClick={handleScrubClick}>
            <div className="program-playhead" style={{ left: `${playheadPercent}%` }} />
          </div>
        </div>

        <div className="program-transport">
          <div className="transport-left">
            <button onClick={toggleMute} title="Mute (M)">
              {isMuted ? <VolumeX size={14} /> : <Volume2 size={14} />}
            </button>
          </div>

          <div className="transport-center">
            <button onClick={goToStart} title="Go to Start (Home)">
              <ChevronsLeft size={16} />
            </button>
            <button onClick={() => stepFrame(-1)} title="Step Back (Left Arrow)">
              <SkipBack size={16} />
            </button>
            <button onClick={handlePlayPause} className="play-button" title="Play/Pause (Space)">
              {isPlaying ? <Pause size={20} /> : <Play size={20} />}
            </button>
            <button onClick={() => stepFrame(1)} title="Step Forward (Right Arrow)">
              <SkipForward size={16} />
            </button>
            <button onClick={goToEnd} title="Go to End (End)">
              <ChevronsRight size={16} />
            </button>
          </div>

          <div className="transport-right">
            {playbackDirection !== 0 && (
              <span className="playback-speed">{playbackSpeed}x</span>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Video preview
  return (
    <div className="program-monitor" onClick={handlePaneClick}>
      <div className="program-video-container">
        <video
          ref={videoRef}
          src={mediaSrc}
          className="program-video"
          muted={isMuted}
        />
        {videoError && (
          <div className="program-video-error">
            <p>{videoError}</p>
            <p className="hint">This format may need to be converted before preview</p>
          </div>
        )}
      </div>

      <div className="program-info-bar">
        <span className="program-timecode">{formatTimecode(playheadPosition)}</span>
        <span className="program-name">{clipAtPlayhead.clip.name}</span>
        <span className="program-duration">{formatTimecode(timelineDuration)}</span>
      </div>

      <div className="program-scrub-container">
        <div className="program-scrub-bar" onClick={handleScrubClick}>
          <div className="program-playhead" style={{ left: `${playheadPercent}%` }} />
        </div>
      </div>

      <div className="program-transport">
        <div className="transport-left">
          <button onClick={toggleMute} title="Mute (M)">
            {isMuted ? <VolumeX size={14} /> : <Volume2 size={14} />}
          </button>
        </div>

        <div className="transport-center">
          <button onClick={goToStart} title="Go to Start (Home)">
            <ChevronsLeft size={16} />
          </button>
          <button onClick={() => stepFrame(-1)} title="Step Back (Left Arrow)">
            <SkipBack size={16} />
          </button>
          <button onClick={handlePlayPause} className="play-button" title="Play/Pause (Space)">
            {isPlaying ? <Pause size={20} /> : <Play size={20} />}
          </button>
          <button onClick={() => stepFrame(1)} title="Step Forward (Right Arrow)">
            <SkipForward size={16} />
          </button>
          <button onClick={goToEnd} title="Go to End (End)">
            <ChevronsRight size={16} />
          </button>
        </div>

        <div className="transport-right">
          {playbackDirection !== 0 && (
            <span className="playback-speed">{playbackSpeed}x</span>
          )}
        </div>
      </div>
    </div>
  );
};

export default ProgramMonitor;
