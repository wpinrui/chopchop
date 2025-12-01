# ChopChop v0.1 - Current Status

## ✅ Completed Features

### 1. Project Infrastructure
- ✅ Electron + React + Redux + Vite setup
- ✅ TypeScript configuration
- ✅ CommonJS/ESM module compatibility fixed
- ✅ Development environment configured

### 2. FFmpeg Integration
- ✅ **runner.ts** - Subprocess management for ffmpeg/ffprobe
- ✅ **probe.ts** - Media analysis and thumbnail generation
- ✅ Progress tracking for long operations
- ✅ Safe error handling

### 3. Electron IPC Layer
- ✅ Media import file dialog
- ✅ Media probing (metadata extraction)
- ✅ File system operations (read/write)
- ✅ Save dialog
- ✅ Secure preload script with contextBridge

### 4. Redux Store
- ✅ **projectSlice** - Project metadata, settings, media bin
- ✅ **timelineSlice** - Tracks, clips, playhead, markers
- ✅ **uiSlice** - Selections, tools, panels
- ✅ **previewSlice** - Playback state, chunks, render queue
- ✅ **historySlice** - Undo/redo state management
- ✅ **ffmpegSlice** - FFmpeg capabilities cache

### 5. UI Components
- ✅ **App** - Main layout with Premiere-style panels
- ✅ **MediaBin** - Import and display media with thumbnails
- ✅ Dark theme matching Premiere Pro
- ✅ Responsive panel layout

## 🚧 In Progress / To Do (v0.1)

### Next Up
- [ ] **Timeline Component** - Track and clip visualization
- [ ] **Viewer Component** - Video preview with playback
- [ ] **Playback Controls** - Play, pause, scrub
- [ ] **Razor Tool** - Split clips at playhead
- [ ] **Ripple Delete** - Delete clips and close gaps
- [ ] **Export System** - Render to MP4 with progress
- [ ] **Keyboard Shortcuts** - C, V, Delete, Space, Ctrl+Z, etc.
- [ ] **Undo/Redo** - Functional history system

## 🎯 How to Run

### Prerequisites
1. Download FFmpeg binaries:
   - Visit: https://www.gyan.dev/ffmpeg/builds/
   - Download "ffmpeg-release-essentials.zip"
   - Extract `ffmpeg.exe` and `ffprobe.exe`
   - Place in: `resources/ffmpeg/`

### Development
```bash
npm run dev
```

This will:
1. Start Vite dev server
2. Build Electron main/preload processes
3. Launch the Electron app
4. Enable hot module reloading

### What Works Now
- ✅ App launches with Electron
- ✅ Dark themed UI loads
- ✅ Media Bin shows with import button
- ✅ Can import media files (once ffmpeg is installed)
- ✅ Thumbnails generate and display
- ✅ Metadata shows (resolution, duration, file size)

## 📁 Project Structure

```
chopchop/
├── electron/
│   ├── main.ts              ✅ Main process + IPC handlers
│   ├── preload.ts           ✅ Security bridge
│   └── ffmpeg/
│       ├── runner.ts        ✅ Subprocess management
│       └── probe.ts         ✅ Media analysis
├── src/
│   ├── App.tsx              ✅ Main app component
│   ├── types.ts             ✅ TypeScript definitions
│   ├── store/               ✅ Redux slices (6 total)
│   └── components/
│       └── MediaBin/        ✅ Media import & display
├── resources/ffmpeg/        ⚠️  Need to add binaries
├── package.json             ✅ Dependencies configured
├── vite.config.ts           ✅ Build configuration
└── tsconfig.json            ✅ TypeScript settings
```

## 🐛 Known Issues

- ⚠️ FFmpeg binaries not included (must download separately)
- ⚠️ Timeline not yet implemented
- ⚠️ No video playback yet
- ⚠️ No export functionality yet

## 📝 Notes

- Removed `"type": "module"` from package.json to fix Electron CommonJS compatibility
- Changed dev script to use `.cjs` extension
- vite-plugin-electron now correctly generates CommonJS for main/preload
- All IPC calls are type-safe via TypeScript
