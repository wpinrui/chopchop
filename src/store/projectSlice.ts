/**
 * Project Redux Slice
 *
 * Manages project-level state: name, path, settings, media bin.
 */

import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import type { Project, ProjectSettings, MediaItem } from '@types';
import { DEFAULT_PROJECT_SETTINGS } from '@types';

const initialState: Project = {
  version: '0.1.0',
  name: 'Untitled',
  path: null,
  dirty: false,
  settings: DEFAULT_PROJECT_SETTINGS,
  media: [],
};

const projectSlice = createSlice({
  name: 'project',
  initialState,
  reducers: {
    // Project metadata
    setProjectName: (state, action: PayloadAction<string>) => {
      state.name = action.payload;
      state.dirty = true;
    },

    setProjectPath: (state, action: PayloadAction<string | null>) => {
      state.path = action.payload;
    },

    markClean: (state) => {
      state.dirty = false;
    },

    markDirty: (state) => {
      state.dirty = true;
    },

    // Project settings
    updateSettings: (state, action: PayloadAction<Partial<ProjectSettings>>) => {
      state.settings = { ...state.settings, ...action.payload };
      state.dirty = true;
    },

    // Initialize sequence settings from media metadata (called when first clip is added)
    initializeSequenceFromMedia: (
      state,
      action: PayloadAction<{ width: number; height: number; frameRate?: number }>
    ) => {
      // Only initialize if not already done
      if (!state.settings.sequenceInitialized) {
        const { width, height, frameRate } = action.payload;
        state.settings.resolution = [width, height];
        if (frameRate && frameRate > 0) {
          state.settings.frameRate = Math.round(frameRate);
        }
        state.settings.sequenceInitialized = true;
        state.dirty = true;
      }
    },

    // Media bin
    addMediaItem: (state, action: PayloadAction<MediaItem>) => {
      state.media.push(action.payload);
      state.dirty = true;
    },

    removeMediaItem: (state, action: PayloadAction<string>) => {
      state.media = state.media.filter((item) => item.id !== action.payload);
      state.dirty = true;
    },

    updateMediaItem: (
      state,
      action: PayloadAction<{ id: string; updates: Partial<MediaItem> }>
    ) => {
      const item = state.media.find((m) => m.id === action.payload.id);
      if (item) {
        Object.assign(item, action.payload.updates);
        state.dirty = true;
      }
    },

    // Load/reset
    loadProject: (_state, action: PayloadAction<Project>) => {
      return { ...action.payload, dirty: false };
    },

    resetProject: () => {
      return initialState;
    },
  },
});

export const {
  setProjectName,
  setProjectPath,
  markClean,
  markDirty,
  updateSettings,
  initializeSequenceFromMedia,
  addMediaItem,
  removeMediaItem,
  updateMediaItem,
  loadProject,
  resetProject,
} = projectSlice.actions;

export default projectSlice.reducer;
