/**
 * UI Redux Slice
 *
 * Manages UI state: selections, active tool, panel layout.
 */

import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import type { UIState, Tool, InspectorTab, PanelLayout } from '@types';

interface ExtendedUIState extends UIState {
  sourceMediaId: string | null;
  sourceInPoint: number | null;
  sourceOutPoint: number | null;
}

const initialState: ExtendedUIState = {
  selectedClipIds: [],
  selectedTrackId: null,
  activeTool: 'select',
  panelLayout: {
    preset: 'default',
    panels: [], // TODO: Define default panel layout
  },
  commandCrafterOpen: false,
  inspectorTab: 'clip',
  sourceMediaId: null,
  sourceInPoint: null,
  sourceOutPoint: null,
};

const uiSlice = createSlice({
  name: 'ui',
  initialState,
  reducers: {
    // Selection
    selectClip: (state, action: PayloadAction<string>) => {
      state.selectedClipIds = [action.payload];
    },

    addToSelection: (state, action: PayloadAction<string>) => {
      if (!state.selectedClipIds.includes(action.payload)) {
        state.selectedClipIds.push(action.payload);
      }
    },

    removeFromSelection: (state, action: PayloadAction<string>) => {
      state.selectedClipIds = state.selectedClipIds.filter(
        (id) => id !== action.payload
      );
    },

    clearSelection: (state) => {
      state.selectedClipIds = [];
    },

    selectTrack: (state, action: PayloadAction<string | null>) => {
      state.selectedTrackId = action.payload;
    },

    // Tools
    setActiveTool: (state, action: PayloadAction<Tool>) => {
      state.activeTool = action.payload;
    },

    // Panels
    setPanelLayout: (state, action: PayloadAction<PanelLayout>) => {
      state.panelLayout = action.payload;
    },

    toggleCommandCrafter: (state) => {
      state.commandCrafterOpen = !state.commandCrafterOpen;
    },

    setCommandCrafterOpen: (state, action: PayloadAction<boolean>) => {
      state.commandCrafterOpen = action.payload;
    },

    setInspectorTab: (state, action: PayloadAction<InspectorTab>) => {
      state.inspectorTab = action.payload;
    },

    // Source preview
    setSourceMediaId: (state, action: PayloadAction<string | null>) => {
      state.sourceMediaId = action.payload;
      // Clear in/out points when changing source
      state.sourceInPoint = null;
      state.sourceOutPoint = null;
    },

    setSourceInPoint: (state, action: PayloadAction<number | null>) => {
      state.sourceInPoint = action.payload;
    },

    setSourceOutPoint: (state, action: PayloadAction<number | null>) => {
      state.sourceOutPoint = action.payload;
    },
  },
});

export const {
  selectClip,
  addToSelection,
  removeFromSelection,
  clearSelection,
  selectTrack,
  setActiveTool,
  setPanelLayout,
  toggleCommandCrafter,
  setCommandCrafterOpen,
  setInspectorTab,
  setSourceMediaId,
  setSourceInPoint,
  setSourceOutPoint,
} = uiSlice.actions;

export default uiSlice.reducer;
