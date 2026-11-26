# Portable data formats - draft v1

## Song sidecar

Suggested filename:

```text
Song.mp3
Song.mp3.musicassistant.json
```

Draft structure:

```json
{
  "schemaVersion": 1,
  "audioIdentity": {
    "sha256": "...",
    "fileNameHint": "Song.mp3"
  },
  "analysis": {
    "bpm": 120.0,
    "tuningCents": 0.0,
    "loudnessLufs": -14.2,
    "beats": [],
    "chords": []
  },
  "userEdits": {
    "transposeSemitones": 1,
    "startSeconds": 0.0,
    "endSeconds": null,
    "midiEvents": []
  }
}
```

Practice speed and current loop selection are intentionally not canonical song metadata.
