# FFmpeg Binaries

ChopChop requires ffmpeg and ffprobe executables to function.

## For Development

1. Download FFmpeg from: https://www.gyan.dev/ffmpeg/builds/
   - Get the "ffmpeg-release-essentials.zip" build

2. Extract the following files to this directory:
   - `ffmpeg.exe`
   - `ffprobe.exe`

The files should be placed at:
```
resources/ffmpeg/ffmpeg.exe
resources/ffmpeg/ffprobe.exe
```

## For Production

The installer will bundle these executables automatically.

## Why These Aren't Included

FFmpeg binaries are ~100MB and are excluded from git to keep the repository lightweight.
They are also LGPL licensed, which has different distribution requirements.
