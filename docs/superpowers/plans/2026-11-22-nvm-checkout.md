# nvm checkout Implementation Plan

> Implement inline with superpowers:executing-plans; use test-driven-development.

**Goal:** Safely install/select a Node version in the current shell with optional cleanup.
**Architecture:** Commander preflight, Bash/Zsh wrapper, hidden Node cleanup helper.
**Tech Stack:** TypeScript, Node fs/child_process, Vitest, nvm-sh.
**Spec:** docs/superpowers/specs/2026-11-22-nvm-checkout-design.md

## Constraints and review focus

Bilingual exported JSDoc; no new dependencies. Fail closed on inspection errors.
Tests must cover spaces/metacharacters, failed install/use/alias, other idle
shells, open files, symlinks, and selective cache cleanup. Never modify real nvm.

## Tasks

- [x] Add failing preflight and cleanup tests in src/nvm/index.test.ts using real
  temporary files and mocked child_process inspection/uninstall only.
- [x] Implement checkoutNvm(version, options) and pruneNvm() in src/nvm/index.ts;
  register public checkout and hidden prune in src/index.ts.
- [x] Add failing shell integration tests in src/nvm/shell.test.ts; run Bash/Zsh
  with fake CLI and nvm, assert PATH/default changes and no destructive step on failure.
- [x] Extend jarvis.sh with preflight, source, lock, install/use/verify/default,
  optional prune; preserve existing use forwarding. Fix package files entry.
- [x] Document setup, platform limitations, errors, global tools and cache policy.
- [x] Run complete tests, build, shell syntax and package manifest checks. Review
  complete diff, commit, push feature branch and create/attach PR against feat/jrv-use.

## Validation and review

- Full suite: 8 files, 144 tests passed; TypeScript build passed.
- Bash/Zsh syntax checks passed; built CLI smoke tests ran against an isolated
  fake nvm installation, including real helper execution and cache cleanup.
- npm pack --dry-run confirms jarvis.sh is included.
- Independent review found and verified fixes for symlinked NVM_DIR protection
  and additional Linux shells. Regression tests reproduce both; no remaining
  important findings.
- Ruling: work on a dedicated branch in the existing clean checkout; use a
  stacked PR against feat/jrv-use because that pending PR provides shell integration.
- Ruling: CLI preflight returns the actual Node/JS entry paths as data, rather
  than using command discovery, so pnpm executable shell shims also work.

## Follow-up: install Jarvis before deleting the previous Node

User requested automatic Jarvis installation in the selected Node before cleanup.
The original CLI installs its exact release using target Node/npm and an explicit
prefix, verifies metadata and execution, then exits before the shell starts the
new CLI for pruning. No unconditional retention of the original shell version.
Installation failure never starts cleanup; all other process/cache guards remain.

Follow-up verification: review identified npm bin-links=false as a potential
missing-command case. Installation now forces bin links and verifies bin/jrv
resolves to the validated entry before cleanup. A regression test covers the
missing link. Full suite: 150 tests; built Bash/Zsh handoff smoke passed.
