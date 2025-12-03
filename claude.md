# claude.md — AI Development Context for ChopChop

This file provides context for AI-assisted development (vibe-coding) of ChopChop. Read this entire file before making any changes to the codebase.

---

## Project Identity

**ChopChop** is a free, open-source video editor for Windows that provides a Premiere Pro-style interface over ffmpeg. The core insight is that ffmpeg can do *everything* — we're just building a better way to talk to it.

### Core Philosophy

1. **ffmpeg is the engine** — We never reinvent what ffmpeg does. Every edit, effect, and export is ultimately an ffmpeg command.

2. **100% capability from day one** — Users can access ANY ffmpeg feature immediately via the Command Crafter (pseudo-GUI fallback). Polished GUI features are added incrementally.

3. **Vertical iteration** — Each version is shippable. v0.1 does one thing beautifully. We never ship half-baked features.

4. **Premiere muscle memory** — Shortcuts, layout, and mental model should feel familiar to Premiere users.

---

## ⚠️ CRITICAL: Source Resolution vs Sequence Resolution

**THIS IS NON-NEGOTIABLE. READ THIS CAREFULLY.**

Source resolution and sequence resolution are **COMPLETELY INDEPENDENT**. Clips are **NEVER** auto-scaled to fit the sequence.

### The Rule

- **Sequence resolution**: The dimensions of the timeline/project output (e.g., 1920x1080)
- **Source resolution**: The dimensions of the imported media file (e.g., 854x480)
- **These are independent.** A clip maintains its native resolution when placed on the timeline.

### Expected Behavior

| Sequence | Source | Result |
|----------|--------|--------|
| 1920x1080 | 854x480 | **Pillarboxes** (black bars on sides) — clip appears centered at native size |
| 1920x1080 | 3840x2160 | **Clip exceeds frame** — centered, edges cropped |
| 1920x1080 | 1920x1080 | Perfect fit, no scaling |
| 1920x1080 | 1280x720 | **Pillarboxes + letterboxes** — clip centered at native size |

### What This Means for Implementation

1. **Preview rendering**: Must pad/crop to sequence dimensions, NOT scale source to fit
2. **Export**: Same — output is always sequence resolution, sources are positioned at native size
3. **ffmpeg filters**: Use `pad` filter to add black bars, NOT `scale` to stretch
4. **User can manually scale**: If user WANTS to scale, they use Scale to Frame Size (explicit action)

### Example ffmpeg for 854x480 source in 1920x1080 sequence

```bash
# CORRECT - pad to sequence resolution (pillarboxes)
ffmpeg -i source_854x480.mp4 -vf "pad=1920:1080:(1920-854)/2:(1080-480)/2:black" output.mp4

# WRONG - scaling destroys aspect ratio or quality
ffmpeg -i source_854x480.mp4 -vf "scale=1920:1080" output.mp4  # NEVER DO THIS AUTOMATICALLY
```

### Why This Matters

This is how **every professional NLE works** (Premiere, DaVinci, Final Cut). Users expect:
- Imported 480p phone video to appear small in a 1080p sequence
- 4K footage to be "zoomed in" when placed in 1080p sequence
- Explicit control over scaling (via inspector properties, not automatic)

**DO NOT implement auto-scaling. EVER.**

---

## Tech Stack

| Concern | Choice | Notes |
|---------|--------|-------|
| Desktop shell | Electron | Main + renderer process architecture |
| UI framework | React 18 | Functional components, hooks only |
| State management | Redux Toolkit | Single source of truth for project state |
| Timeline rendering | WebGL | Custom canvas renderer for performance |
| Language | TypeScript | Strict mode enabled |
| Build tool | Vite | Fast HMR for renderer process |
| Package manager | pnpm | Workspace-aware, fast |
| Video backend | ffmpeg | Called as subprocess, never linked |

---

## Development Environment

- **OS:** Windows (PowerShell as primary shell)
- **Shell commands:** Use PowerShell syntax, not bash
  - `Remove-Item` not `rm`
  - `Copy-Item` not `cp`
  - Use `;` or backtick for line continuation, not `\`
  - Paths use backslashes: `.\src\components\`
- **npm scripts:** These work the same (`pnpm run dev`, etc.)

When writing shell commands or scripts, always assume PowerShell unless explicitly running inside the Electron Node.js context.

---



## Architecture

### Process Model

```
┌─────────────────────────────────────────────────────────────┐
│                    MAIN PROCESS (Node.js)                   │
│  - Window management                                        │
│  - File system access                                       │
│  - ffmpeg subprocess spawning                               │
│  - IPC handlers                                             │
└─────────────────────┬───────────────────────────────────────┘
                      │ IPC (contextBridge)
┌─────────────────────▼───────────────────────────────────────┐
│                  RENDERER PROCESS (Chromium)                │
│  - React UI                                                 │
│  - Redux store                                              │
│  - WebGL timeline                                           │
│  - Preview playback                                         │
└─────────────────────────────────────────────────────────────┘
```

### Key Modules

#### `electron/ffmpeg/runner.ts`
Manages ffmpeg subprocess lifecycle. Provides:
- `runCommand(args: string[]): Promise<RunResult>`
- `spawnPreview(args: string[], onFrame: Callback): ChildProcess`
- `getCapabilities(): Promise<FFmpegCapabilities>`

#### `electron/ffmpeg/graphBuilder.ts`
Translates Redux timeline state → ffmpeg filter_complex strings. This is the most complex module. Key function:
- `buildFilterGraph(timeline: TimelineState): FilterGraphResult`

#### `src/store/projectSlice.ts`
Redux slice for project-level state (name, settings, media bin).

#### `src/store/timelineSlice.ts`
Redux slice for timeline state (tracks, clips, transitions, playhead position).

#### `src/store/undoMiddleware.ts`
Redux middleware that captures state snapshots for undo/redo. Uses structural sharing (Immer) to minimize memory.

#### `src/components/Timeline/`
WebGL-rendered timeline. Key files:
- `Timeline.tsx` — React wrapper, handles events
- `TimelineRenderer.ts` — WebGL rendering logic
- `TimelineState.ts` — Local UI state (zoom, scroll, selection)

#### `src/components/CommandCrafter/`
The pseudo-GUI fallback for unimplemented ffmpeg features. Allows users to:
- Search all ffmpeg capabilities by keyword
- Build commands with guided UI (dropdowns, flag checkboxes)
- Execute and see results
- Optionally apply to timeline as "raw command" clips

---

## FFmpeg Capability System

This is critical to understand. ChopChop maintains a **capability index** of everything ffmpeg can do.

### Building the Index

On first launch (and on-demand refresh), we run:

```bash
ffmpeg -filters         # List all filters
ffmpeg -codecs          # List all codecs  
ffmpeg -formats         # List all formats
ffmpeg -protocols       # List all protocols
ffmpeg -h filter=<name> # Detailed help per filter (run for each)
ffmpeg -h encoder=<name> # Detailed help per encoder
```

This is parsed into a structured index:

```typescript
interface FFmpegCapabilities {
  filters: FilterCapability[];
  codecs: CodecCapability[];
  formats: FormatCapability[];
  protocols: string[];
}

interface FilterCapability {
  name: string;              // e.g., "rotate"
  description: string;       // e.g., "Rotate the input video."
  type: 'video' | 'audio' | 'other';
  inputs: number;            // Number of inputs (-1 = dynamic)
  outputs: number;
  flags: string[];           // e.g., ["slice_threading", "timeline"]
  options: FilterOption[];   // Parsed from -h filter=<name>
  tags: string[];            // Generated keywords for search
  implemented: boolean;      // Does ChopChop have GUI for this?
}

interface FilterOption {
  name: string;
  type: 'int' | 'float' | 'string' | 'boolean' | 'enum' | 'flags';
  default: string | number | boolean | null;
  min?: number;
  max?: number;
  enumValues?: string[];     // For enum types
  description: string;
}
```

### Tagging System

Each capability has auto-generated `tags` for search. Tags come from:
1. The capability name (split on `_`, e.g., `color_balance` → ["color", "balance"])
2. Keywords extracted from description
3. Manual tag additions in `src/ffmpeg/tagOverrides.json`

Example tag override file:
```json
{
  "filters": {
    "hflip": ["mirror", "horizontal", "flip"],
    "vflip": ["mirror", "vertical", "flip"],
    "transpose": ["rotate", "90", "portrait", "landscape"],
    "colorbalance": ["color", "correction", "rgb", "grading"]
  }
}
```

### Implementation Status

Each capability has an `implemented: boolean` flag:
- `true` = Full GUI in Inspector/Timeline
- `false` = Available only via Command Crafter

The `src/ffmpeg/implemented.json` file tracks this:
```json
{
  "filters": ["trim", "setpts", "overlay", "amix", "xfade", "afade"],
  "codecs": ["libx264", "aac"],
  "formats": ["mp4", "mov"]
}
```

As we build GUI for more features, we add them to this list.

---

## Command Crafter (Pseudo-GUI Fallback)

The Command Crafter lets users access ANY ffmpeg capability with guided assistance.

### UI Structure

```
┌─────────────────────────────────────────────────────────────┐
│ 🔍 Search: [rotate____________]                             │
├─────────────────────────────────────────────────────────────┤
│ FILTERS (3 results)                                         │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ ⚙️ rotate        Rotate video by arbitrary angle        │ │
│ │    Tags: rotate, angle, degrees, orientation            │ │
│ │    [Add to Command]                                     │ │
│ ├─────────────────────────────────────────────────────────┤ │
│ │ ⚙️ transpose     Transpose rows with columns            │ │
│ │    Tags: rotate, 90, flip, portrait                     │ │
│ │    [Add to Command]                                     │ │
│ ├─────────────────────────────────────────────────────────┤ │
│ │ ⚙️ hflip         Flip horizontally                      │ │
│ │    Tags: mirror, horizontal, flip                       │ │
│ │    [Add to Command]                                     │ │
│ └─────────────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────────────┤
│ COMMAND BUILDER                                             │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ Filter: rotate                                          │ │
│ │ ┌─────────────────────────────────────────────────────┐ │ │
│ │ │ angle (float): [45___________] degrees              │ │ │
│ │ │ fillcolor (color): [black______▼]                   │ │ │
│ │ │ bilinear (bool): [✓]                                │ │ │
│ │ └─────────────────────────────────────────────────────┘ │ │
│ └─────────────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────────────┤
│ GENERATED COMMAND                                           │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ -vf "rotate=angle=45*PI/180:fillcolor=black:bilinear=1"│ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                             │
│ [Copy Command]  [Apply to Selected Clip]  [Run on File...] │
└─────────────────────────────────────────────────────────────┘
```

### Applying Raw Commands to Timeline

When "Apply to Selected Clip" is clicked:
1. Create a `RawFilterClip` in the timeline state
2. Store the raw ffmpeg args
3. During filter graph generation, insert these args verbatim
4. Display on timeline as a special "raw" effect badge

```typescript
interface RawFilterEffect {
  type: 'raw';
  ffmpegArgs: string;      // e.g., "rotate=angle=45*PI/180"
  displayName: string;     // e.g., "rotate (raw)"
  sourceCapability: string; // e.g., "filter:rotate"
}
```

---

## Redux State Shape

```typescript
interface RootState {
  project: {
    name: string;
    path: string | null;      // null = unsaved
    dirty: boolean;
    settings: ProjectSettings;
    media: MediaItem[];
  };
  
  timeline: {
    tracks: Track[];
    playheadPosition: number;  // in seconds
    inPoint: number | null;
    outPoint: number | null;
    markers: Marker[];
    zoom: number;              // pixels per second
    scrollX: number;
  };
  
  ui: {
    selectedClipIds: string[];
    selectedTrackId: string | null;
    activeTool: 'select' | 'razor' | 'hand';
    panelLayout: PanelLayout;
    commandCrafterOpen: boolean;
  };
  
  preview: {
    isPlaying: boolean;
    chunks: ChunkStatus[];     // which chunks are rendered
    proxyMode: boolean;
  };
  
  history: {
    past: TimelineState[];
    future: TimelineState[];
  };
}
```

---

## Coding Conventions

### TypeScript

- Strict mode enabled (`strict: true`)
- No `any` unless absolutely necessary (and commented why)
- Prefer `interface` over `type` for object shapes
- Use discriminated unions for state variants

```typescript
// Good
interface Clip {
  id: string;
  type: 'video' | 'audio' | 'title';
  // ...
}

// Also good - discriminated union
type Effect = 
  | { type: 'colorCorrection'; exposure: number; contrast: number }
  | { type: 'raw'; ffmpegArgs: string };
```

### React

- Functional components only
- Use hooks for all state and effects
- Prefer `useMemo` and `useCallback` for expensive operations
- Keep components small; extract custom hooks for complex logic

```typescript
// Good
const Timeline: React.FC = () => {
  const clips = useSelector(selectAllClips);
  const dispatch = useDispatch();
  
  const handleClipClick = useCallback((id: string) => {
    dispatch(selectClip(id));
  }, [dispatch]);
  
  return <TimelineCanvas clips={clips} onClipClick={handleClipClick} />;
};
```

### Redux

- Use Redux Toolkit (createSlice, createAsyncThunk)
- Keep slices focused (project, timeline, ui, preview)
- Use selectors for derived state
- Side effects in thunks or middleware only

```typescript
// Good
const timelineSlice = createSlice({
  name: 'timeline',
  initialState,
  reducers: {
    splitClip: (state, action: PayloadAction<{ clipId: string; time: number }>) => {
      // Immer-powered immutable update
    },
  },
});
```

### File Naming

- React components: `PascalCase.tsx`
- Utilities/helpers: `camelCase.ts`
- Types/interfaces: `types.ts` or inline
- Constants: `constants.ts` with `SCREAMING_SNAKE_CASE`

### WebGL

- Keep shaders in separate `.glsl` files in `src/webgl/shaders/`
- Use TypeScript wrapper classes for WebGL resources
- Clean up resources in `dispose()` methods

---

## Filter Graph Generation

This is the heart of ChopChop. Here's how timeline state becomes ffmpeg commands.

### Simple Example

Timeline:
- V1: clip1.mp4 from 0s-5s

Generated:
```bash
ffmpeg -i clip1.mp4 -vf "trim=0:5,setpts=PTS-STARTPTS" -af "atrim=0:5,asetpts=PTS-STARTPTS" output.mp4
```

### Complex Example

Timeline:
- V2: title.png from 0s-3s (overlay)
- V1: clip1.mp4 from 0s-5s, clip2.mp4 from 5s-10s with 1s dissolve
- A1: matching audio with crossfade
- Effect on clip1: raw rotate filter

Generated:
```bash
ffmpeg \
  -i clip1.mp4 -i clip2.mp4 -i title.png \
  -filter_complex "
    [0:v]trim=0:5,setpts=PTS-STARTPTS,rotate=angle=45*PI/180[v0];
    [1:v]trim=0:5,setpts=PTS-STARTPTS[v1];
    [v0][v1]xfade=transition=fade:duration=1:offset=4[v01];
    [2:v]loop=loop=-1:size=1,trim=0:3,setpts=PTS-STARTPTS[title];
    [v01][title]overlay=x=0:y=0:enable='between(t,0,3)'[vout];
    [0:a]atrim=0:5,asetpts=PTS-STARTPTS[a0];
    [1:a]atrim=0:5,asetpts=PTS-STARTPTS[a1];
    [a0][a1]acrossfade=d=1[aout]
  " \
  -map "[vout]" -map "[aout]" output.mp4
```

### Graph Builder Design

```typescript
// electron/ffmpeg/graphBuilder.ts

interface FilterGraphResult {
  inputs: InputDef[];           // -i arguments
  filterComplex: string;        // -filter_complex argument
  maps: string[];               // -map arguments
  success: boolean;
  errors: string[];
}

function buildFilterGraph(timeline: TimelineState): FilterGraphResult {
  // 1. Collect all media inputs
  // 2. Build video filter chain per track
  // 3. Stack tracks with overlay
  // 4. Build audio filter chain
  // 5. Mix audio tracks
  // 6. Return complete graph
}
```

---

## Preview System

### Chunk-Based Rendering

```typescript
interface Chunk {
  id: string;
  startTime: number;
  endTime: number;
  status: 'pending' | 'rendering' | 'ready' | 'stale';
  filePath: string | null;
}
```

1. Timeline divided into 2-second chunks
2. Edit → mark affected chunks as `stale`
3. Background queue renders stale chunks
4. Viewer checks chunk status at playhead
5. If `ready`, play from cache; if not, show spinner or skip

### Proxy Mode

When enabled:
- On import, generate quarter-res proxy: `ffmpeg -i source.mp4 -vf scale=iw/2:-2 proxy.mp4`
- Preview chunks rendered from proxy
- Export always uses original source

---

## Common Tasks

### Adding a New Implemented Filter

1. Add filter name to `src/ffmpeg/implemented.json`
2. Create UI component in `src/components/Inspector/effects/`
3. Add effect type to discriminated union in `types.ts`
4. Update `graphBuilder.ts` to handle the effect type
5. Test with various inputs

### Adding a New Panel

1. Create component in `src/components/YourPanel/`
2. Add to layout system in `src/components/Layout/`
3. Add panel state to `ui` slice if needed
4. Add keyboard shortcut if appropriate

### Adding a New Keyboard Shortcut

1. Add to `src/shortcuts/shortcuts.ts`
2. Register in `src/shortcuts/ShortcutProvider.tsx`
3. Document in README.md

---

## What to Avoid

1. **Never link to ffmpeg** — Always subprocess. This keeps us LGPL-compliant.

2. **Never block the main thread** — Long operations go in Web Workers or main process.

3. **Never mutate Redux state directly** — Always use Immer-powered reducers.

4. **Never hardcode ffmpeg paths** — Use the runner abstraction.

5. **Never assume capabilities exist** — Always check the capability index; ffmpeg builds vary.

6. **Never skip the pseudo-GUI fallback** — Every capability must be accessible somehow.

7. **Never assume bash** — Dev environment is PowerShell. Use cross-platform npm scripts where possible.

8. **NEVER auto-scale clips to fit sequence** — Source resolution and sequence resolution are independent. A 480p clip in a 1080p sequence shows pillarboxes, not stretched video. Use `pad` filter to position clips, never `scale` automatically. See the "CRITICAL: Source Resolution vs Sequence Resolution" section above.

---

## Useful ffmpeg Commands Reference

```bash
# List all filters with descriptions
ffmpeg -filters

# Get detailed help for a filter
ffmpeg -h filter=rotate

# List all codecs
ffmpeg -codecs

# List all formats
ffmpeg -formats

# Get video info
ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 input.mp4

# Generate thumbnail
ffmpeg -i input.mp4 -ss 00:00:05 -vframes 1 thumb.png

# Generate proxy
ffmpeg -i input.mp4 -vf "scale=iw/2:-2" -c:v libx264 -preset ultrafast -crf 23 proxy.mp4

# Concatenate clips (simple)
ffmpeg -f concat -safe 0 -i list.txt -c copy output.mp4

# Complex filter graph template
ffmpeg -i in1.mp4 -i in2.mp4 -filter_complex "[0:v][1:v]overlay[out]" -map "[out]" output.mp4
```

---

## Testing Checklist

Before marking a feature complete:

- [ ] Works with various input formats (mp4, mov, mkv, webm)
- [ ] Works with various resolutions (720p, 1080p, 4K)
- [ ] Works with various frame rates (24, 30, 60 fps)
- [ ] **Mismatched resolutions display correctly** — e.g., 480p clip in 1080p sequence shows pillarboxes, NOT stretched/scaled
- [ ] Undo/redo works correctly
- [ ] Preview updates correctly
- [ ] Export produces correct output
- [ ] No console errors
- [ ] Memory doesn't leak on repeated operations

---

## Version Targets

| Version | Milestone | Key Features |
|---------|-----------|--------------|
| 0.1 | The Razor Blade | Import, cut, export |
| 0.2 | Multi-Track | Unlimited tracks, layering |
| 0.3 | Transitions | Cross-dissolve, fades |
| 0.4 | Color & Audio | Basic correction, gain, normalization |
| 0.5 | Titles | Text generator, lower thirds |
| 0.6 | Keyframing | Animate properties over time |
| 0.7 | Organization | Markers, subclips, edit modes |
| 0.8 | Performance | GPU encoding, smart caching |
| 0.9 | Polish | Shortcuts, layouts, recovery |
| 1.0 | Release | Installer, docs, stability |

---

## Questions to Ask When Stuck

1. "What would Premiere do here?" — Match expectations
2. "What's the ffmpeg command for this?" — Start from the CLI
3. "Can Command Crafter handle this?" — Fallback is always available
4. "Does this need to be in Redux?" — Only if it affects the project file or undo
5. "Is this blocking the main thread?" — Move to worker/main process if so
