# ChopChop

A free, open-source video editor for Windows that wraps a Premiere-style interface around ffmpeg. Built with Electron, React, Redux, and WebGL.

## Philosophy

- **Familiar**: If you know Premiere, you know ChopChop
- **Honest**: Every edit is an ffmpeg command — no magic, no lock-in
- **Complete**: Access 100% of ffmpeg's power from day one (polished GUI → pseudo-GUI fallback)
- **Iterative**: Each version is shippable; features arrive polished, never half-baked

## Current Status

**Version: 0.1.0 (In Development)**

See [ROADMAP.md](./ROADMAP.md) for the full version plan.

## Features

### Implemented (GUI)

- [ ] Media import (mp4, mov, mkv, webm, mp3, wav)
- [ ] Single video/audio track timeline
- [ ] Razor tool (split clips)
- [ ] Ripple delete
- [ ] Export to mp4 (H.264 + AAC)
- [ ] Proxy workflow

### Always Available (Pseudo-GUI Fallback)

Every ffmpeg filter, codec, format, and option is searchable and usable via the **Command Crafter** panel. Type keywords to find capabilities, then build commands with guided dropdowns and flag pickers. The app executes them for you.

## Tech Stack

| Layer | Technology |
|-------|------------|
| Shell | Electron |
| UI | React 18 |
| State | Redux Toolkit |
| Timeline Rendering | WebGL (via custom canvas) |
| Video Backend | ffmpeg (subprocess) |
| Language | TypeScript |
| Build | Vite |
| Package Manager | pnpm |

## Getting Started

### Prerequisites

- Node.js 20+
- pnpm 8+
- Windows 10/11

### Installation

```bash
# Clone the repo
git clone https://github.com/yourusername/chopchop.git
cd chopchop

# Install dependencies
pnpm install

# Download ffmpeg (automated script)
pnpm run setup:ffmpeg

# Start development
pnpm run dev
```

### Building for Production

```bash
pnpm run build
pnpm run package  # Creates installer in /dist
```

## Project Structure

```
chopchop/
├── electron/                 # Main process
│   ├── main.ts
│   ├── preload.ts
│   └── ffmpeg/
│       ├── runner.ts         # Subprocess management
│       ├── graphBuilder.ts   # Filter graph generation
│       └── capabilities.ts   # Parses ffmpeg -filters, -codecs, etc.
├── src/                      # Renderer process (React)
│   ├── App.tsx
│   ├── components/
│   │   ├── Timeline/         # WebGL timeline renderer
│   │   ├── MediaBin/
│   │   ├── Viewer/
│   │   ├── Inspector/
│   │   └── CommandCrafter/   # Pseudo-GUI for raw ffmpeg
│   ├── store/                # Redux
│   │   ├── index.ts
│   │   ├── projectSlice.ts
│   │   ├── timelineSlice.ts
│   │   └── undoMiddleware.ts
│   ├── ffmpeg/
│   │   └── capabilities.json # Cached ffmpeg capability index
│   └── webgl/
│       ├── TimelineRenderer.ts
│       └── shaders/
├── resources/
│   └── ffmpeg/               # Bundled ffmpeg.exe + ffprobe.exe
├── scripts/
│   └── setup-ffmpeg.js       # Downloads ffmpeg on first run
└── docs/
```

## Architecture

### Data Flow

```
User Action → Redux Dispatch → State Update → React Re-render
                                    ↓
                            Filter Graph Engine
                                    ↓
                              ffmpeg subprocess
                                    ↓
                            Preview Cache / Export
```

### Project File Format

Projects are saved as `.chopchop` files (JSON):

```json
{
  "version": "0.1.0",
  "name": "My Project",
  "settings": {
    "resolution": [1920, 1080],
    "frameRate": 30,
    "proxyEnabled": true
  },
  "media": [...],
  "timeline": {
    "tracks": [...],
    "markers": [...]
  }
}
```

### Preview System

ChopChop uses **chunked pre-rendering** for preview playback:

1. Timeline divided into 2-second chunks
2. Edits invalidate only affected chunks
3. Background workers render chunks to temporary files
4. Viewer plays from cache

### ffmpeg Capability System

On first launch, ChopChop runs:
- `ffmpeg -filters` → parses all filters with descriptions
- `ffmpeg -codecs` → parses all codecs
- `ffmpeg -formats` → parses all formats
- `ffmpeg -h filter=<name>` → fetches detailed options per filter

This builds a searchable index stored in `capabilities.json`, enabling:
- Keyword search ("rotate", "blur", "denoise")
- Tag-based filtering (video, audio, encoding, filtering)
- Auto-complete for flags and parameters

## Keyboard Shortcuts

| Action | Key |
|--------|-----|
| Play/Pause | Space |
| Razor at playhead | C |
| Select tool | V |
| Delete selection | Delete |
| Undo | Ctrl+Z |
| Redo | Ctrl+Shift+Z |
| Export | Ctrl+E |
| Save | Ctrl+S |
| Command Crafter | Ctrl+Shift+C |

## Contributing

ChopChop is open source under the MIT license. Contributions welcome!

1. Fork the repo
2. Create a feature branch (`git checkout -b feature/amazing-thing`)
3. Commit your changes
4. Push to your branch
5. Open a Pull Request

### Development Notes

- This project is primarily **vibe-coded** with AI assistance
- See `claude.md` for AI coding guidelines and context
- Keep ffmpeg as a subprocess (never link) to maintain LGPL compliance

## License

MIT License — see [LICENSE](./LICENSE)

**Note:** ffmpeg is LGPL/GPL. ChopChop calls it as a subprocess (no linking), which is LGPL-compliant. We bundle an LGPL build without GPL codecs.

## Acknowledgments

- [ffmpeg](https://ffmpeg.org/) — the backbone of this entire project
- Adobe Premiere Pro — UI/UX inspiration
- The open source community
