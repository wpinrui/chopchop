/**
 * History Redux Slice
 *
 * Manages undo/redo state.
 */

import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import type { HistoryState, HistoryEntry } from '@types';

const initialState: HistoryState = {
  past: [],
  future: [],
  maxEntries: 50,
};

const historySlice = createSlice({
  name: 'history',
  initialState,
  reducers: {
    addEntry: (state, action: PayloadAction<HistoryEntry>) => {
      state.past.push(action.payload);
      if (state.past.length > state.maxEntries) {
        state.past.shift();
      }
      state.future = [];
    },

    undo: (state) => {
      const entry = state.past.pop();
      if (entry) {
        state.future.push(entry);
      }
    },

    redo: (state) => {
      const entry = state.future.pop();
      if (entry) {
        state.past.push(entry);
      }
    },

    clearHistory: (state) => {
      state.past = [];
      state.future = [];
    },
  },
});

export const { addEntry, undo, redo, clearHistory } = historySlice.actions;

export default historySlice.reducer;
