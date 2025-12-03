/**
 * Undo Middleware
 *
 * Automatically captures state before undoable actions.
 * This middleware intercepts specific actions and records history state
 * before the action is applied.
 */

import { Middleware } from '@reduxjs/toolkit';
import { pushState } from './historySlice';
import type { Timeline, MediaItem, HistoryEntry } from '@types';

// Actions that should trigger history recording
// NOTE: updateClip is NOT here - it's called continuously during drag
// Instead, we record history manually at drag START in Timeline.tsx
const UNDOABLE_ACTIONS: Record<string, string> = {
  // Timeline actions
  'timeline/addClip': 'Add Clip',
  'timeline/removeClip': 'Remove Clip',
  'timeline/addTrack': 'Add Track',
  'timeline/removeTrack': 'Remove Track',
  'timeline/unlinkClips': 'Unlink Clips',
  'timeline/linkClips': 'Link Clips',

  // Project/Media actions
  'project/addMediaItem': 'Import Media',
  'project/removeMediaItem': 'Remove Media',

  // Batch operations
  'timeline/removeClipsByMediaId': 'Remove Clips',
};

// Actions to skip (don't record history for these)
const SKIP_ACTIONS = new Set([
  // Playhead movement shouldn't be undoable
  'timeline/setPlayheadPosition',
  'timeline/setInPoint',
  'timeline/setOutPoint',
  'timeline/setZoom',
  'timeline/setScrollX',

  // History actions themselves
  'history/pushState',
  'history/popPast',
  'history/popFuture',
  'history/pushFuture',
  'history/pushPast',
  'history/clearHistory',

  // Load actions (used by undo/redo to restore state)
  'timeline/loadTimeline',
  'project/setMedia',
  'project/loadProject',

  // UI actions
  'ui/selectClip',
  'ui/addToSelection',
  'ui/removeFromSelection',
  'ui/clearSelection',
  'ui/setActivePane',
  'ui/setPlayingPane',
  'ui/setSelectedMediaId',
  'ui/setSourceMediaId',
  'ui/setSourceInPoint',
  'ui/setSourceOutPoint',

  // Media updates that don't affect timeline (waveforms, proxies, thumbnails)
  'project/updateMediaItem',
  'project/setMediaProxy',
]);

// Helper to create a history entry
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

// Track last recorded action to avoid duplicates from rapid changes
let lastRecordedAction: string | null = null;
let lastRecordedTime = 0;
const DEBOUNCE_MS = 100; // Don't record same action type within 100ms

export const undoMiddleware: Middleware = (store) => (next) => (action) => {
  const actionType = (action as { type: string }).type;

  // Skip non-undoable actions
  if (SKIP_ACTIONS.has(actionType)) {
    return next(action);
  }

  // Check if this is an undoable action
  const actionName = UNDOABLE_ACTIONS[actionType];

  if (actionName) {
    const now = Date.now();

    // Debounce rapid same-type actions (e.g., dragging a clip)
    const shouldRecord =
      lastRecordedAction !== actionType ||
      now - lastRecordedTime > DEBOUNCE_MS;

    if (shouldRecord) {
      const state = store.getState();
      const entry = createHistoryEntry(
        state.timeline,
        state.project.media,
        actionName
      );

      store.dispatch(pushState(entry));

      lastRecordedAction = actionType;
      lastRecordedTime = now;
    }
  }

  return next(action);
};

export default undoMiddleware;
