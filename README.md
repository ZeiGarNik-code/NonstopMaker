# NonstopMaker Lite

A local-first DJ set builder for arranging music, estimating BPM/key/energy, previewing transitions, and rendering MP3 mixes. Audio files are processed on your device and are never uploaded. No sample music or demo audio is bundled.

## Run locally

Requires Node.js 22 (Electron packaging requires Node 22.12 or newer).

```sh
npm ci
npm run dev
```

Open the Vite URL and choose **Mở demo** to preview the interface with synthetic metadata, or import local audio files/folders. Demo tracks contain metadata only and cannot be analyzed or rendered.

## Workflow

1. Choose local audio files/folders and set target duration, mood, and styles.
2. Arrange tracks, search, select, reorder, analyze BPM/key, and sort by compatibility.
3. Preview and edit the set timeline, crossfade, and optional RMS normalization.
4. Render a local MP3 or export an M3U playlist / JSON mix plan.

## Local analysis and rendering

- Audio is decoded with the Web Audio API and analyzed in Web Workers. Source files remain local.
- BPM, musical-key/Camelot, and energy are estimates. BPM and energy use up to 120 seconds; key detection uses up to 75 seconds.
- Analysis is limited to 200 MB per file. Browser decoder support varies; MP3, WAV, FLAC, M4A, and AAC are commonly supported.
- MP3 rendering supports 128, 192, or 256 kbps, beat-aware equal-power crossfades, and optional RMS normalization. It is not time-stretching or full DJ beatmatching.
- Rendering limits: 120 MB per track, 15 minutes per track, and 120 minutes per set. Long mixes can use substantial memory.

## Windows desktop

The Electron wrapper loads the UI using a secure local protocol with Node integration disabled. On Windows, run:

```sh
npm ci
npm run package:win
```

The `release/` folder contains the NSIS installer and portable executable. GitHub Actions runs tests and creates the same packages. Add the repository Actions secrets `WINDOWS_CSC_PFX_BASE64` (base64-encoded signing PFX) and `WINDOWS_CSC_KEY_PASSWORD` to enable Authenticode signing. If either secret is unavailable, the workflow builds unsigned executables. Never commit a certificate or password.

## Tests and builds

```sh
npm test
npm run build
npm run build:desktop
```

Local audio and rendered files are excluded from version control. The 2.66 GB demo audio is not included in the source tree, app shell, or Windows package.
