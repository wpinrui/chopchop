/**
 * Preview Redux Slice
 *
 * Manages preview/playback state: playing status, chunks, render queue.
 */

import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import type { PreviewState, ChunkStatus, RenderJob } from '@types';

const initialState: PreviewState = {
  isPlaying: false,
  playbackRate: 1.0,
  chunks: [],
  proxyMode: true,
  renderQueue: [],
};

const previewSlice = createSlice({
  name: 'preview',
  initialState,
  reducers: {
    // Playback
    setPlaying: (state, action: PayloadAction<boolean>) => {
      state.isPlaying = action.payload;
    },

    togglePlayback: (state) => {
      state.isPlaying = !state.isPlaying;
    },

    setPlaybackRate: (state, action: PayloadAction<number>) => {
      state.playbackRate = action.payload;
    },

    // Chunks
    addChunk: (state, action: PayloadAction<ChunkStatus>) => {
      state.chunks.push(action.payload);
    },

    updateChunk: (
      state,
      action: PayloadAction<{ id: string; updates: Partial<ChunkStatus> }>
    ) => {
      const chunk = state.chunks.find((c) => c.id === action.payload.id);
      if (chunk) {
        Object.assign(chunk, action.payload.updates);
      }
    },

    markChunksStale: (state, action: PayloadAction<string[]>) => {
      action.payload.forEach((chunkId) => {
        const chunk = state.chunks.find((c) => c.id === chunkId);
        if (chunk) {
          chunk.status = 'stale';
        }
      });
    },

    clearChunks: (state) => {
      state.chunks = [];
    },

    // Proxy mode
    setProxyMode: (state, action: PayloadAction<boolean>) => {
      state.proxyMode = action.payload;
    },

    // Render queue
    addRenderJob: (state, action: PayloadAction<RenderJob>) => {
      state.renderQueue.push(action.payload);
    },

    updateRenderJob: (
      state,
      action: PayloadAction<{ id: string; updates: Partial<RenderJob> }>
    ) => {
      const job = state.renderQueue.find((j) => j.id === action.payload.id);
      if (job) {
        Object.assign(job, action.payload.updates);
      }
    },

    removeRenderJob: (state, action: PayloadAction<string>) => {
      state.renderQueue = state.renderQueue.filter(
        (j) => j.id !== action.payload
      );
    },

    clearRenderQueue: (state) => {
      state.renderQueue = [];
    },
  },
});

export const {
  setPlaying,
  togglePlayback,
  setPlaybackRate,
  addChunk,
  updateChunk,
  markChunksStale,
  clearChunks,
  setProxyMode,
  addRenderJob,
  updateRenderJob,
  removeRenderJob,
  clearRenderQueue,
} = previewSlice.actions;

export default previewSlice.reducer;
