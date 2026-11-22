# CLI feedback

Implement the user's confirmed CLI UX request with compact Vercel/pnpm-inspired
status lines, a reusable logger, spinner, summary and error formatter. Keep
human feedback on stderr and preserve stdout for shell protocols and exports.
Animate only on a TTY outside CI; NO_COLOR (including an empty value) suppresses
color. Redirected and CI output uses stable ASCII lines without cursor controls.

Use a dependency-free TypeScript feedback module. Shell checkout uses equivalent
static step lines because nvm must execute in the parent shell to change PATH.
Show install/use/default/Jarvis/optional cleanup stages, elapsed time and final
Node/default summary. Errors must preserve nonzero status, stop completion
messages, and retain existing conservative cleanup behavior. Child tool output
also goes to stderr. Do not alter machine-readable checkout/install protocols.

Alternatives: an external spinner library adds dependency cost; moving checkout
to Node loses parent-shell mutation. Keep shell steps and share visual conventions.
