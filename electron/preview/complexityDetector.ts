/**
 * Complexity Detector
 *
 * Determines whether a timeline segment is "simple" (can be played in real-time)
 * or "complex" (needs pre-rendering).
 *
 * Simple: Single video clip, no overlays, no effects
 * Complex: Multiple overlapping clips, effects, transitions, speed changes
 */

import type {
  Timeline,
  Track,
  Clip,
  SegmentComplexity,
  ComplexityReason,
} from './types';

/**
 * Analyze complexity for a specific time range
 */
export function analyzeSegmentComplexity(
  timeline: Timeline,
  startTime: number,
  endTime: number
): SegmentComplexity {
  const reasons: ComplexityReason[] = [];

  // Get all video tracks
  const videoTracks = timeline.tracks.filter(
    (t) => t.type === 'video' && t.visible !== false
  );

  // Count overlapping clips at any point in the segment
  const clipsInRange = getClipsInTimeRange(videoTracks, startTime, endTime);

  // Check for multiple overlapping clips
  if (hasOverlappingClips(clipsInRange, startTime, endTime)) {
    reasons.push('multiple_clips');
  }

  // Check for effects on any clip
  for (const clip of clipsInRange) {
    if (clipHasEffects(clip)) {
      reasons.push('has_effects');
      break;
    }
  }

  // Check for speed changes (mediaIn/mediaOut vs duration mismatch)
  for (const clip of clipsInRange) {
    if (clipHasSpeedChange(clip)) {
      reasons.push('speed_change');
      break;
    }
  }

  // TODO: Check for transitions when implemented
  // if (hasTransitions(timeline, startTime, endTime)) {
  //   reasons.push('has_transition');
  // }

  return {
    startTime,
    endTime,
    isComplex: reasons.length > 0,
    reasons,
  };
}

/**
 * Analyze complexity for the entire timeline, returning segments
 */
export function analyzeTimelineComplexity(
  timeline: Timeline,
  totalDuration: number,
  chunkDuration: number
): SegmentComplexity[] {
  const segments: SegmentComplexity[] = [];
  const numChunks = Math.ceil(totalDuration / chunkDuration);

  for (let i = 0; i < numChunks; i++) {
    const startTime = i * chunkDuration;
    const endTime = Math.min((i + 1) * chunkDuration, totalDuration);
    segments.push(analyzeSegmentComplexity(timeline, startTime, endTime));
  }

  return segments;
}

/**
 * Get all clips that overlap with a time range
 */
function getClipsInTimeRange(
  tracks: Track[],
  startTime: number,
  endTime: number
): Clip[] {
  const clips: Clip[] = [];

  for (const track of tracks) {
    for (const clip of track.clips) {
      if (!clip.enabled) continue;

      const clipStart = clip.timelineStart;
      const clipEnd = clip.timelineStart + clip.duration;

      // Check if clip overlaps with time range
      if (clipStart < endTime && clipEnd > startTime) {
        clips.push(clip);
      }
    }
  }

  return clips;
}

/**
 * Check if there are overlapping clips at any point in the range
 */
function hasOverlappingClips(
  clips: Clip[],
  startTime: number,
  endTime: number
): boolean {
  // Sample at multiple points within the range
  const sampleCount = 10;
  const sampleInterval = (endTime - startTime) / sampleCount;

  for (let i = 0; i <= sampleCount; i++) {
    const sampleTime = startTime + i * sampleInterval;
    let clipCount = 0;

    for (const clip of clips) {
      const clipStart = clip.timelineStart;
      const clipEnd = clip.timelineStart + clip.duration;

      if (sampleTime >= clipStart && sampleTime < clipEnd) {
        clipCount++;
        if (clipCount > 1) {
          return true;
        }
      }
    }
  }

  return false;
}

/**
 * Check if a clip has any enabled effects
 */
function clipHasEffects(clip: Clip): boolean {
  if (!clip.effects || clip.effects.length === 0) {
    return false;
  }

  return clip.effects.some((effect) => effect.enabled);
}

/**
 * Check if a clip has a speed change
 * A speed change is detected when the media duration doesn't match the clip duration
 */
function clipHasSpeedChange(clip: Clip): boolean {
  const mediaDuration = clip.mediaOut - clip.mediaIn;
  const clipDuration = clip.duration;

  // Allow small tolerance for floating point
  const tolerance = 0.01;
  return Math.abs(mediaDuration - clipDuration) > tolerance;
}

/**
 * Quick check if a specific time point is complex
 */
export function isTimePointComplex(
  timeline: Timeline,
  time: number
): { isComplex: boolean; clipCount: number; hasEffects: boolean } {
  const videoTracks = timeline.tracks.filter(
    (t) => t.type === 'video' && t.visible !== false
  );

  let clipCount = 0;
  let hasEffects = false;

  for (const track of videoTracks) {
    for (const clip of track.clips) {
      if (!clip.enabled) continue;

      const clipStart = clip.timelineStart;
      const clipEnd = clip.timelineStart + clip.duration;

      if (time >= clipStart && time < clipEnd) {
        clipCount++;

        if (clipHasEffects(clip)) {
          hasEffects = true;
        }
      }
    }
  }

  return {
    isComplex: clipCount > 1 || hasEffects,
    clipCount,
    hasEffects,
  };
}

/**
 * Get the single clip at a time point (for simple segments)
 * Returns null if no clip or multiple clips
 */
export function getSingleClipAtTime(
  timeline: Timeline,
  time: number
): { clip: Clip; track: Track } | null {
  const videoTracks = timeline.tracks.filter(
    (t) => t.type === 'video' && t.visible !== false
  );

  let foundClip: Clip | null = null;
  let foundTrack: Track | null = null;
  let clipCount = 0;

  // Iterate in reverse order (top track first) to get the topmost clip
  for (let i = videoTracks.length - 1; i >= 0; i--) {
    const track = videoTracks[i];

    for (const clip of track.clips) {
      if (!clip.enabled) continue;

      const clipStart = clip.timelineStart;
      const clipEnd = clip.timelineStart + clip.duration;

      if (time >= clipStart && time < clipEnd) {
        clipCount++;
        if (clipCount === 1) {
          foundClip = clip;
          foundTrack = track;
        } else {
          // Multiple clips found
          return null;
        }
      }
    }
  }

  if (foundClip && foundTrack) {
    return { clip: foundClip, track: foundTrack };
  }

  return null;
}
