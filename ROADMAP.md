# ChopChop Roadmap

Each version is **fully polished and shippable**. Features arrive complete, never half-baked.

---

## v0.1 — The Razor Blade
> *"Import, cut, export."*

**Status:** 🚧 In Development

### Features
- [ ] Import media (mp4, mov, mkv, webm, mp3, wav)
- [ ] Single video track + single audio track
- [ ] Razor tool (split clips at playhead)
- [ ] Ripple delete
- [ ] Source and Program monitors
- [ ] Basic transport (play, pause, scrub)
- [ ] Export to mp4 (H.264 + AAC)
- [ ] Proxy generation on import (optional)
- [ ] Undo/redo (10 levels)
- [ ] Command Crafter (pseudo-GUI for all ffmpeg capabilities)

### Shortcuts
| Action | Key |
|--------|-----|
| Razor | C |
| Select | V |
| Delete | Delete |
| Undo | Ctrl+Z |
| Redo | Ctrl+Shift+Z |
| Export | Ctrl+E |
| Save | Ctrl+S |

---

## v0.2 — Multi-Track Foundation
> *"Layer your story."*

**Status:** 📋 Planned

### Features
- [ ] Unlimited video tracks
- [ ] Unlimited audio tracks
- [ ] Clip layering (upper tracks composite over lower)
- [ ] Track headers (visibility toggle, mute, lock)
- [ ] Clip opacity (video) in inspector
- [ ] Clip volume (audio) in inspector
- [ ] Track volume (audio)
- [ ] Snap to playhead
- [ ] Snap to clip edges

### Technical
- `overlay` filter for video stacking
- `amix` filter for audio mixing

---

## v0.3 — Transitions & Fades
> *"Smooth moves."*

**Status:** 📋 Planned

### Features
- [ ] Cross-dissolve (video)
- [ ] Audio crossfade
- [ ] Fade from black
- [ ] Fade to black
- [ ] Dip to white
- [ ] Transition duration drag-handle
- [ ] Transition preview in Program monitor

### Technical
- `xfade` filter for video transitions
- `afade` and `acrossfade` for audio

---

## v0.4 — Color & Audio Fundamentals
> *"Make it look and sound right."*

**Status:** 📋 Planned

### Features
- [ ] Per-clip color correction
  - Exposure
  - Contrast
  - Saturation
  - Temperature
  - Tint
- [ ] Audio gain (per-clip)
- [ ] Audio gain (per-track)
- [ ] Audio normalization on export (loudness target)
- [ ] Waveform visualization on audio clips
- [ ] Histogram in Program monitor (toggle)

### Technical
- `eq`, `colorbalance`, `curves` filters
- `loudnorm` filter for normalization

---

## v0.5 — Titles & Text
> *"Say something."*

**Status:** 📋 Planned

### Features
- [ ] Text generator clip type
- [ ] Font picker (bundled open-source fonts)
- [ ] Font size, color, alignment
- [ ] Background color/opacity
- [ ] Lower-thirds template
- [ ] Title safe guides (toggle)
- [ ] Fade in/out on text clips

### Technical
- `drawtext` filter
- Bundled fonts: Inter, Roboto, Roboto Mono, Open Sans

---

## v0.6 — Keyframing
> *"Animate everything."*

**Status:** 📋 Planned

### Features
- [ ] Keyframeable properties:
  - Opacity
  - Volume
  - Position X/Y
  - Scale
  - Rotation
- [ ] Keyframe editor in Inspector
- [ ] Easing curves (linear, ease-in, ease-out, bezier)
- [ ] Copy/paste keyframes
- [ ] Keyframe visualization on timeline clips

### Technical
- Generates ffmpeg expressions: `'if(between(t,0,2), lerp(0,1,(t-0)/2), 1)'`
- Complex expression builder for bezier easing

---

## v0.7 — Markers, In/Out, Subclips
> *"Organize your chaos."*

**Status:** 📋 Planned

### Features
- [ ] Timeline markers with labels
- [ ] Marker colors
- [ ] Source monitor in/out points
- [ ] Insert edit mode
- [ ] Overwrite edit mode
- [ ] Subclip creation in media bin
- [ ] Clip grouping
- [ ] Clip linking (audio/video sync)

---

## v0.8 — Performance & GPU
> *"Buttery smooth."*

**Status:** 📋 Planned

### Features
- [ ] GPU-accelerated encoding
  - NVIDIA NVENC
  - Intel Quick Sync (QSV)
  - AMD AMF
- [ ] GPU detection and auto-selection
- [ ] Background proxy generation queue
- [ ] Smart preview caching (invalidate only changed chunks)
- [ ] Memory usage monitoring
- [ ] Render queue for batch exports

### Technical
- `-c:v h264_nvenc`, `-c:v h264_qsv`, `-c:v h264_amf`

---

## v0.9 — Polish & Pro Features
> *"Ready for real work."*

**Status:** 📋 Planned

### Features
- [ ] Customizable keyboard shortcuts
- [ ] Workspace layouts (save/load)
- [ ] Default workspace presets
- [ ] Project auto-recovery
- [ ] Recent projects list
- [ ] Crash recovery
- [ ] Export presets (YouTube, Twitter, Instagram, custom)
- [ ] Preference sync (optional)

---

## v1.0 — Release
> *"ChopChop: Ready."*

**Status:** 📋 Planned

### Features
- [ ] Windows installer (NSIS or Electron Builder)
- [ ] Auto-updater
- [ ] Full documentation site
- [ ] Onboarding tutorial
- [ ] Community templates
  - Export presets
  - Title templates
  - Color presets
- [ ] Bug fixes and stability hardening
- [ ] Performance profiling and optimization

---

## Future Ideas (Post-1.0)

These are not committed, just possibilities:

- **Format conversion on import** — User-friendly dialog to transcode unsupported formats (ProRes, DNxHD, etc.) to H.264 via ffmpeg on import, with preview codec/quality options
- **macOS support** — Electron makes this feasible
- **Linux support** — Same as above
- **Plugin system** — Custom effects, exporters
- **Motion graphics** — Basic shape animations
- **Chroma key** — Green screen removal (ffmpeg `chromakey`)
- **Audio effects** — EQ, compression, reverb
- **Multi-cam editing** — Sync and switch between angles
- **Collaboration** — Project sharing, conflict resolution
- **Cloud export** — Render on remote machines

---

## Version History

| Version | Date | Notes |
|---------|------|-------|
| 0.1.0 | TBD | Initial release |
