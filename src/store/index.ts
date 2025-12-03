/**
 * Redux Store Configuration
 */

import { configureStore } from '@reduxjs/toolkit';
import projectReducer from './projectSlice';
import timelineReducer from './timelineSlice';
import uiReducer from './uiSlice';
import previewReducer from './previewSlice';
import historyReducer from './historySlice';
import ffmpegReducer from './ffmpegSlice';
import { undoMiddleware } from './undoMiddleware';

export const store = configureStore({
  reducer: {
    project: projectReducer,
    timeline: timelineReducer,
    ui: uiReducer,
    preview: previewReducer,
    history: historyReducer,
    ffmpeg: ffmpegReducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        // Ignore these action types for serialization checks
        ignoredActions: ['history/pushState', 'history/pushFuture', 'history/pushPast'],
      },
    }).concat(undoMiddleware),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
