# Roadmap

## Milestone 0 - Repository / desktop skeleton
- GitHub-ready repo.
- Angular + Tauri.
- IPC proof.
- npm setup/dev/build/release/feedback commands.

## Milestone 1 - Playback foundation
- Native audio decode/output.
- play/pause/stop/seek.
- output-device selection.
- production clock suitable for loops/chords/MIDI.

## Milestone 2 - Essentia analysis
- local Essentia.js/WASM worker.
- BPM + beat timestamps.
- tuning cents.
- major/minor beat-aligned chords.
- loudness measurement.

## Milestone 3 - Waveform/chord timeline
- accurate visual synchronization.
- chord editing.
- current/next chord.

## Milestone 4 - Portable sidecars
- content hash.
- load/save schema v1.
- moved-file relocation with fingerprint check.

## Milestone 5 - Practice
- count-in.
- loops.
- speed 25%+ with pitch preservation.
- Signalsmith transpose/tuning correction.
- inverse-transpose chord editing.

## Milestone 6 - Prepared audio
- current chosen transpose/tuning render.
- stale render validation.

## Milestone 7 - Playlist / Live
- drag reorder.
- validation.
- Locate File.
- per-song count-in.
- sequential playback.
- perceived loudness normalization.

## Milestone 8 - MIDI
- output enumeration.
- Program Change / CC / raw bytes.
- Send Test.
- beat/chord anchoring.
- signed offset.
- disconnect warning.
- later SysEx/device profiles.

## Milestone 9 - Regional analysis correction
- select waveform region.
- re-analyze beats/chords/both.
- merge without casually discarding user edits.

## Milestone 10 - Hardening/release
- long playlists.
- malformed/missing files.
- device changes.
- memory/CPU tests.
- portable release workflow.
