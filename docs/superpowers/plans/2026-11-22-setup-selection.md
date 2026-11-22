# Selective Setup Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Execute only the setup operations selected by the user.
**Architecture:** Keep existing helpers and gate each operation behind one Inquirer checkbox selection before side effects.
**Tech Stack:** TypeScript, @inquirer/prompts, Vitest.
**Spec:** docs/superpowers/specs/2026-11-22-setup-selection-design.md

## Global Constraints

Four independent choices, none checked; empty selection/cancellation makes no changes.
Keep existing skip behavior. Only shell setup prints activation instructions.

## Review Focus

Cancellation before mutations; no unrelated installation for config/shell selections;
existing tools and config preserved; installation failures stop execution;
Bash/Zsh activation instructions appear only when selected.

## Task 1: Selective setup

- [x] Add `src/setup/index.test.ts`: mock prompt, spawn, fs, homedir; cover empty/cancelled selection, each independent option, all options, already-installed tools, existing config/integration, failure propagation.
- [x] Run `pnpm exec vitest run src/setup/index.test.ts` and confirm failure against unconditional setup.
- [x] Update `src/setup/index.ts`: prompt before all operations, gate four tasks, return on ExitPromptError/AbortPromptError, rethrow other errors.
- [x] Update setup command JSDoc, README and AGENTS description.
- [x] Run focused tests, `pnpm run build`, `pnpm test`; inspect diff.

## Verification

Focused tests: 15 passed (observed 12 failures before implementation). Full suite:
9 files, 165 tests passed. TypeScript build and git diff --check passed.
Independent review found no correctness issues. Changes remain uncommitted.
