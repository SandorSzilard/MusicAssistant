# Portable data formats

## Song sidecar: `.masidecar`

The app stores per-song data as JSON beside the source audio:

```text
<source-audio-path>.masidecar
```

Schema version 1 includes an audio identity, analysis results, and user edits. The loader accepts the supported schema only when `audioIdentity.sha256` matches the source file's SHA-256 fingerprint. Missing, unreadable, unsupported, or mismatched sidecars are treated as unusable. Source audio is never modified.

```json
{
  "schemaVersion": 1,
  "audioIdentity": {
    "sha256": "<source-audio-sha256>",
    "fileNameHint": "Song.mp3"
  },
  "analysis": {
    "beats": [],
    "chords": [],
    "detectedTuningHz": null
  },
  "userEdits": {
    "transposeSemitones": 0,
    "midiEvents": [],
    "countInEnabled": false,
    "countInClicks": 4,
    "sourceTuningHz": null,
    "tuningCorrectionEnabled": false,
    "tuningCorrectionCents": 0
  }
}
```

The analysis object can include BPM, tuning, loudness, key, waveform peaks, beats, and chords. User edits include transpose and tuning correction, START/END boundaries, count-in, MIDI events, named sections, and tempo multiplier. Beat and chord records retain canonical source-song timing and pitch.

## Playlist/set file: `.musicassistant`

Live playlists are stored as portable JSON files using schema version 1 and `type: "playlist"`. The file contains playlist settings and entries plus references to songs, including their fingerprints and source paths. Song audio and sidecars remain separate files.
