# Piano-Player

Open-source piano companion to follow along with your favorite songs on a sleek, stage-ready UI. Built for concerts, worship, and practice.

## How It Works (High Level)

1. **Add Song** – Upload MP3 (from YouTube via `yt-dlp` locally, then upload) or drop a demo track. File stays on-device via IndexedDB for offline mobile use.
2. **Get Notes** – Phase 1: import MIDI or auto-detect beats/onsets for a guide track. Phase 2: client-side AI transcription (Spotify Basic Pitch ONNX) to MIDI for piano notes.
3. **Follow Along** – Synthesia-style falling notes over an 88-key keyboard synced to audio using Web Audio clock. Controls: play/pause, 0.5x-1.25x speed (pitch-preserved), loop section, transpose, wait-to-play mode.
4. **Perform** – Stream audio to PA/Bluetooth while notes fall. Stage Mode: high-contrast dark UI, huge controls, locked orientation. Works as installable PWA on mobile/desktop.

```
MP3 upload -> [Transcribe: beats now, Basic Pitch next] -> MIDI/notes
                                                          |
Audio (Web Audio) <--sync clock--> Canvas Piano-Roll (falling notes) --> Keyboard
                                                          |
                                              Library (IndexedDB, offline PWA)
```

## Use Cases

- **Concerts:** Setlists, Stage Mode, Bluetooth/PA out, low-latency canvas.
- **Worship/Religious:** Large-text chords, setlists, quick key transpose, offline reliability.
- **Practice:** Slow-down, loop bars, wait mode (song pauses until you hit right note), left/right hand split.

## Stack (V0.1 live)

- **PWA Web App:** Vite + React + TypeScript + `vite-plugin-pwa` (installable, offline)
- **Audio:** HTMLAudio + Web Audio clock, playbackRate 0.5x-1.25x, PA/Bluetooth out via setSinkId
- **Piano UI:** Canvas falling-notes + keyboard, `@tonejs/midi` for MIDI upload
- **Transcription:** demo pattern now, Basic Pitch ONNX next (your priority), `scripts/download.sh` via yt-dlp helper (bring your own downloads, respect copyright/YouTube ToS)
- **Storage:** IndexedDB (`idb-keyval`)

## Quick Start (V0.1 done)

```bash
npm install
npm run dev
```

1. `npm run dev` – upload MP3, see falling demo notes synced to `audio.currentTime`.
2. Install as PWA on phone: Share/Add to Home Screen.
3. `./scripts/download.sh "https://www.youtube.com/watch?v=8y7Kednwa-M"` – needs yt-dlp + ffmpeg, then upload MP3 (do not redistribute copyrighted audio).

## Roadmap

- [x] V0.1: MP3 upload + Synthesia demo notes + speed/transpose + PWA install + Stage Mode shell + setlist
- [ ] V0.2: loop section, wait mode, MIDI auto-align, worship chord view
- [ ] V0.3: Basic Pitch auto-transcribe in-browser (your next priority)

## Note on YouTube MP3s

Download only content you own/have rights to. YouTube ToS restricts downloading; prefer official audio, stems, or licensed MP3s you own. App accepts any MP3/MIDI you provide.
