# Program Monitor Rewrite Requirements

## Executive Summary

The Program Monitor has severe performance issues even on high-end hardware (RTX 4070). The core problem: **requestAnimationFrame loop dispatches to Redux 60 times per second**, causing React re-renders and state updates to bottleneck the playback loop.

---

## Current Architecture Issues

### Critical Performance Problems

1. **Redux Dispatch Storm**
   - `dispatch(setPlayheadPosition())` called **60 times per second** during playback
   - Each dispatch triggers Redux middleware, selectors, and React re-renders
   - Creates coupling between playback performance and React rendering performance
   - **Solution:** Decouple playback loop from Redux state updates

2. **Canvas Drawing Overhead (Legacy Mode)**
   - `ctx.drawImage()` every frame for clip-based playback
   - Video seeking every frame (slow, especially on high-res files)
   - Proxy dimension calculations per frame
   - **Solution:** Minimize or eliminate canvas drawing, prefer native video playback

3. **State Synchronization Complexity**
   - Multiple refs tracking playback state
   - Local state vs Redux state conflicts
   - Playhead "drift" requires periodic corrections
   - **Solution:** Single source of truth, cleaner state management

4. **Memory Leaks**
   - Hidden video/image elements not always cleaned up
   - Event listeners on window not properly removed
   - RAF loops not cancelled in all code paths
   - **Solution:** Strict lifecycle management, cleanup in unmount

---

## Core Requirements

### 1. Playback Modes

#### Primary: Unified Preview Playback
- Display pre-rendered timeline preview video (single MP4)
- Video element handles playback directly (hardware-accelerated)
- Canvas overlay for UI elements ONLY (not video content)
- **Performance target:** Smooth 60fps playback at any resolution

#### Fallback: Individual Clip Playback
- Used when preview is rendering or stale
- Should still perform acceptably (30fps minimum)
- Clear visual indicator that preview is not ready
- Option to wait for preview before playing

### 2. Transport Controls

**Required Controls:**
- Play/Pause toggle (Space, K key)
- Skip to start (Home)
- Skip to end (End)
- Step forward 1 frame (Right arrow, L key held)
- Step backward 1 frame (Left arrow, J key held)
- Mute/Unmute audio (M key)

**JKL Shuttle Control:**
- J: Reverse playback
  - Press once: -1x speed
  - Press twice: -2x speed
  - Press 3x: -4x speed
  - Each press increases speed
- K: Stop/Pause
- L: Forward playback
  - Press once: 1x speed
  - Press twice: 2x speed
  - Press 3x: 4x speed
  - Each press increases speed

**Behavior:**
- Pressing opposite direction resets speed (J after L, or vice versa)
- K always resets speed to 0
- Speed indicator shows current playback speed

### 3. Scrubbing

**Requirements:**
- Click scrub bar to jump to position
- Drag playhead indicator to scrub
- Display frame at scrub position immediately
- Smooth scrubbing experience (< 16ms frame update)
- Mouse capture during drag (track outside component bounds)
- Auto-pause during scrub, resume after if was playing

**Performance target:** < 16ms per frame update (60fps scrubbing)

### 4. Timecode Display

**Format:** HH:MM:SS:FF (Hours:Minutes:Seconds:Frames)
- Current playhead position (editable)
- Total timeline duration (read-only)
- Click to edit playhead position directly

**Frame Calculation:**
```
frames = Math.floor((time % 1) * frameRate)
```

### 5. Preview Quality Control

**Options:**
- Full (1.0)
- Half (0.5)
- Quarter (0.25)
- Eighth (0.125)

**Affects:**
- Canvas overlay resolution (if used)
- NOT the preview video playback quality
- Trade-off: performance vs visual clarity of UI overlays

### 6. Keyboard Shortcuts

**Focus Rules:**
- Shortcuts active when Program Monitor is focused OR timeline is active
- Shortcuts active when Program Monitor is playing (even if another pane focused)
- Shortcuts disabled when typing in text inputs

**Required Shortcuts:**
| Key | Action |
|-----|--------|
| Space | Play/Pause toggle |
| K | Pause |
| J | Reverse play (multi-press for speed) |
| L | Forward play (multi-press for speed) |
| Left Arrow | Step back 1 frame |
| Right Arrow | Step forward 1 frame |
| Home | Jump to start |
| End | Jump to end |
| M | Mute/Unmute |

### 7. Loading States

**Preview Not Ready:**
- Show loading spinner overlay
- Display progress bar with percentage
- Show current phase (Proxies: X/Y, Rendering: Z%)
- "Cancel" button to abort rendering
- "Play Anyway" button to use fallback mode

**Video Loading:**
- Show spinner while video seeks/loads
- Timeout after 5 seconds, show error
- Graceful degradation if source unavailable

**Error States:**
- Display user-friendly error messages
- Suggest actions (convert format, check file exists)
- Allow retry or fallback mode

### 8. Visual Display

**Canvas/Video Display:**
- Maintain sequence aspect ratio
- Letterbox/pillarbox to fit container
- Center video content
- Background color from project settings
- Scale canvas to fit container while preserving aspect

**Resolution Calculation:**
```typescript
// Sequence resolution from project settings
seqWidth = projectSettings.resolution[0]
seqHeight = projectSettings.resolution[1]

// Aspect ratio
seqAspect = seqWidth / seqHeight

// Container size from ResizeObserver
containerWidth, containerHeight
containerAspect = containerWidth / containerHeight

// Fit to container
if (seqAspect > containerAspect) {
  // Fit to width, letterbox top/bottom
  displayWidth = containerWidth
  displayHeight = containerWidth / seqAspect
} else {
  // Fit to height, pillarbox sides
  displayWidth = containerHeight * seqAspect
  displayHeight = containerHeight
}
```

**Background:**
- Fill with project background color
- Visible in letterbox/pillarbox areas

### 9. Audio Playback

**Requirements:**
- Audio plays from preview video (primary mode)
- Audio plays from individual clips (fallback mode)
- Synchronized with video playback
- Mute toggle persists across mode switches
- Volume control (optional, nice-to-have)

### 10. Integration Points

#### Redux State (Read)
```typescript
// Timeline
timeline.playheadPosition: number
timeline.tracks: Track[]
timeline.zoom: number

// Project
project.settings.resolution: [number, number]
project.settings.frameRate: number
project.settings.backgroundColor: string
project.settings.previewQuality: number
project.settings.proxyEnabled: boolean

// Media
project.media: MediaItem[]

// Preview
preview.status: 'idle' | 'rendering' | 'ready' | 'stale' | 'error'
preview.filePath: string | null
preview.progress: number

// UI
ui.activePane: 'source' | 'program' | 'timeline' | 'mediaBin'
ui.playingPane: 'source' | 'program' | null
```

#### Redux State (Write)
```typescript
// Only write playhead position, and do it SPARINGLY
dispatch(setPlayheadPosition(time))

// Ideally:
// - On scrub end
// - On play/pause
// - On frame step
// - Periodically during playback (max 10Hz, not 60Hz)
```

#### Preview System
```typescript
// Listen for preview status changes
useSelector(state => state.preview.status)
useSelector(state => state.preview.filePath)

// Trigger preview rendering via usePreviewRenderer hook
// (handled automatically, no direct API calls needed)
```

#### IPC (via preload API)
```typescript
window.api.preview.onPipelineProgress((progress) => {
  // Update progress UI
})

window.api.preview.onProxyGenerated(({ mediaId, proxyPath }) => {
  // Update proxy status
})

window.api.preview.cancelPipeline()
```

---

## Technical Requirements for Rewrite

### Architecture Principles

1. **Decouple Playback from Redux**
   - Playback loop operates independently
   - Updates Redux at low frequency (5-10Hz, not 60Hz)
   - Use refs for high-frequency state (current time, playing)
   - Sync Redux → ref on Redux changes only

2. **Prefer Native Video Playback**
   - Use `<video>` element for preview mode (primary)
   - Let browser handle hardware acceleration
   - Canvas only for UI overlays (scrub bar, timecode, markers)
   - Avoid canvas video rendering unless absolutely necessary

3. **Clean State Management**
   - Single source of truth for playback state
   - Clear separation: playback state vs UI state vs Redux state
   - Minimize refs, use only for RAF loop coordination

4. **Strict Lifecycle Management**
   - Clean up RAF loops in unmount
   - Remove event listeners properly
   - Dispose of video elements when switching modes
   - Memory leak detection in dev mode

### Performance Targets

| Metric | Target | Critical |
|--------|--------|----------|
| Playback frame rate | 60fps | 30fps |
| Scrubbing frame rate | 60fps | 30fps |
| Playback start latency | < 200ms | < 500ms |
| Scrub response time | < 16ms | < 50ms |
| Memory usage (1hr timeline) | < 500MB | < 1GB |
| Redux updates during playback | 10 Hz | 30 Hz |

### Code Quality Requirements

1. **TypeScript Strict Mode**
   - No `any` types
   - Proper type definitions for all state
   - Discriminated unions for mode switching

2. **React Best Practices**
   - Functional components only
   - Hooks for all state/effects
   - Memoization for expensive calculations
   - Ref usage documented and justified

3. **Testing**
   - Unit tests for time calculations
   - Integration tests for keyboard shortcuts
   - Performance benchmarks for playback loop
   - Memory leak tests

4. **Documentation**
   - Inline comments for complex logic
   - Architecture decision records (ADRs)
   - Performance optimization notes
   - Known limitations documented

---

## Proposed New Architecture

### Component Structure

```
ProgramMonitor (Container)
├── VideoDisplay (Presentation)
│   ├── <video> element (unified preview mode)
│   └── <canvas> overlay (UI elements)
├── TransportControls (UI)
│   ├── PlayPauseButton
│   ├── SkipButtons
│   ├── MuteButton
│   └── SpeedIndicator
├── ScrubBar (Interactive)
│   ├── Timeline track
│   ├── Playhead indicator
│   └── Drag handlers
├── TimecodeDisplay (UI)
│   ├── Current time (editable)
│   └── Duration (read-only)
├── PreviewControls (UI)
│   └── Quality dropdown
└── LoadingOverlay (Conditional)
    ├── Progress bar
    └── Cancel button
```

### State Architecture

```typescript
// High-frequency playback state (refs, NOT Redux)
interface PlaybackState {
  isPlaying: boolean
  playheadTime: number      // Updated 60fps in RAF loop
  playbackSpeed: number     // 0.5, 1, 2, 4
  direction: -1 | 0 | 1     // reverse, stop, forward
  lastSyncTime: number      // Last time synced to Redux
}

// UI state (local component state)
interface UIState {
  isScrubbing: boolean
  isMuted: boolean
  showLoadingDialog: boolean
  videoError: string | null
}

// Redux state (read-only, slow updates)
// Read from selectors, update sparingly
```

### Playback Loop (Pseudocode)

```typescript
// Main playback loop - runs independently of React
function playbackLoop(timestamp: number) {
  // Calculate delta time
  const delta = (timestamp - lastTimestamp) / 1000
  lastTimestamp = timestamp

  // Update playback time (local ref only)
  playbackStateRef.current.playheadTime += delta * speed * direction

  // Sync video element
  if (previewMode && videoElement) {
    // Let video element play, just keep in sync
    const drift = Math.abs(videoElement.currentTime - playheadTime)
    if (drift > 0.2) {
      videoElement.currentTime = playheadTime
    }
  }

  // Update Redux SPARINGLY (max 10Hz)
  const timeSinceSync = timestamp - lastSyncTime
  if (timeSinceSync > 100) { // 10Hz max
    dispatch(setPlayheadPosition(playheadTime))
    lastSyncTime = timestamp
  }

  // Continue loop
  if (isPlaying) {
    rafHandle = requestAnimationFrame(playbackLoop)
  }
}
```

### Mode Switching Logic

```typescript
// Determine playback mode
const mode = useMemo(() => {
  if (preview.status === 'ready' && preview.filePath) {
    return 'unified-preview'
  }
  return 'legacy-clips'
}, [preview.status, preview.filePath])

// Switch rendering strategy
useEffect(() => {
  if (mode === 'unified-preview') {
    // Set video element source to preview file
    videoRef.current.src = preview.filePath
  } else {
    // Set up clip-based rendering
    prepareClipPlayback()
  }

  return () => cleanup()
}, [mode, preview.filePath])
```

---

## Migration Strategy

### Phase 1: Core Playback Rewrite
- [ ] New playback loop with ref-based state
- [ ] Decouple from Redux (10Hz updates max)
- [ ] Unified preview mode only (remove legacy for now)
- [ ] Basic transport controls (play, pause, seek)
- [ ] Performance validation (60fps target)

### Phase 2: Feature Parity
- [ ] JKL shuttle control
- [ ] Frame stepping
- [ ] Scrubbing with performance optimization
- [ ] Timecode display and editing
- [ ] Keyboard shortcuts
- [ ] Mute toggle

### Phase 3: Polish
- [ ] Loading states and progress indicators
- [ ] Error handling and retry logic
- [ ] Preview quality control
- [ ] Legacy clip mode (if needed)
- [ ] Memory leak fixes
- [ ] Comprehensive testing

### Phase 4: Optimization
- [ ] Canvas overlay optimization
- [ ] Memory profiling and optimization
- [ ] Playback smoothness improvements
- [ ] Hardware acceleration validation
- [ ] Cross-browser testing

---

## Success Criteria

### Must Have
- ✅ Smooth 60fps playback on RTX 4070 (and similar hardware)
- ✅ No Redux dispatch storm (< 10Hz during playback)
- ✅ All transport controls working
- ✅ JKL shuttle control working
- ✅ Scrubbing with immediate feedback
- ✅ Memory stable over long sessions

### Should Have
- ✅ Graceful degradation on lower-end hardware
- ✅ Clear loading and error states
- ✅ Preview quality control
- ✅ Frame-accurate stepping
- ✅ Comprehensive keyboard shortcuts

### Nice to Have
- 🎯 Volume control slider
- 🎯 Waveform overlay on scrub bar
- 🎯 Marker indicators on scrub bar
- 🎯 Playback statistics (fps counter, dropped frames)
- 🎯 Configurable keyboard shortcuts

---

## Known Limitations (Document These)

1. **Fallback Mode Performance**
   - Clip-based playback will always be slower than unified preview
   - Users should be encouraged to wait for preview rendering

2. **Scrubbing Accuracy**
   - Scrubbing limited by video keyframe frequency
   - Frame-accurate scrubbing only works with low-latency codecs

3. **Reverse Playback**
   - Browser video elements don't support native reverse playback
   - Reverse requires manual frame seeking (slower)

4. **High Frame Rate Content**
   - 120fps+ content may not play smoothly in browser
   - Preview rendering should cap at 60fps

---

## Testing Plan

### Unit Tests
- Time to timecode conversion
- Timecode to time parsing
- Playhead position clamping
- Aspect ratio calculations
- Speed calculation (JKL shuttle)

### Integration Tests
- Keyboard shortcuts (all combinations)
- Mode switching (preview ready/not ready)
- Redux state synchronization
- Scrubbing during playback
- Play/pause state transitions

### Performance Tests
- 60fps playback validation (frame timing measurement)
- Memory usage over time (1hr playback)
- Redux update frequency during playback
- Scrubbing responsiveness (frame update latency)

### Manual Tests
- Test on various hardware (low-end, mid-range, high-end)
- Test with various video formats (mp4, mov, webm, mkv)
- Test with various resolutions (720p, 1080p, 4K, 8K)
- Test with various frame rates (24, 30, 60, 120fps)
- Test timeline complexity (10 clips, 100 clips, 1000 clips)

---

## Open Questions

1. **Do we need legacy clip mode at all?**
   - Could we block playback until preview is ready?
   - Or show preview at low quality/res while rendering?

2. **Should we show a visible fps counter in dev mode?**
   - Helps identify performance regressions
   - Could be a debug panel toggle

3. **Canvas overlay: keep or remove?**
   - If we only show video element, do we need canvas at all?
   - Could scrub bar and timecode be HTML elements?

4. **What's the minimum supported hardware?**
   - Should we optimize for integrated graphics?
   - Or assume dedicated GPU for video editing?

5. **Reverse playback: keep or cut?**
   - Rarely used feature
   - Adds significant complexity
   - Could be "preview only" (no audio in reverse)

---

## References

- Current implementation: `src/components/ProgramMonitor/ProgramMonitor.tsx`
- Preview system: `src/hooks/usePreviewRenderer.ts`
- Preview rendering: `electron/ffmpeg/chunkRenderer.ts`
- Filter graph builder: `electron/ffmpeg/graphBuilder.ts`
