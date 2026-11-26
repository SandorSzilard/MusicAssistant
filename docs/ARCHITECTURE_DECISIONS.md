# Architecture Decisions

## ADR-001 - Angular frontend
Status: accepted.

Use Angular + TypeScript for structured UI, services, state and worker integration.

## ADR-002 - Tauri/Rust desktop/backend direction
Status: accepted for first implementation; validate through early builds.

## ADR-003 - Essentia.js/WASM analysis
Status: accepted.

Bundle locally. Pin a version. Automatic chords remain major/minor; richer user chords are independent of detector vocabulary.

## ADR-004 - Signalsmith Stretch
Status: accepted.

Use for independent time-stretch and pitch shift, including fractional-semitone tuning correction.

## ADR-005 - Immutable source audio
Status: accepted.

Never rewrite original MP3/WAV.

## ADR-006 - Original-reference canonical chords
Status: accepted.

Displayed transpose is a reversible view transformation. Inverse-transpose edited chords before storing.

## ADR-007 - Beat-based timeline
Status: accepted.

Store actual beat timestamps; do not require time-signature inference.

## ADR-008 - MIDI anchor + offset
Status: accepted.

MIDI event = chord/beat anchor + signed millisecond offset. Timing-sensitive execution belongs to backend/playback service.

## ADR-009 - MIDI is optional
Status: accepted.

Missing/disconnected MIDI must not stop audio.

## ADR-010 - Portable user data
Status: accepted.

Sidecars/playlists are authoritative portable data. Internal indexes/caches are disposable.

## ADR-011 - Playlist loudness normalization
Status: accepted.

Apply non-destructive perceived-loudness compensation without DJ mixing behavior.
