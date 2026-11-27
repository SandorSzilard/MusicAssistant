# Behavior contracts

These are regression guards for refactoring and future features. If a proposed change conflicts with a contract, stop and ask before changing product behavior.

## Source audio and portability

1. Never modify the source MP3/WAV.
2. Song identity is content-based (SHA-256), not filename-only.
3. `.masidecar` is the current song sidecar extension.
4. Sidecar schema/fingerprint mismatch must fail safely instead of silently applying wrong timing/data.
5. `.musicassistant` is the portable playlist/set format.
6. Core features must work offline.

## Analysis

1. Heavy Essentia work stays off the Angular UI thread.
2. Analysis failure must not make already-playable audio unusable.
3. Tuning detection happens before the tuning-dependent full analysis path.
4. Tuning correction is independent from musical transpose.
5. START/END are user-defined; loudness uses the selected usable song range.
6. Rapid START/END edits must not allow stale loudness jobs to overwrite the newest result.
7. Canonical beat/chord timing remains in source-song time.

## Chords/transposition

1. Canonical chords remain in original pitch.
2. Displayed chords reflect current transpose.
3. Manual edit entered in transposed view is inverse-transposed before saving.
4. Automatic chord vocabulary may stay intentionally limited while manual strings may be richer.

## Practice playback

1. Speed and pitch/tuning are independently controllable.
2. Count-in occurs before every newly started playback when enabled.
3. Section loops must not distort canonical song timing.
4. Practice `Analyze song` and `Save sidecar` remain permanent controls.

## Audio output

1. Current product behavior uses the operating-system default audio output.
2. Do not add a fake/incomplete WebView device picker.
3. A future explicit output-device architecture is a separate product/architecture decision.

## Live loudness

1. Matching is non-destructive.
2. Current target is the quietest valid analyzed playlist song.
3. Gain is attenuation-only (`<= 0 dB`); no song is boosted to reach the target.
4. Missing loudness data must degrade safely rather than block playback.

## MIDI

1. MIDI is optional; normal audio/chord operation does not require it.
2. MIDI failure/disconnect must not stop audio playback.
3. Supported event kinds currently include Program Change, Control Change and raw bytes.
4. Events are anchored to beat/chord timing and support signed offsets.
5. Per-event device overrides are allowed.
6. Per-device timing compensation must be applied identically in Practice and Live.
7. Effective trigger time is:

```text
anchorSeconds + (event.offsetMs + deviceTimingCompensationMs) / 1000
```

8. Missing selected devices are explicitly reported and selection is safely cleared/persisted.
9. MIDI events must survive sidecar save/reload.

## UI reliability

1. Performance pages (Practice/Live) must remain usable during background analysis where possible.
2. A MIDI/UI/analysis failure must not crash the entire application.
3. Do not reintroduce double page/container scrollbars that were already fixed.
4. MIDI labels/markers must not change chord cell width/timeline timing.
5. Context-menu START/END operations use the current playhead position, not the mouse pixel/time where the menu was opened.

## Regional analysis

1. Regional analysis uses canonical source-song seconds; UI/worker boundaries must not depend on mouse pixels.
2. Regional results never change tuning, transpose, START/END, loudness, sections or source audio.
3. Regional merge preserves analysis outside the selected region except for necessary beat/chord/MIDI reconciliation.
4. Manual chords inside the region are preserved and remapped to the nearest corrected beat when possible. Ambiguous remaps are reported rather than silently discarding the edit.
5. MIDI events are never silently dropped. In-region anchors are remapped by canonical timestamp to the nearest corrected beat/chord.
6. Regional jobs use generation/cancellation guards so stale worker results cannot update the song or sidecar.
7. Full-song `Analyze song` requests warn before starting when any chord has `userEdited === true`; cancellation leaves song and sidecar state unchanged.
8. Confirmed full-song analysis may replace manual chord edits with fresh automatic results. Regional analysis continues to use its separate preservation/remapping policy.

## Release/repository

1. No agent may push without explicit user approval.
2. Release automation may push its own version-bump commit/tag only when the user manually runs the approved release workflow.
3. A release must not be created unless quality gates pass.
