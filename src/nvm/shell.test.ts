import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, renameSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'jarvis shell spaces-'))
  mkdirSync(join(root, 'bin'))
  writeFileSync(join(root, 'bin/jrv'), `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args[1] === '_install') {
  if (process.env.FAIL === 'jarvis') { console.error('Jarvis install failed'); process.exit(10); }
  const path = require('node:path');
  const bin = process.env.NVM_BIN;
  fs.mkdirSync(bin, { recursive: true });
  fs.symlinkSync(process.execPath, bin + '/node');
  fs.copyFileSync(process.argv[1], bin + '/new-jrv.js');
  fs.writeFileSync(process.env.NVM_DIR + '/jarvis-installed', 'yes');
  console.log(bin + '/new-jrv.js');
  process.exit(0);
}
if (args[1] === '_prune') {
  if (!process.argv[1].startsWith(process.env.NVM_BIN + '/')) process.exit(11);
  if (!fs.existsSync(process.env.NVM_DIR + '/jarvis-installed')) process.exit(12);
  fs.writeFileSync(process.env.NVM_DIR + '/pruned', process.argv[1]);
  process.exit(process.env.FAIL === 'prune' ? 8 : 0);
}
if (process.env.FAIL === 'preflight') { console.error('Please install nvm'); process.exit(7); }
if (args.includes('--help')) { console.log('Usage: jrv nvm checkout'); process.exit(0); }
console.log('JARVIS_NVM_CHECKOUT:' + args[2] + '\\n' + process.execPath + '\\n' + process.argv[1]);
`, { mode: 0o755 })
  writeFileSync(join(root, 'nvm.sh'), `
[ "$FAIL" != source ] || return 9
nvm() {
  printf '%s\\n' "$*" >> "$NVM_DIR/calls"
  [ "$1" != "$FAIL" ] || return 9
  case "$1" in
    current) if [ "$FAIL" = verify ] && [ -f "$NVM_DIR/used" ]; then echo v20.0.0; return; fi; printf '%s\\n' "$(cat "$NVM_DIR/current")" ;;
    version) if [ "$FAIL" = resolve ]; then echo N/A; return; fi; printf 'v24.0.0\\n' ;;
    install) echo v24.0.0 > "$NVM_DIR/current" ;;
    use) touch "$NVM_DIR/used"; export PATH="$NVM_DIR/versions/node/$2/bin:$PATH"; export NVM_BIN="$NVM_DIR/versions/node/$2/bin"; echo "$2" > "$NVM_DIR/current" ;;
    alias) echo "$3" > "$NVM_DIR/default" ;;
  esac
}
`)
  writeFileSync(join(root, 'current'), 'v22.0.0')
})
afterEach(() => rmSync(root, { recursive: true, force: true }))
function run(shell: string, command: string, fail = '') {
  return spawnSync(shell, ['-c', `. "$1"; ${command}`, 'test', resolve('jarvis.sh')], {
    env: { ...process.env, NVM_DIR: root, PATH: `${root}/bin:${process.env.PATH}`, FAIL: fail }, encoding: 'utf8',
  })
}
for (const shell of ['bash', 'zsh']) {
  describe.skipIf(!!spawnSync(shell, ['--version']).error)(`${shell} integration`, () => {
    it('switches the parent PATH and pins default after install/use', () => {
      const result = run(shell, 'jrv nvm checkout 24 && printf "NODE_BIN=%s\\n" "$NVM_BIN"')
      expect(result.status, result.stderr).toBe(0)
      expect(result.stdout).toContain(`NODE_BIN=${root}/versions/node/v24.0.0/bin`)
      expect(readFileSync(join(root, 'default'), 'utf8').trim()).toBe('v24.0.0')
      expect(existsSync(join(root, 'jarvis-installed'))).toBe(true)
      expect(readFileSync(join(root, 'calls'), 'utf8')).toContain('use v24.0.0\n')
      expect(existsSync(join(root, '.jarvis-checkout.lock'))).toBe(false)
    })
    it.each(['preflight', 'source', 'install', 'resolve', 'use', 'verify', 'alias'])('stops after %s failure, never cleaning', (fail) => {
      const result = run(shell, 'jrv nvm checkout 24 --force', fail)
      expect(result.status).not.toBe(0)
      expect(existsSync(join(root, 'default'))).toBe(false)
      expect(existsSync(join(root, 'pruned'))).toBe(false)
      expect(existsSync(join(root, '.jarvis-checkout.lock'))).toBe(false)
    })
    it('installs Jarvis before pruning from the new installation', () => {
      const result = run(shell, 'jrv nvm checkout 24 --force')
      expect(result.status, result.stderr).toBe(0)
      expect(readFileSync(join(root, 'pruned'), 'utf8')).toBe(join(root, 'versions/node/v24.0.0/bin/new-jrv.js'))
      expect(readFileSync(join(root, 'default'), 'utf8').trim()).toBe('v24.0.0')
    })
    it('never prunes when Jarvis installation fails', () => {
      const result = run(shell, 'jrv nvm checkout 24 --force', 'jarvis')
      expect(result.status).not.toBe(0)
      expect(existsSync(join(root, 'pruned'))).toBe(false)
      expect(existsSync(join(root, '.jarvis-checkout.lock'))).toBe(false)
    })
    it('reports cleanup failure while retaining the successful switch and releasing lock', () => {
      const result = run(shell, 'jrv nvm checkout 24 --force', 'prune')
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('checkout succeeded, but cleanup failed')
      expect(readFileSync(join(root, 'default'), 'utf8').trim()).toBe('v24.0.0')
      expect(existsSync(join(root, '.jarvis-checkout.lock'))).toBe(false)
    })
    it('uses the actual CLI entry behind a package-manager shell shim', () => {
      const entry = join(root, 'cli.js')
      renameSync(join(root, 'bin/jrv'), entry)
      writeFileSync(join(root, 'bin/jrv'), `#!/bin/sh\nexec "${process.execPath}" "${entry}" "$@"\n`, { mode: 0o755 })
      const result = run(shell, 'jrv nvm checkout 24 --force')
      expect(result.status, result.stderr).toBe(0)
      expect(readFileSync(join(root, 'pruned'), 'utf8')).toBe(join(root, 'versions/node/v24.0.0/bin/new-jrv.js'))
    })
    it('help does not source nvm or install anything', () => {
      const result = run(shell, 'jrv nvm checkout --help')
      expect(result.stdout).toContain('Usage:')
      expect(existsSync(join(root, 'calls'))).toBe(false)
    })
    it('refuses a concurrent checkout without touching nvm', () => {
      mkdirSync(join(root, '.jarvis-checkout.lock'))
      const result = run(shell, 'jrv nvm checkout 24')
      expect(result.status).not.toBe(0)
      expect(existsSync(join(root, 'calls'))).toBe(false)
    })
  })
}
