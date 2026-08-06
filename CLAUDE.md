# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run build          # TypeScript compilation (tsc)
npm run dev            # Watch mode compilation
npm test               # Run all tests (vitest run)
npm run test:watch     # Watch mode tests
npx vitest src/switch  # Run a single test file
```

There is no lint/format step configured. The project uses pnpm as its package manager (pnpm-lock.yaml).

## Architecture

Jarvis is a single-package CLI published as `@aiszlab/jarvis` (bin: `jrv`). It wraps six independent commands via Commander.js:

- **`changesets`** (`cs`) — Thin proxy to `@changesets/cli/bin.js`, resolved at runtime via `createRequire`. Supports `-v` (version) and `-m` (auto-generate message) flags.
- **`setup`** — Bootstraps a dev environment: globally installs pnpm and `@anthropic-ai/claude-code`, scaffolds `.jarvis/settings.json` + adds `.jarvis/` to `.gitignore`, and installs shell integration (sources `jarvis.sh` into `~/.zshrc`/`~/.bashrc`).
- **`switch`** (`sw`) — Interactive prompt (Inquirer) to pick a platform/model preset and write env vars to `~/.claude/settings.json`. Merges with existing settings; inputs override presets, presets override existing file values. Model presets are defined as static data in `src/switch/index.ts`.
- **`remove`** (`rm`) — `rm -rf` equivalent via rimraf.
- **`kill`** (`k`) — Kills processes listening on a given port. Accepts an optional port argument; prompts interactively if omitted. Uses `lsof` on macOS/Linux and `netstat` on Windows to find PIDs.
- **`use`** — Interactive checkbox prompt to select environment variables from `.jarvis/settings.json` and output `export` statements to stdout. Requires shell integration: `jarvis.sh` defines a `jrv()` shell function that wraps `jrv use` with `eval`, so exported vars land in the current shell.

Entry point: `src/index.ts` → compiles to `dist/index.js` (NodeNext module resolution). Each command's implementation lives in `src/<command>/index.ts`. Shell integration lives in `jarvis.sh` at the package root. Tests use Vitest with vi.mock for fs, os, and inquirer dependencies.

## Testing conventions

- Test files live alongside source: `src/**/*.test.ts`
- Heavy use of `vi.hoisted()` for mocks that must be declared before dynamic imports
- Mock strategy: hoist mocks → `vi.mock()` → dynamic `import()` of module under test
