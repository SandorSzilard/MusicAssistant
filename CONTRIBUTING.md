# Contributing

Music Assistant is architecture-first and milestone-driven.

Before changing core behavior, read:

1. `docs/PROJECT_CONTEXT.md`
2. `docs/ARCHITECTURE_DECISIONS.md`
3. `docs/ARCHITECTURE.md`
4. `docs/ROADMAP.md`

## Pull requests

- Keep changes focused.
- Preserve source-audio immutability.
- Do not add mandatory cloud dependencies.
- Do not put MIDI on the critical playback path.
- Update Markdown architecture/product docs when behavior changes.
- Add or update an ADR for irreversible architectural decisions.
- Keep important persisted formats schema-versioned.

## Development

```bash
npm run setup
npm run doctor
npm run dev
```
