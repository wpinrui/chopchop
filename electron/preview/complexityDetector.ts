/**
 * Complexity Detector
 *
 * SIMPLIFIED: All segments with content are treated as complex.
 * This ensures consistent chunk-based playback without hybrid mode switching.
 */

import type {
  Timeline,
  Track,
  Clip,
  SegmentComplexity,
} from './types';

/**
 * Analyze complexity for a specific time range
 * All segments with content are complex - use chunks for everything
 */
export function analyzeSegmentComplexity(
  timeline: Timeline,
  startTime: number,
  endTime: number
): SegmentComplexity {
  const allTracks = timeline.tracks.filter(
    (t) => (t.type === 'video' && t.visible !== false) || (t.type === 'audio' && !t.muted)
  );
  const hasContent = hasClipsInTimeRange(allTracks, startTime, endTime);

  return {
    startTime,
    endTime,
    isComplex: hasContent,
    reasons: [],
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
 * Check if there are any clips in a time range
 */
function hasClipsInTimeRange(
  tracks: Track[],
  startTime: number,
  endTime: number
): boolean {
  for (const track of tracks) {
    for (const clip of track.clips) {
      if (!clip.enabled) continue;

      const clipStart = clip.timelineStart;
      const clipEnd = clip.timelineStart + clip.duration;

      if (clipStart < endTime && clipEnd > startTime) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Quick check if a specific time point has content (always complex)
 */
export function isTimePointComplex(
  timeline: Timeline,
  time: number
): { isComplex: boolean; clipCount: number; hasEffects: boolean } {
  const allTracks = timeline.tracks.filter(
    (t) => (t.type === 'video' && t.visible !== false) || (t.type === 'audio' && !t.muted)
  );

  let clipCount = 0;

  for (const track of allTracks) {
    for (const clip of track.clips) {
      if (!clip.enabled) continue;

      const clipStart = clip.timelineStart;
      const clipEnd = clip.timelineStart + clip.duration;

      if (time >= clipStart && time < clipEnd) {
        clipCount++;
      }
    }
  }

  return {
    isComplex: clipCount > 0,
    clipCount,
    hasEffects: false,
  };
}

/**
 * Get the topmost video clip at a time point (for frame extraction)
 */
export function getSingleClipAtTime(
  timeline: Timeline,
  time: number
): { clip: Clip; track: Track } | null {
  const videoTracks = timeline.tracks.filter(
    (t) => t.type === 'video' && t.visible !== false
  );

  // Iterate in reverse order (top track first) to get the topmost clip
  for (let i = videoTracks.length - 1; i >= 0; i--) {
    const track = videoTracks[i];

    for (const clip of track.clips) {
      if (!clip.enabled) continue;

      const clipStart = clip.timelineStart;
      const clipEnd = clip.timelineStart + clip.duration;

      if (time >= clipStart && time < clipEnd) {
        return { clip, track };
      }
    }
  }

  return null;
}
