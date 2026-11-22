# Selective setup

Approved behavior: `jrv setup` presents four independent checkbox choices: install
pnpm, install Claude Code, initialize project config (including gitignore), and
install Bash/Zsh integration. Nothing is checked by default. Empty selection or
prompt cancellation makes no changes. Existing tools/config/integration remain
idempotent. Only shell integration prints activation instructions.

Approaches: independent confirmation prompts would require four answers; CLI-only
flags would make discovery harder. Reuse the existing Inquirer checkbox pattern
for a single selection screen, as approved by the user. No new dependencies,
noninteractive flags, Node installation, or publishing changes.
