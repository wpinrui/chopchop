/**
 * Program Monitor Component
 *
 * Displays timeline preview at current playhead position.
 * Composites video/images onto a canvas at sequence resolution.
 * Uses letterboxing/pillarboxing to fit content that doesn't match aspect ratio.
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
import { updateSettings } from '../../store/projectSlice';
import type { Track, Clip, MediaItem } from '@types';
import './ProgramMonitor.css';

// Playback speeds for J/L shuttle control
const PLAYBACK_SPEEDS = [0.5, 1, 2, 4];

// Preview quality options
const PREVIEW_QUALITY_OPTIONS = [
  { value: 1, label: 'Full' },
  { value: 0.5, label: '1/2' },
  { value: 0.25, label: '1/4' },
  { value: 0.125, label: '1/8' },
];

interface ClipAtPlayhead {
  clip: Clip;
  track: Track;
  media: MediaItem;
  // The time within the source media file to display
  mediaTime: number;
}

const ProgramMonitor: React.FC = () => {
  const dispatch = useDispatch();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // Track original media dimensions for proxy scaling
  const originalDimensionsRef = useRef<{ width: number; height: number } | null>(null);

  // Container size for calculating canvas display dimensions
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });

  // Get timeline state from Redux
  const tracks = useSelector((state: RootState) => state.timeline.tracks);
  const playheadPosition = useSelector((state: RootState) => state.timeline.playheadPosition);
  const media = useSelector((state: RootState) => state.project.media);
  const fps = useSelector((state: RootState) => state.project.settings.frameRate);
  const activePane = useSelector((state: RootState) => state.ui.activePane);
  const playingPane = useSelector((state: RootState) => state.ui.playingPane);

  // Sequence settings
  const sequenceResolution = useSelector((state: RootState) => state.project.settings.resolution);
  const backgroundColor = useSelector((state: RootState) => state.project.settings.backgroundColor);
  const previewQuality = useSelector((state: RootState) => state.project.settings.previewQuality) ?? 1;
  const proxyEnabled = useSelector((state: RootState) => state.project.settings.proxyEnabled);
  const [fullWidth, fullHeight] = sequenceResolution;
  // Apply preview quality scaling - canvas renders at reduced resolution
  const seqWidth = Math.round(fullWidth * previewQuality);
  const seqHeight = Math.round(fullHeight * previewQuality);

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
  const animationFrameRef = useRef<number | null>(null);

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

  // Calculate canvas display size to fill container while maintaining aspect ratio
  const canvasDisplaySize = (() => {
    if (containerSize.width === 0 || containerSize.height === 0) {
      return { width: seqWidth, height: seqHeight };
    }

    const containerAspect = containerSize.width / containerSize.height;
    const canvasAspect = seqWidth / seqHeight;

    if (canvasAspect > containerAspect) {
      // Canvas is wider - fit to width
      return {
        width: containerSize.width,
        height: containerSize.width / canvasAspect,
      };
    } else {
      // Canvas is taller - fit to height
      return {
        width: containerSize.height * canvasAspect,
        height: containerSize.height,
      };
    }
  })();

  // Draw content onto the canvas, centered, cropped if larger than sequence
  // Source is scaled by previewQuality to match reduced canvas resolution
  // Uses originalDimensionsRef for proper sizing when using proxy files
  const drawToCanvas = useCallback((source: HTMLVideoElement | HTMLImageElement | null) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Fill background
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, seqWidth, seqHeight);

    if (!source) return;

    // Get source dimensions - use original from ref (for proxy files), otherwise from element
    const originalDims = originalDimensionsRef.current;
    const srcWidth = (originalDims?.width && originalDims.width > 0)
      ? originalDims.width
      : (source instanceof HTMLVideoElement ? source.videoWidth : source.naturalWidth);
    const srcHeight = (originalDims?.height && originalDims.height > 0)
      ? originalDims.height
      : (source instanceof HTMLVideoElement ? source.videoHeight : source.naturalHeight);

    if (srcWidth === 0 || srcHeight === 0) return;

    // Scale source dimensions by preview quality
    const scaledSrcWidth = srcWidth * previewQuality;
    const scaledSrcHeight = srcHeight * previewQuality;

    // Center the scaled source on the canvas
    const drawX = (seqWidth - scaledSrcWidth) / 2;
    const drawY = (seqHeight - scaledSrcHeight) / 2;

    ctx.drawImage(source, drawX, drawY, scaledSrcWidth, scaledSrcHeight);
  }, [seqWidth, seqHeight, backgroundColor, previewQuality]);

  // Clear canvas to background color
  const clearCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, seqWidth, seqHeight);
  }, [seqWidth, seqHeight, backgroundColor]);

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

  // Update original dimensions ref when clip changes (for proxy scaling)
  useEffect(() => {
    if (clipAtPlayhead?.media.metadata) {
      originalDimensionsRef.current = {
        width: clipAtPlayhead.media.metadata.width || 0,
        height: clipAtPlayhead.media.metadata.height || 0,
      };
    } else {
      originalDimensionsRef.current = null;
    }
  }, [clipAtPlayhead?.media.id, clipAtPlayhead?.media.metadata]);

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

    // Only sync for video clips (not images)
    if (clipAtPlayhead.media.type === 'image') return;

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

  // Draw to canvas when clip or playhead changes (for static frames)
  useEffect(() => {
    if (isPlaying) return; // Don't redraw while playing - the animation loop handles it

    if (!clipAtPlayhead) {
      // No clip at playhead - show background
      clearCanvas();
      return;
    }

    if (clipAtPlayhead.media.type === 'image') {
      // For images, load and draw
      const img = imageRef.current;
      if (img) {
        img.src = `file:///${clipAtPlayhead.media.path.replace(/\\/g, '/')}`;
      }
    } else {
      // For video, draw current frame once video seeks
      const video = videoRef.current;
      if (video && !seekingRef.current && video.readyState >= 2) {
        drawToCanvas(video);
      }
    }
  }, [clipAtPlayhead, isPlaying, drawToCanvas, clearCanvas]);

  // Handle image load
  useEffect(() => {
    const img = imageRef.current;
    if (!img) return;

    const handleLoad = () => {
      drawToCanvas(img);
    };

    img.addEventListener('load', handleLoad);
    return () => img.removeEventListener('load', handleLoad);
  }, [drawToCanvas]);

  // Handle video events
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // No longer use timeupdate for playback - we drive from requestAnimationFrame
    // This is just for handling seek completion and errors

    const handleSeeked = () => {
      seekingRef.current = false;
      // Draw current frame to canvas after seeking
      if (!isPlaying) {
        drawToCanvas(video);
      }
    };

    const handleEnded = () => {
      // Video ended naturally - don't stop timeline, let playhead continue
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

    video.addEventListener('seeked', handleSeeked);
    video.addEventListener('ended', handleEnded);
    video.addEventListener('error', handleError);
    video.addEventListener('loadedmetadata', handleLoadedMetadata);

    return () => {
      video.removeEventListener('seeked', handleSeeked);
      video.removeEventListener('ended', handleEnded);
      video.removeEventListener('error', handleError);
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
    };
  }, [clipAtPlayhead, isPlaying, drawToCanvas]);

  // Handle play state changes
  useEffect(() => {
    if (isPlaying) {
      dispatch(setPlayingPane('program'));
    } else if (playingPane === 'program') {
      dispatch(setPlayingPane(null));
    }
  }, [isPlaying, dispatch, playingPane]);

  // Playhead-driven forward playback
  // Advances playhead based on wall-clock time, handles gaps between clips
  useEffect(() => {
    if (!isPlaying || playbackDirection !== 1) return;

    let lastTime = performance.now();
    let currentPlayhead = playheadPosition; // Capture initial position, accumulate locally

    const updatePlayback = (now: number) => {
      const delta = (now - lastTime) / 1000;
      lastTime = now;

      currentPlayhead += delta * playbackSpeed; // Accumulate into local variable

      // Check if we've reached end of timeline
      if (currentPlayhead >= timelineDuration) {
        dispatch(setPlayheadPosition(timelineDuration));
        setIsPlaying(false);
        setPlaybackDirection(0);
        // Draw final frame
        const video = videoRef.current;
        if (video) drawToCanvas(video);
        else clearCanvas();
        return;
      }

      dispatch(setPlayheadPosition(currentPlayhead));

      // Find clip at current playhead position and draw
      let foundClip = false;
      const videoTracks = tracks.filter(t => t.type === 'video');
      for (const track of videoTracks) {
        for (const clip of track.clips) {
          if (!clip.enabled) continue;
          const clipStart = clip.timelineStart;
          const clipEnd = clip.timelineStart + clip.duration;
          if (currentPlayhead >= clipStart && currentPlayhead < clipEnd) {
            const mediaItem = media.find(m => m.id === clip.mediaId);
            if (mediaItem) {
              foundClip = true;
              const timeInClip = currentPlayhead - clipStart;
              const mediaTime = clip.mediaIn + timeInClip;

              if (mediaItem.type === 'image') {
                // Image - draw from imageRef
                const img = imageRef.current;
                if (img && img.src.includes(mediaItem.path.replace(/\\/g, '/'))) {
                  drawToCanvas(img);
                }
              } else {
                // Video - sync video element and draw
                const video = videoRef.current;
                if (video) {
                  // Only seek if significantly different (avoid constant seeking)
                  if (Math.abs(video.currentTime - mediaTime) > 0.1) {
                    video.currentTime = mediaTime;
                  }
                  drawToCanvas(video);
                }
              }
            }
            break;
          }
        }
        if (foundClip) break;
      }

      if (!foundClip) {
        // No clip at playhead - show background
        clearCanvas();
      }

      animationFrameRef.current = requestAnimationFrame(updatePlayback);
    };

    animationFrameRef.current = requestAnimationFrame(updatePlayback);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  // Note: playheadPosition is intentionally NOT in deps - we capture it once when play starts
  // and accumulate locally. Adding it would restart the effect every frame.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, playbackDirection, playbackSpeed, timelineDuration, tracks, media, dispatch, drawToCanvas, clearCanvas]);

  // Playhead-driven reverse playback
  // Rewinds playhead based on wall-clock time, handles gaps between clips
  useEffect(() => {
    if (!isPlaying || playbackDirection !== -1) return;

    let lastTime = performance.now();
    let currentPlayhead = playheadPosition; // Capture initial position, accumulate locally

    const updateReverse = (now: number) => {
      const delta = (now - lastTime) / 1000;
      lastTime = now;

      currentPlayhead -= delta * playbackSpeed; // Accumulate (subtract for reverse)

      // Check if we've reached the start of the timeline
      if (currentPlayhead <= 0) {
        dispatch(setPlayheadPosition(0));
        setIsPlaying(false);
        setPlaybackDirection(0);
        clearCanvas();
        return;
      }

      dispatch(setPlayheadPosition(currentPlayhead));

      // Find clip at current playhead position and draw
      let foundClip = false;
      const videoTracks = tracks.filter(t => t.type === 'video');
      for (const track of videoTracks) {
        for (const clip of track.clips) {
          if (!clip.enabled) continue;
          const clipStart = clip.timelineStart;
          const clipEnd = clip.timelineStart + clip.duration;
          if (currentPlayhead >= clipStart && currentPlayhead < clipEnd) {
            const mediaItem = media.find(m => m.id === clip.mediaId);
            if (mediaItem) {
              foundClip = true;
              const timeInClip = currentPlayhead - clipStart;
              const mediaTime = clip.mediaIn + timeInClip;

              if (mediaItem.type === 'image') {
                const img = imageRef.current;
                if (img && img.src.includes(mediaItem.path.replace(/\\/g, '/'))) {
                  drawToCanvas(img);
                }
              } else {
                const video = videoRef.current;
                if (video) {
                  video.currentTime = mediaTime;
                  drawToCanvas(video);
                }
              }
            }
            break;
          }
        }
        if (foundClip) break;
      }

      if (!foundClip) {
        clearCanvas();
      }

      animationFrameRef.current = requestAnimationFrame(updateReverse);
    };

    animationFrameRef.current = requestAnimationFrame(updateReverse);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  // Note: playheadPosition is intentionally NOT in deps - we capture it once when play starts
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, playbackDirection, playbackSpeed, tracks, media, dispatch, drawToCanvas, clearCanvas]);

  // Keyboard shortcuts
  useEffect(() => {
    if (!shouldHandleKeyboard) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const video = videoRef.current;

      // Don't handle if typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      switch (e.key.toLowerCase()) {
        case 'k':
        case ' ':
          e.preventDefault();
          if (playbackDirection === 0) {
            // Start playing forward
            setPlaybackSpeed(1);
            setPlaybackDirection(1);
            setIsPlaying(true);
            if (video) {
              video.playbackRate = 1;
              video.play();
            }
          } else {
            // Stop
            if (video) video.pause();
            setIsPlaying(false);
            setPlaybackDirection(0);
          }
          break;

        case 'j':
          e.preventDefault();
          if (playbackDirection === 1) {
            // Switch from forward to reverse
            if (video) video.pause();
            setPlaybackSpeed(PLAYBACK_SPEEDS[0]);
            setPlaybackDirection(-1);
            setIsPlaying(true);
          } else if (playbackDirection === -1) {
            // Already reversing - speed up
            const currentIndex = PLAYBACK_SPEEDS.indexOf(playbackSpeed);
            const nextIndex = Math.min(currentIndex + 1, PLAYBACK_SPEEDS.length - 1);
            setPlaybackSpeed(PLAYBACK_SPEEDS[nextIndex]);
          } else {
            // Start reversing
            setPlaybackSpeed(PLAYBACK_SPEEDS[0]);
            setPlaybackDirection(-1);
            setIsPlaying(true);
          }
          break;

        case 'l':
          e.preventDefault();
          if (playbackDirection === -1) {
            // Switch from reverse to forward
            setPlaybackDirection(1);
            setPlaybackSpeed(PLAYBACK_SPEEDS[0]);
            setIsPlaying(true);
            if (video) {
              video.playbackRate = PLAYBACK_SPEEDS[0];
              video.play();
            }
          } else if (playbackDirection === 1) {
            // Already playing forward - speed up
            const currentIndex = PLAYBACK_SPEEDS.indexOf(playbackSpeed);
            const nextIndex = Math.min(currentIndex + 1, PLAYBACK_SPEEDS.length - 1);
            setPlaybackSpeed(PLAYBACK_SPEEDS[nextIndex]);
            if (video) video.playbackRate = PLAYBACK_SPEEDS[nextIndex];
          } else {
            // Start playing forward
            setPlaybackSpeed(PLAYBACK_SPEEDS[0]);
            setPlaybackDirection(1);
            setIsPlaying(true);
            if (video) {
              video.playbackRate = PLAYBACK_SPEEDS[0];
              video.play();
            }
          }
          break;

        case 'arrowleft':
          e.preventDefault();
          if (video) video.pause();
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
          if (video) video.pause();
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
          if (video) video.pause();
          setIsPlaying(false);
          setPlaybackDirection(0);
          dispatch(setPlayheadPosition(0));
          break;

        case 'end':
          e.preventDefault();
          if (video) video.pause();
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
  }, [shouldHandleKeyboard, playbackDirection, playbackSpeed, fps, playheadPosition, timelineDuration, isMuted, dispatch]);

  // Set active pane when clicked
  const handlePaneClick = useCallback(() => {
    if (!isActive) {
      dispatch(setActivePane('program'));
    }
  }, [dispatch, isActive]);

  // Play/Pause toggle
  const handlePlayPause = useCallback(() => {
    const video = videoRef.current;

    if (isPlaying) {
      if (video) video.pause();
      setIsPlaying(false);
      setPlaybackDirection(0);
    } else {
      setPlaybackSpeed(1);
      setPlaybackDirection(1);
      setIsPlaying(true);
      if (video) {
        video.playbackRate = 1;
        video.play();
      }
    }
  }, [isPlaying]);

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
  // Use proxy file if available and proxies are enabled
  const mediaPath = (() => {
    if (!clipAtPlayhead?.media) return '';
    const mediaItem = clipAtPlayhead.media;
    // Use proxy for video if available and enabled
    if (mediaItem.type === 'video' && proxyEnabled && mediaItem.proxyPath) {
      return mediaItem.proxyPath;
    }
    return mediaItem.path;
  })();
  const mediaSrc = mediaPath
    ? `file:///${mediaPath.replace(/\\/g, '/')}`
    : '';

  const isImage = clipAtPlayhead?.media.type === 'image';
  const hasClip = !!clipAtPlayhead;

  // Unified canvas-based render
  return (
    <div className="program-monitor" onClick={handlePaneClick}>
      <div className="program-video-container" ref={containerRef}>
        {/* Canvas for composited output at sequence resolution */}
        <canvas
          ref={canvasRef}
          width={seqWidth}
          height={seqHeight}
          className="program-canvas"
          style={{
            width: canvasDisplaySize.width,
            height: canvasDisplaySize.height,
          }}
        />

        {/* Hidden video element as source for canvas drawing */}
        {hasClip && !isImage && (
          <video
            ref={videoRef}
            src={mediaSrc}
            className="program-hidden-source"
            muted={isMuted}
          />
        )}

        {/* Hidden image element as source for canvas drawing */}
        <img
          ref={imageRef}
          className="program-hidden-source"
          alt=""
        />

        {/* Error overlay */}
        {videoError && (
          <div className="program-video-error">
            <p>{videoError}</p>
            <p className="hint">This format may need to be converted before preview</p>
          </div>
        )}

        {/* Resolution indicator */}
        <div className="program-resolution-badge">
          {fullWidth}x{fullHeight}
        </div>
      </div>

      <div className="program-info-bar">
        <span className="program-timecode">{formatTimecode(playheadPosition)}</span>
        <span className="program-name">{hasClip ? clipAtPlayhead.clip.name : 'Program'}</span>
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
          <button
            className={`proxy-toggle ${proxyEnabled ? 'active' : ''}`}
            onClick={() => dispatch(updateSettings({ proxyEnabled: !proxyEnabled }))}
            title={proxyEnabled ? 'Using proxy files for faster playback' : 'Using original files (may be slower)'}
          >
            Proxy
          </button>
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
