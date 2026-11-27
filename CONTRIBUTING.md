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

For platform-specific toolchain prerequisites, see the [README development prerequisites](README.md#development-prerequisites).

```bash
npm ci
npm run setup
npm run doctor
npm run dev
```

Before submitting changes, run the same checks as CI:

```bash
npm run test:release-tools
npm test
npm run test:coverage
npm run typecheck
npm run frontend:build
npm run rust:test
npm run rust:fmt
npm run rust:check
npm run build:app
```

For manual GitHub releases, follow [docs/RELEASING.md](docs/RELEASING.md). Do not create or push release tags locally as a substitute for the validated workflow.
