# NonstopMaker Lite

A local-first DJ set builder for arranging music, estimating BPM/key/energy, previewing transitions, and rendering MP3 mixes. Audio files are processed on your device and are never uploaded. No sample music or demo audio is bundled.

## Run locally

Requires Node.js 22 (Electron packaging requires Node 22.12 or newer).

```sh
npm ci
npm run dev
```

Open the Vite URL and choose **Mở demo** to preview the interface with synthetic metadata, or import local audio files/folders. Demo tracks contain metadata only and cannot be analyzed or rendered.

## Text size / khả năng đọc

The interface previously used hard-coded 5–8px text that could not be enlarged. Every size is now a scalable token:

- Base sizes: 12px labels, 13px secondary text, 14px body, 15px titles — readable without zooming.
- **Font size control** in the app bar (the `A−` / `A+` buttons) switches between **Nhỏ 90%**, **Vừa 100%**, **Lớn 115%** and **Rất lớn 130%**. The choice is saved in `localStorage` and restored on the next visit.
- Tokens use `max(12px, …)` floors, so even the smallest labels stay legible at 90%.
- Layouts reflow instead of clipping: the app bar wraps, table cells wrap, and the workflow nav shrinks to dots on narrow screens.

The presets, persistence and storage fallbacks live in `src/nonstopmaker/fontScale.js` with unit tests.

## Progress tracking

Every step shows a percentage so long imports and renders are easy to follow:

- **App bar** — each of the four steps carries its own `%` and a mini bar, plus one overall `%` for the whole flow. Steps you have not reached yet stay at 0%.
- **Step card** — under the app bar, the current step shows its `%`, a checklist of what is already done (for example "Có bài trong set", "Có BPM / tone"), and the next item to finish.
- **Live work** — BPM/key analysis and MP3 rendering stream their own percentage, phase label, and current track name while they run.
- **Failure safety** — a render error shows a recovery card instead of a blank screen.

Progress rules live in `src/nonstopmaker/progress.js` with unit tests, so the header, the step card, and the tests cannot drift apart.

## Workflow

1. Choose local audio files/folders and set target duration, mood, and styles.
2. Arrange tracks, search, select, reorder, analyze BPM/key, and sort by compatibility.
3. Preview and edit the set timeline, crossfade, and optional RMS normalization.
4. Render a local MP3 or export an M3U playlist / JSON mix plan.

## DJ mixing engine

The renderer no longer just concatenates tracks. Each mix runs through a real
DJ chain (`src/nonstopmaker/djDsp.js`, unit tested):

| Skill | What it does | Toggle |
|---|---|---|
| **Beat grid** | Detects onsets, estimates the downbeat by scoring the four phases of a 4/4 bar | automatic |
| **Tempo sync** | Pulls the incoming track onto the outgoing BPM by resampling; refuses gaps wider than ±6% to keep vocals natural | `Tempo sync (±6%)` |
| **Beat-align** | Starts the crossfade on a bar boundary and rounds its length to whole bars | `Beat-align tự động` |
| **Bass swap / EQ 3 band** | Splits into low/mid/high, closes the outgoing lows before opening the incoming ones so two basslines never sum into mud | `Bass swap (EQ 3 band)` |
| **Cue points** | Automatic mix-in on the first bar after 16 beats, plus manual in/out sliders per track | `Điểm vào tự động` / sliders |
| **RMS normalize** | Levels every track before it enters the mix | `Tự cân bằng âm` |

Verified end to end: a 128 BPM track mixed into a 124 BPM set measures
**123.8 BPM** in the rendered MP3 with tempo sync on, and **128.4 BPM** with it
off. The render screen shows a per-track report (BPM, applied tempo ratio, cue
window, bass swap) and the same data is written into the JSON mix plan.

Limitations: tempo sync resamples, so pitch shifts with tempo (no key lock), and
the beat grid assumes 4/4. Tracks without a BPM estimate are joined at their
native tempo.

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
