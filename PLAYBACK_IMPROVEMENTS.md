# Program Monitor Playback Improvements

This document outlines the plan to improve the program monitor playback system.

---

## Issues to Fix

### 1. Progressive Playback (Major)
**Problem**: Forward playback blocks until the entire timeline is pre-rendered.

**Solution**: Enable progressive playback that plays directly from source for simple segments and only uses pre-rendered chunks for complex segments.

**Files to modify**:
- `src/components/ProgramMonitor/ProgramMonitor.tsx`
- `src/hooks/useHybridPreview.ts`

**Tasks**:
- [ ] Remove the blocking `previewReady` check for playback
- [ ] Implement real-time source playback for simple clips using `getClipAtTime()`
- [ ] Switch video source dynamically as playhead crosses clip boundaries
- [ ] Fall back to frame extraction when hitting complex segments without cached chunks

---

### 2. Reverse Playback Frame Prefetching
**Problem**: Reverse playback awaits each frame extraction serially, causing stutter.

**Solution**: Use the existing `prefetchFrames()` method to pre-extract upcoming frames.

**Files to modify**:
- `src/components/ProgramMonitor/ProgramMonitor.tsx`
- `electron/preview/FrameExtractor.ts`

**Tasks**:
- [ ] Call `prefetchFrames()` during reverse playback to queue frames ahead
- [ ] Implement a frame buffer that holds 5-10 pre-extracted frames
- [ ] Pull from buffer instead of awaiting extraction on each rAF tick
- [ ] Expose prefetch via IPC if not already available

---

### 3. Smarter Scrub Frame Handling
**Problem**: Fast scrubbing cancels frames before they complete, showing blanks.

**Solution**: Prioritize current position but don't cancel in-flight extractions that might still be useful.

**Files to modify**:
- `electron/preview/FrameExtractor.ts`

**Tasks**:
- [ ] Add a small extraction queue (3-5 requests) instead of cancelling immediately
- [ ] Mark frames with priority (current position = high, recent positions = low)
- [ ] Only cancel when queue is full AND new request has higher priority
- [ ] Return most recent completed frame if current extraction hasn't finished

---

### 4. Fix Frame Cache Key Precision
**Problem**: Cache key uses millisecond precision, causing duplicate entries for the same visual frame.

**Solution**: Round cache keys to frame boundaries using the sequence frame rate.

**Files to modify**:
- `electron/preview/FrameExtractor.ts`

**Tasks**:
- [ ] Store frame rate in FrameExtractor during `initialize()`
- [ ] Change `getCacheKey()` to use frame number: `Math.round(time * frameRate)`
- [ ] Update cache invalidation to work with frame-based keys

---

### 5. Audio During Reverse Playback
**Problem**: Reverse playback has no audio (forward uses video element, reverse uses canvas).

**Solution**: Use `ScrubAudioController` during reverse playback with negative velocity.

**Files to modify**:
- `src/components/ProgramMonitor/ProgramMonitor.tsx`
- `electron/preview/ScrubAudioController.ts` (if needed)

**Tasks**:
- [ ] Start scrub audio when entering reverse playback mode
- [ ] Update scrub audio on each reverse frame with negative velocity
- [ ] Stop scrub audio when pausing or switching to forward

---

## Implementation Order

1. **Fix Frame Cache Key Precision** (Quick win, low risk)
2. **Smarter Scrub Frame Handling** (Improves UX immediately)
3. **Reverse Playback Frame Prefetching** (Fixes stutter)
4. **Audio During Reverse Playback** (Polish)
5. **Progressive Playback** (Largest change, save for last)

---

## Progress

| # | Issue | Status |
|---|-------|--------|
| 1 | Progressive Playback | ✅ Complete |
| 2 | Reverse Playback Prefetching | ✅ Complete |
| 3 | Smarter Scrub Frame Handling | ✅ Complete |
| 4 | Frame Cache Key Precision | ✅ Complete |
| 5 | Audio During Reverse Playback | ✅ Complete |

---

## Summary of Changes

### 1. Frame Cache Key Precision (FrameExtractor.ts)
- Changed cache key from millisecond precision to frame number precision
- Prevents duplicate cache entries for the same visual frame
- Updated `invalidateRange()` to work with frame-based keys

### 2. Smarter Scrub Frame Handling (FrameExtractor.ts)
- Added priority-based extraction queue (high/normal/low)
- Allows up to 3 concurrent extractions
- Only cancels lower-priority extractions when queue is full
- Added `getLastCompletedFrame()` for immediate display during extraction

### 3. Reverse Playback Prefetching (ProgramMonitor.tsx + IPC)
- Added `prefetchFrames()` method with direction parameter
- Prefetches frames in reverse direction during reverse playback
- Initial prefetch of 10 frames when entering reverse mode
- Periodic prefetch every 100ms during playback

### 4. Audio During Reverse Playback (ProgramMonitor.tsx)
- Uses ScrubAudioController during reverse playback
- Starts scrub audio when entering reverse mode
- Updates scrub audio with negative velocity every 50ms
- Ends scrub audio when exiting reverse mode

### 5. Progressive Playback from Source (ProgramMonitor.tsx)
- Added source video element for direct source file playback
- Checks if current position is a simple segment (single clip)
- Plays directly from source file for simple clips
- Automatically detects clip boundaries and transitions to next clip
- Falls back to pre-rendered preview for complex segments
