# ChopChop Setup Guide

## Initial Setup Complete! ✅

The project structure has been initialized with:
- ✅ Electron main process
- ✅ React + Redux renderer process
- ✅ TypeScript configuration
- ✅ Vite build system
- ✅ Basic app layout
- ✅ All dependencies installed

## Project Structure

```
chopchop/
├── electron/              # Main process
│   ├── main.ts           # Electron app entry
│   └── preload.ts        # IPC bridge
├── src/                  # Renderer process (React)
│   ├── store/            # Redux slices
│   ├── App.tsx           # Main app component
│   ├── main.tsx          # React entry point
│   └── types.ts          # TypeScript types
├── scripts/
│   └── dev.js            # Dev server script
├── package.json
├── vite.config.ts
└── tsconfig.json
```

## Running the App

To start the development server:

```bash
npm run dev
```

This will:
1. Start Vite dev server
2. Compile Electron main process
3. Launch the Electron app
4. Enable hot module reloading

## Next Steps

According to the v0.1 roadmap, here are the next features to implement:

1. **Media Import** - File dialog and media parsing with ffprobe
2. **Timeline** - WebGL timeline renderer with clip visualization
3. **Playback** - Preview system with ffmpeg
4. **Editing** - Razor tool, ripple delete
5. **Export** - Export to mp4 with progress tracking

## Available Scripts

- `npm run dev` - Start development mode
- `npm run build` - Build for production
- `npm run build:electron` - Build only Electron main process
- `npm run package` - Create installer
- `npm run lint` - Run ESLint
- `npm run type-check` - Check TypeScript types

## Notes

- The app uses **npm** instead of pnpm (pnpm not available in current environment)
- Some npm warnings about deprecated packages are expected and can be ignored
- The `.npmrc` file contains pnpm-specific configs that npm will ignore
