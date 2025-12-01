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
      state.tracks.push(action.payload);
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

    updateClip: (
      state,
      action: PayloadAction<{ id: string; updates: Partial<Clip> }>
    ) => {
      for (const track of state.tracks) {
        const clip = track.clips.find((c) => c.id === action.payload.id);
        if (clip) {
          Object.assign(clip, action.payload.updates);
          break;
        }
      }
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
    loadTimeline: (state, action: PayloadAction<Timeline>) => {
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
  addClip,
  removeClip,
  updateClip,
  addMarker,
  removeMarker,
  setZoom,
  setScrollX,
  loadTimeline,
  resetTimeline,
} = timelineSlice.actions;

export default timelineSlice.reducer;
