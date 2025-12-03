/**
 * Timeline Redux Slice
 *
 * Manages timeline state: tracks, clips, playhead, markers.
 */

import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import type { Timeline, Track, Clip, Marker } from '@types';

const initialState: Timeline = {
  tracks: [],
  playheadPosition: 0,
  inPoint: null,
  outPoint: null,
  markers: [],
  zoom: 50, // pixels per second
  scrollX: 0,
};

const timelineSlice = createSlice({
  name: 'timeline',
  initialState,
  reducers: {
    // Playhead
    setPlayheadPosition: (state, action: PayloadAction<number>) => {
      state.playheadPosition = Math.max(0, action.payload);
    },

    // In/Out points
    setInPoint: (state, action: PayloadAction<number | null>) => {
      state.inPoint = action.payload;
    },

    setOutPoint: (state, action: PayloadAction<number | null>) => {
      state.outPoint = action.payload;
    },

    // Tracks
    addTrack: (state, action: PayloadAction<Track>) => {
      const newTrack = action.payload;
      if (newTrack.type === 'video') {
        // New video tracks go at the top (index 0)
        state.tracks.unshift(newTrack);
      } else {
        // Audio tracks go at the end
        state.tracks.push(newTrack);
      }
    },

    removeTrack: (state, action: PayloadAction<string>) => {
      state.tracks = state.tracks.filter((t) => t.id !== action.payload);
    },

    updateTrack: (
      state,
      action: PayloadAction<{ id: string; updates: Partial<Track> }>
    ) => {
      const track = state.tracks.find((t) => t.id === action.payload.id);
      if (track) {
        Object.assign(track, action.payload.updates);
      }
    },

    // Clips
    addClip: (state, action: PayloadAction<Clip>) => {
      const track = state.tracks.find((t) => t.id === action.payload.trackId);
      if (track) {
        track.clips.push(action.payload);
      }
    },

    removeClip: (state, action: PayloadAction<string>) => {
      state.tracks.forEach((track) => {
        track.clips = track.clips.filter((c) => c.id !== action.payload);
      });
    },

    // Remove all clips that reference a specific media item
    removeClipsByMediaId: (state, action: PayloadAction<string>) => {
      state.tracks.forEach((track) => {
        track.clips = track.clips.filter((c) => c.mediaId !== action.payload);
      });
    },

    updateClip: (
      state,
      action: PayloadAction<{ id: string; updates: Partial<Clip> }>
    ) => {
      const { id, updates } = action.payload;

      // Find the clip and its current track
      let sourceTrack: Track | undefined;
      let clipIndex = -1;
      for (const track of state.tracks) {
        const idx = track.clips.findIndex((c) => c.id === id);
        if (idx !== -1) {
          sourceTrack = track;
          clipIndex = idx;
          break;
        }
      }

      if (!sourceTrack || clipIndex === -1) return;

      const clip = sourceTrack.clips[clipIndex];

      // Check if we're moving to a different track
      if (updates.trackId && updates.trackId !== sourceTrack.id) {
        const targetTrack = state.tracks.find(t => t.id === updates.trackId);
        if (targetTrack) {
          // Remove from source track
          sourceTrack.clips.splice(clipIndex, 1);
          // Update clip properties
          Object.assign(clip, updates);
          // Add to target track
          targetTrack.clips.push(clip);
        }
      } else {
        // Just update properties in place
        Object.assign(clip, updates);
      }
    },

    // Unlink clips - removes linkId from specified clip IDs
    unlinkClips: (state, action: PayloadAction<string[]>) => {
      const clipIdsToUnlink = action.payload;
      for (const track of state.tracks) {
        for (const clip of track.clips) {
          if (clipIdsToUnlink.includes(clip.id)) {
            delete clip.linkId;
          }
        }
      }
    },

    // Link clips - assigns same linkId to all specified clip IDs
    linkClips: (state, action: PayloadAction<string[]>) => {
      const clipIdsToLink = action.payload;
      if (clipIdsToLink.length < 2) return; // Need at least 2 clips to link

      const newLinkId = `link-${Date.now()}-${Math.random()}`;
      for (const track of state.tracks) {
        for (const clip of track.clips) {
          if (clipIdsToLink.includes(clip.id)) {
            clip.linkId = newLinkId;
          }
        }
      }
    },

    // Reorder track position
    reorderTrack: (state, action: PayloadAction<{ trackId: string; newIndex: number }>) => {
      const { trackId, newIndex } = action.payload;
      const currentIndex = state.tracks.findIndex(t => t.id === trackId);
      if (currentIndex === -1) return;
      const [track] = state.tracks.splice(currentIndex, 1);
      state.tracks.splice(newIndex, 0, track);
    },

    // Markers
    addMarker: (state, action: PayloadAction<Marker>) => {
      state.markers.push(action.payload);
    },

    removeMarker: (state, action: PayloadAction<string>) => {
      state.markers = state.markers.filter((m) => m.id !== action.payload);
    },

    // View
    setZoom: (state, action: PayloadAction<number>) => {
      state.zoom = Math.max(10, Math.min(500, action.payload));
    },

    setScrollX: (state, action: PayloadAction<number>) => {
      state.scrollX = Math.max(0, action.payload);
    },

    // Load/reset
    loadTimeline: (_state, action: PayloadAction<Timeline>) => {
      return action.payload;
    },

    resetTimeline: () => {
      return initialState;
    },
  },
});

export const {
  setPlayheadPosition,
  setInPoint,
  setOutPoint,
  addTrack,
  removeTrack,
  updateTrack,
  reorderTrack,
  addClip,
  removeClip,
  removeClipsByMediaId,
  updateClip,
  unlinkClips,
  linkClips,
  addMarker,
  removeMarker,
  setZoom,
  setScrollX,
  loadTimeline,
  resetTimeline,
} = timelineSlice.actions;

export default timelineSlice.reducer;
