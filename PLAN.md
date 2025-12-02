# Implementation Plan: Project Save/Load + Export

## Overview

This plan covers two major features:
1. **Project Save/Load** - Save timeline state to `.chpchp` files
2. **Video Export** - Export timeline to video with rich options and progress display

---

## Part 1: Project Save/Load (.chpchp files)

### File Format

The `.chpchp` file is a JSON file containing:
```json
{
  "version": "0.1.0",
  "name": "My Project",
  "settings": { /* ProjectSettings */ },
  "media": [
    {
      "id": "...",
      "name": "clip.mp4",
      "path": "C:/videos/clip.mp4",
      "type": "video",
      "duration": 30.5,
      "metadata": { /* MediaMetadata */ }
      // Note: thumbnailPath and waveformData are regenerated on load
    }
  ],
  "timeline": {
    "tracks": [ /* Track[] */ ],
    "playheadPosition": 0,
    "inPoint": null,
    "outPoint": null,
    "markers": [],
    "zoom": 50,
    "scrollX": 0
  }
}
```

### Implementation Steps

1. **Add IPC handlers in `electron/main.ts`:**
   - `project:showOpenDialog` - Show file picker for .chpchp files
   - `project:showSaveDialog` - Show save dialog with .chpchp extension

2. **Update `electron/preload.ts`:**
   - Add `project.showOpenDialog()` and `project.showSaveDialog()` APIs

3. **Add save/load logic in App.tsx or new hook:**
   - `saveProject()` - Serialize state and write to file
   - `loadProject()` - Read file, parse, restore state, regenerate thumbnails/waveforms

4. **Add keyboard shortcuts:**
   - `Ctrl+S` - Save (save to current path, or show Save As if new)
   - `Ctrl+Shift+S` - Save As (always show dialog)
   - `Ctrl+O` - Open project

5. **Add status bar indicator for dirty state**

---

## Part 2: Export Dialog & Video Export

### Export Dialog Component

Create `src/components/ExportDialog/ExportDialog.tsx`:

**Layout:**
```
┌─────────────────────────────────────────────────────────────┐
│                         Export                          [X] │
├─────────────────────────────────────────────────────────────┤
│ Output: [________________________] [Browse...]              │
├─────────────────────────────────────────────────────────────┤
│                        PRESETS                              │
│ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐            │
│ │YouTube  │ │YouTube  │ │Twitter/X│ │ Custom  │            │
│ │ 1080p   │ │  4K     │ │         │ │         │            │
│ └─────────┘ └─────────┘ └─────────┘ └─────────┘            │
├─────────────────────────────────────────────────────────────┤
│ [▼] Video Settings                                          │
│    Format:     [mp4 ▼]                                      │
│    Codec:      [H.264 (libx264) ▼]                         │
│    Resolution: [1920x1080 ▼] or [Source ▼]                 │
│    Frame Rate: [30 ▼] or [Source ▼]                        │
│    Quality:    [───●──────────] CRF: 18                    │
│    Preset:     [slow ▼] (slower = smaller file)            │
│                                                             │
│ [▼] Audio Settings                                          │
│    Codec:      [AAC ▼]                                      │
│    Bitrate:    [192k ▼]                                     │
│    Sample Rate:[48000 ▼]                                    │
│    Channels:   [Stereo ▼]                                   │
│                                                             │
│ [▼] Advanced                                                │
│    [x] Use GPU encoding (if available)                      │
│    Custom args: [________________________]                  │
├─────────────────────────────────────────────────────────────┤
│ Duration: 00:05:30  Est. Size: ~250 MB                      │
├─────────────────────────────────────────────────────────────┤
│                    [Cancel]  [Export]                       │
└─────────────────────────────────────────────────────────────┘
```

**During Export (replaces dialog content):**
```
┌─────────────────────────────────────────────────────────────┐
│                       Exporting...                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│    ████████████████████░░░░░░░░░░░░░░ 65%                  │
│                                                             │
│    Time: 00:03:34 / 00:05:30                               │
│    Speed: 1.5x                                              │
│    ETA: ~1 min 20 sec                                       │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                        [Cancel]                             │
└─────────────────────────────────────────────────────────────┘
```

### Implementation Steps

#### Backend (electron/)

1. **Create `electron/ffmpeg/graphBuilder.ts`:**
   - `buildFilterGraph(timeline, media)` - Generates ffmpeg filter_complex
   - Handles: clip trimming, track stacking, audio mixing
   - Returns: { inputs: InputDef[], filterComplex: string, maps: string[] }

2. **Create `electron/ffmpeg/exporter.ts`:**
   - `exportTimeline(timeline, media, settings, onProgress)` - Main export function
   - Calls graphBuilder to construct command
   - Uses `runFFmpegWithProgress` to execute
   - Returns promise that resolves when complete

3. **Add IPC handlers in `electron/main.ts`:**
   - `export:start` - Start export, returns export job ID
   - `export:cancel` - Cancel running export
   - `export:progress` - Send progress updates to renderer (via event)

4. **Update `electron/preload.ts`:**
   - Add `export.start(settings)`, `export.cancel(jobId)`
   - Add `export.onProgress(callback)` for progress events

#### Frontend (src/)

1. **Create Redux slice `src/store/exportSlice.ts`:**
   - State: { isExporting, progress, currentJobId, error }
   - Actions: startExport, updateProgress, cancelExport, exportComplete, exportError

2. **Create `src/components/ExportDialog/ExportDialog.tsx`:**
   - Modal dialog component
   - Preset selection (from DEFAULT_EXPORT_PRESETS)
   - Collapsible sections for Video/Audio/Advanced settings
   - Export button triggers export
   - Progress view during export

3. **Create `src/components/ExportDialog/ExportDialog.css`:**
   - Modal overlay styling
   - Form controls styling
   - Progress bar styling

4. **Add to App.tsx:**
   - State for dialog visibility
   - Keyboard shortcut `Ctrl+E` to open export dialog
   - Render ExportDialog conditionally

---

## Filter Graph Building Strategy

For the initial implementation, support a simplified timeline model:

### Phase 1 (This Implementation)
- Single video track with sequential clips
- Single audio track with sequential clips
- Basic trim (mediaIn/mediaOut) support
- No transitions, effects, or layering yet

### Example Output
For a timeline with 2 video clips and 2 audio clips:
```bash
ffmpeg \
  -i "clip1.mp4" \
  -i "clip2.mp4" \
  -filter_complex "
    [0:v]trim=start=0:end=5,setpts=PTS-STARTPTS[v0];
    [1:v]trim=start=2:end=7,setpts=PTS-STARTPTS[v1];
    [v0][v1]concat=n=2:v=1:a=0[vout];
    [0:a]atrim=start=0:end=5,asetpts=PTS-STARTPTS[a0];
    [1:a]atrim=start=2:end=7,asetpts=PTS-STARTPTS[a1];
    [a0][a1]concat=n=2:v=0:a=1[aout]
  " \
  -map "[vout]" -map "[aout]" \
  -c:v libx264 -crf 18 -preset slow \
  -c:a aac -b:a 192k \
  output.mp4
```

---

## File Structure Summary

```
electron/
  main.ts                    # Add project/export IPC handlers
  preload.ts                 # Add project/export APIs
  ffmpeg/
    runner.ts                # (existing)
    probe.ts                 # (existing)
    graphBuilder.ts          # NEW - Timeline to filter graph
    exporter.ts              # NEW - Export orchestration

src/
  store/
    exportSlice.ts           # NEW - Export state management
  components/
    ExportDialog/
      ExportDialog.tsx       # NEW - Export dialog UI
      ExportDialog.css       # NEW - Dialog styling
  App.tsx                    # Add save/load/export shortcuts & dialog
```

---

## Keyboard Shortcuts Summary

| Shortcut | Action |
|----------|--------|
| Ctrl+S | Save Project |
| Ctrl+Shift+S | Save Project As |
| Ctrl+O | Open Project |
| Ctrl+M | Export (Make) |

---

## Estimated Complexity

1. **Project Save/Load**: Low-medium complexity
   - JSON serialization is straightforward
   - Need to handle thumbnail/waveform regeneration on load

2. **Export Dialog UI**: Medium complexity
   - Modal with form controls
   - Preset selection
   - Progress display

3. **Filter Graph Builder**: High complexity (but starting simple)
   - Phase 1: Just concat clips, basic trim
   - Future: Handle layering, effects, transitions

4. **Export Backend**: Medium complexity
   - Already have runFFmpegWithProgress
   - Need IPC for progress events

---

## Ready to Implement

This plan covers the full implementation. I'll proceed in this order:
1. Project Save/Load (simpler, foundational)
2. Export Dialog UI (can work with mock progress)
3. Filter Graph Builder + Export Backend (complete the loop)
