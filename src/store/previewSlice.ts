/**
 * Preview Redux Slice
 *
 * Manages preview/playback state: playing status, chunks, render queue.
 * Handles background chunk rendering for timeline preview.
 */

import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import type { PreviewState, ChunkStatus, RenderJob, PreviewFile } from '@types';

// Chunk duration in seconds - 2 seconds is a good balance between
// render speed and seeking granularity
export const CHUNK_DURATION = 2;

const initialPreview: PreviewFile = {
  status: 'idle',
  filePath: null,
  progress: 0,
  error: null,
};

const initialState: PreviewState = {
  isPlaying: false,
  playbackRate: 1.0,
  chunks: [],
  proxyMode: true,
  renderQueue: [],
  preview: initialPreview,
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

    // Initialize chunks for the entire timeline duration
    initializeChunks: (state, action: PayloadAction<{ duration: number }>) => {
      const { duration } = action.payload;
      const numChunks = Math.ceil(duration / CHUNK_DURATION);

      state.chunks = [];
      for (let i = 0; i < numChunks; i++) {
        const startTime = i * CHUNK_DURATION;
        const endTime = Math.min((i + 1) * CHUNK_DURATION, duration);

        state.chunks.push({
          id: `chunk-${i}`,
          startTime,
          endTime,
          status: 'pending',
          filePath: null,
          error: null,
        });
      }
    },

    // Mark chunks that overlap with a time range as stale
    markChunksStaleInRange: (
      state,
      action: PayloadAction<{ startTime: number; endTime: number }>
    ) => {
      const { startTime, endTime } = action.payload;
      state.chunks.forEach((chunk) => {
        // Check if chunk overlaps with the time range
        if (chunk.startTime < endTime && chunk.endTime > startTime) {
          if (chunk.status === 'ready') {
            chunk.status = 'stale';
          }
        }
      });
    },

    // Mark all chunks as stale (for major edits like adding/removing tracks)
    markAllChunksStale: (state) => {
      state.chunks.forEach((chunk) => {
        if (chunk.status === 'ready') {
          chunk.status = 'stale';
        }
      });
    },

    // Set chunk as rendering
    setChunkRendering: (state, action: PayloadAction<string>) => {
      const chunk = state.chunks.find((c) => c.id === action.payload);
      if (chunk) {
        chunk.status = 'rendering';
      }
    },

    // Set chunk as ready with file path
    setChunkReady: (
      state,
      action: PayloadAction<{ id: string; filePath: string }>
    ) => {
      const chunk = state.chunks.find((c) => c.id === action.payload.id);
      if (chunk) {
        chunk.status = 'ready';
        chunk.filePath = action.payload.filePath;
        chunk.error = null;
      }
    },

    // Set chunk error
    setChunkError: (
      state,
      action: PayloadAction<{ id: string; error: string }>
    ) => {
      const chunk = state.chunks.find((c) => c.id === action.payload.id);
      if (chunk) {
        chunk.status = 'error';
        chunk.error = action.payload.error;
      }
    },

    // === Single Preview File Actions ===

    // Start rendering the full timeline preview
    startPreviewRender: (state) => {
      state.preview.status = 'rendering';
      state.preview.progress = 0;
      state.preview.error = null;
    },

    // Update preview render progress
    setPreviewProgress: (state, action: PayloadAction<number>) => {
      state.preview.progress = action.payload;
    },

    // Preview render completed successfully
    setPreviewReady: (state, action: PayloadAction<string>) => {
      state.preview.status = 'ready';
      state.preview.filePath = action.payload;
      state.preview.progress = 100;
      state.preview.error = null;
    },

    // Preview render failed
    setPreviewError: (state, action: PayloadAction<string>) => {
      state.preview.status = 'error';
      state.preview.error = action.payload;
      state.preview.progress = 0;
    },

    // Mark preview as stale (needs re-render after edit)
    markPreviewStale: (state) => {
      if (state.preview.status === 'ready') {
        state.preview.status = 'stale';
      }
    },

    // Reset preview to idle state
    resetPreview: (state) => {
      state.preview = initialPreview;
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
  initializeChunks,
  markChunksStaleInRange,
  markAllChunksStale,
  setChunkRendering,
  setChunkReady,
  setChunkError,
  // Single preview file actions
  startPreviewRender,
  setPreviewProgress,
  setPreviewReady,
  setPreviewError,
  markPreviewStale,
  resetPreview,
} = previewSlice.actions;

// Selectors
export const selectChunkAtTime = (state: { preview: PreviewState }, time: number): ChunkStatus | null => {
  return state.preview.chunks.find(
    (chunk) => time >= chunk.startTime && time < chunk.endTime
  ) || null;
};

export const selectChunksInRange = (
  state: { preview: PreviewState },
  startTime: number,
  endTime: number
): ChunkStatus[] => {
  return state.preview.chunks.filter(
    (chunk) => chunk.startTime < endTime && chunk.endTime > startTime
  );
};

export const selectPendingChunks = (state: { preview: PreviewState }): ChunkStatus[] => {
  return state.preview.chunks.filter(
    (chunk) => chunk.status === 'pending' || chunk.status === 'stale'
  );
};

export const selectRenderingChunks = (state: { preview: PreviewState }): ChunkStatus[] => {
  return state.preview.chunks.filter((chunk) => chunk.status === 'rendering');
};

export const selectAllChunksReady = (state: { preview: PreviewState }): boolean => {
  return state.preview.chunks.length > 0 &&
    state.preview.chunks.every((chunk) => chunk.status === 'ready');
};

export const selectRenderProgress = (state: { preview: PreviewState }): number => {
  const total = state.preview.chunks.length;
  if (total === 0) return 100;
  const ready = state.preview.chunks.filter((c) => c.status === 'ready').length;
  return Math.round((ready / total) * 100);
};

export default previewSlice.reducer;
