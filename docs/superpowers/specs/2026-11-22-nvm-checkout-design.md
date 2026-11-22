# nvm checkout

Add `jrv nvm checkout <version> [--force]` for nvm-sh on macOS/Linux.

## Approach

A Node-only implementation cannot change the parent shell PATH. The user chose
shell integration, with a CLI preflight that reports a missing nvm installation
before any changes. Extend the existing Bash/Zsh wrapper; do not eval generated
checkout code. Accept numeric major/minor/patch versions (optional `v`). Source
`$NVM_DIR/nvm.sh` (default `~/.nvm/nvm.sh`) with `--no-use`, install, resolve the
exact version, use it, verify current, then set default to that exact version.
Without the wrapper, explain how to activate integration and exit unsuccessfully.

## Cleanup

Only after all checkout steps succeed, `--force` invokes a hidden CLI cleanup
command from the newly installed Jarvis under the target Node. Before cleanup,
use the original CLI to run the target Node/npm and install the same published
Jarvis version with an explicit target prefix. Verify package metadata, entry
location and runnable CLI version; installation failure retains all old versions.
Do this installation on normal checkouts too. Keep the target/default and the
cleanup CLI runtime/installation, but allow removal of the original shell version. Skip all cleanup if any
other shell process exists (including idle shells), process inspection fails, or
lsof is unavailable. For each other installed version, check open files with lsof,
recheck default and process safety, then uninstall via nvm and delete only that
version's bin/src download-cache directories. Skip symlinked locations. Do not
clear all nvm cache. Failed/partial cleanup is reported without undoing checkout.

Global packages belonging to an uninstalled version are removed; only Jarvis is installed in the target version.
Never touch shared npm/pnpm/yarn caches or project node_modules. The conservative
shell check may skip cleanup for unrelated shells. Inspection cannot prevent a
process from starting after a check; users should close other sessions and avoid
concurrent nvm operations. Use a directory lock for concurrent Jarvis checkouts.

## Delivery

Tests run against temporary fake installations, covering both Bash and Zsh.
Fix package publication of jarvis.sh. Base the new PR on feat/jrv-use (PR #3),
which provides shell integration, so unrelated pending changes stay out of diff.
