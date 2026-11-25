# Vizzy Studio 2.0 (macOS Intel)

Professional music visualizer and lyric-video maker. Works offline. Built for Intel Macs (macOS 10.15 / 11 and newer).

## Build the DMG on GitHub (no Terminal needed)
1. Create a new GitHub repository and upload **all files and folders of this project** (keep the `.github/workflows/build-dmg.yml` path exactly).
2. Open the repo -> **Actions** tab -> **Build Vizzy Studio DMG (Intel)** -> **Run workflow**.
3. Wait about 10-15 minutes. Open the finished run -> **Artifacts** -> download **Vizzy-Studio-DMG**.
4. Open the DMG, drag the app to Applications. Because the app is not code-signed, the first time use **right-click -> Open -> Open**.

The workflow also compiles the open-source **whisper.cpp** speech engine and bundles it inside the app.

## What is inside
* **Magic Video** - pick a song (+ optional cover), a style and lyrics mode; the whole video is built for you.
* **40+ templates**: visualizers, lyric motion-graphics (karaoke, typewriter, kinetic, stacked, cinematic...), social formats (9:16, 1:1, 4:5).
* **13 visualizers**, 6 particle systems, 10 effects, video overlays/backgrounds, shapes, images, text with 20+ animations and filters.
* **AI lyrics (Whisper, 100% local)**: generate lyrics automatically in 50+ languages (including Arabic, RTL supported) or paste your lyrics and let AI sync every word to the audio. Models: Tiny / Base / Small / Large-v3-Turbo. A model downloads once on first use (internet needed once), then everything works offline.
* **Audio intelligence**: tempo (BPM), key, loudness, dynamic range, song sections; beat grid and sections shown on the timeline; one-click flash effects at section changes.
* **Palette from artwork**: recolor the whole project to match the cover.
* **Timeline**: drag/trim clips, waveform scrub, beat markers, lyric tap-sync, undo/redo (100 steps), autosave & session recovery.
* **Export**: H.264, H.265, ProRes; 480p to 4K; 24-60 fps; time range; loudness normalize; fade in/out; several aspect ratios in one go; PNG frame export.
* Preview quality, safe-area guides (G), loop, copy/paste/duplicate layers, layer lock, custom font import (.ttf/.otf).

## Shortcuts
Space play/pause - arrows seek (Shift = 5 s) - Cmd+C/V/D copy/paste/duplicate layer - Delete remove layer - Cmd+Z / Shift+Cmd+Z undo/redo - G guides - Shift+Cmd+M Magic Video.

## If AI lyrics say "Whisper engine not found"
The workflow step that compiles Whisper is optional. If it failed, install it once with Homebrew: `brew install whisper-cpp`, then restart the app.
