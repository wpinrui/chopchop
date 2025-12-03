/**
 * History Redux Slice
 *
 * Manages undo/redo state with up to 50 history entries.
 * Captures timeline and media state for restoration.
 */

import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import type { AppDispatch, RootState } from './index';
import type { HistoryState, HistoryEntry, Timeline, MediaItem } from '@types';
import { loadTimeline } from './timelineSlice';
import { setMedia } from './projectSlice';

const MAX_HISTORY_ENTRIES = 50;

const initialState: HistoryState = {
  past: [],
  future: [],
  maxEntries: MAX_HISTORY_ENTRIES,
};

const historySlice = createSlice({
  name: 'history',
  initialState,
  reducers: {
    // Push current state to history before making a change
    pushState: (state, action: PayloadAction<HistoryEntry>) => {
      state.past.push(action.payload);
      if (state.past.length > state.maxEntries) {
        state.past.shift();
      }
      // Clear future when new action is performed
      state.future = [];
    },

    // Pop from past and push to future (for undo)
    popPast: (state) => {
      const entry = state.past.pop();
      if (entry) {
        state.future.push(entry);
      }
    },

    // Pop from future and push to past (for redo)
    popFuture: (state) => {
      const entry = state.future.pop();
      if (entry) {
        state.past.push(entry);
      }
    },

    // Store current state in future (before undo restores previous state)
    pushFuture: (state, action: PayloadAction<HistoryEntry>) => {
      state.future.push(action.payload);
    },

    // Store state in past (before redo restores next state)
    pushPast: (state, action: PayloadAction<HistoryEntry>) => {
      state.past.push(action.payload);
      if (state.past.length > state.maxEntries) {
        state.past.shift();
      }
    },

    clearHistory: (state) => {
      state.past = [];
      state.future = [];
    },
  },
});

export const { pushState, popPast, popFuture, pushFuture, pushPast, clearHistory } = historySlice.actions;

// Helper to create a history entry from current state
const createHistoryEntry = (
  timeline: Timeline,
  media: MediaItem[],
  actionName: string
): HistoryEntry => ({
  timestamp: Date.now(),
  actionName,
  timeline: JSON.parse(JSON.stringify(timeline)), // Deep clone
  media: JSON.parse(JSON.stringify(media)), // Deep clone
});

// Thunk: Record current state before an undoable action
export const recordHistoryState = (actionName: string) => {
  return (dispatch: AppDispatch, getState: () => RootState) => {
    const state = getState();
    const entry = createHistoryEntry(state.timeline, state.project.media, actionName);
    dispatch(pushState(entry));
  };
};

// Thunk: Undo - restore previous state
export const performUndo = () => {
  return (dispatch: AppDispatch, getState: () => RootState) => {
    const state = getState();
    const { past } = state.history;

    if (past.length === 0) {
      return false; // Nothing to undo
    }

    // Save current state to future before undoing
    const currentEntry = createHistoryEntry(
      state.timeline,
      state.project.media,
      'Current State'
    );
    dispatch(pushFuture(currentEntry));

    // Get the state to restore
    const previousEntry = past[past.length - 1];
    dispatch(popPast());

    // Restore the state
    dispatch(loadTimeline(previousEntry.timeline));
    dispatch(setMedia(previousEntry.media));

    return true;
  };
};

// Thunk: Redo - restore next state
export const performRedo = () => {
  return (dispatch: AppDispatch, getState: () => RootState) => {
    const state = getState();
    const { future } = state.history;

    if (future.length === 0) {
      return false; // Nothing to redo
    }

    // Save current state to past before redoing
    const currentEntry = createHistoryEntry(
      state.timeline,
      state.project.media,
      'Current State'
    );
    dispatch(pushPast(currentEntry));

    // Get the state to restore
    const nextEntry = future[future.length - 1];
    dispatch(popFuture());

    // Restore the state
    dispatch(loadTimeline(nextEntry.timeline));
    dispatch(setMedia(nextEntry.media));

    return true;
  };
};

// Selectors
export const selectCanUndo = (state: RootState) => state.history.past.length > 0;
export const selectCanRedo = (state: RootState) => state.history.future.length > 0;
export const selectUndoActionName = (state: RootState) => {
  const { past } = state.history;
  return past.length > 0 ? past[past.length - 1].actionName : null;
};
export const selectRedoActionName = (state: RootState) => {
  const { future } = state.history;
  return future.length > 0 ? future[future.length - 1].actionName : null;
};

export default historySlice.reducer;
