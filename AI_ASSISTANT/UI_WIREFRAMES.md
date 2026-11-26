# Base UI wireframes

The implemented Angular shell is intentionally based on these low-fidelity layouts.

## Practice

```text
+------------------------------------------------------------------+
| PRACTICE - Song                                      [Add to Live]|
+------------------------------------------------------------------+
| waveform + playhead                                              |
| ~~~~~~~~|~~~~~~~~~~~~~~~~~~~~~~~~~~~~                            |
|                                                                  |
| | C | C | Am | F | G | ...                                     |
+------------------------------------------------------------------+
| Current: Am       Next: F       BPM: 124      Transpose: +1      |
+------------------------------------------------------------------+
| Play | Speed 75% +/-5 | Transpose +/- | Count-in 3 clicks        |
| Loop start/end | start/end trim points                           |
+------------------------------------------------------------------+
```

## MIDI editor

```text
+-------------------------------------------------------+
| Anchor: Am / beat 73                                  |
| Device: Boss GX-100                                   |
| Type: Program Change                                  |
| Channel: 1      Program: 12                           |
| Offset: -120 ms                                       |
| [Send Test]                             [Save]         |
+-------------------------------------------------------+
```

## Live

```text
+------------------------------------------------------------------+
| LIVE - Song A                                         1 / 12      |
|                                                                  |
|                         Am                                       |
|                      Next: F                                     |
|                                                                  |
| C        Am       F        G                                     |
|          ^                                                       |
+------------------------------------------------------------------+
| Pause | Stop | Next song | MIDI status | Audio device            |
+------------------------------------------------------------------+
```

Principles:
- large readable chords in Live;
- Practice may be denser/editable;
- warnings never obscure current chord;
- same Song entity is shared between modes.
