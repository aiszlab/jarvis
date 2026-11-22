import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFeedback, formatError } from './feedback.js'

afterEach(() => vi.useRealTimers())
const setup = (isTTY = false, env: NodeJS.ProcessEnv = {}) => {
  const chunks: string[] = []
  const ui = createFeedback({ stream: { isTTY, write: (text: string) => { chunks.push(text); return true } }, env })
  return { ui, output: () => chunks.join('') }
}

describe('CLI feedback', () => {
  it('writes stable ASCII status and summary lines to its diagnostic stream', () => {
    const { ui, output } = setup()
    const step = ui.spinner('Installing Node')
    step.succeed('Node installed')
    ui.info('Checking default')
    ui.warn('Cleanup skipped')
    ui.summary('Checkout complete', { Node: 'v24.0.0', Default: 'v24.0.0' })
    expect(output()).toContain('> Installing Node\n')
    expect(output()).toContain('+ Node installed\n')
    expect(output()).toContain('Node: v24.0.0')
    expect(output()).not.toMatch(/[\x1b\r]/)
  })
  it.each([{ CI: 'true' }, { NO_COLOR: '' }, { TERM: 'dumb' }])('suppresses color for %j', env => {
    const { ui, output } = setup(true, env)
    ui.warn('Skipped')
    expect(output()).not.toContain('\x1b')
  })
  it('does not animate in CI even with a TTY', () => {
    vi.useFakeTimers()
    const { ui, output } = setup(true, { CI: '1' })
    ui.spinner('Work').succeed()
    vi.advanceTimersByTime(300)
    expect(output()).not.toMatch(/[\x1b\r]/)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('clears animated progress before logs and stops its timer exactly once', () => {
    vi.useFakeTimers()
    const { ui, output } = setup(true)
    const step = ui.spinner('Work')
    vi.advanceTimersByTime(100)
    ui.info('Detail')
    step.fail(new Error('Network failed'))
    const done = output()
    step.succeed()
    vi.advanceTimersByTime(500)
    expect(output()).toBe(done)
    expect(done).toContain('\r\x1b[2K')
    expect(done).toContain('Network failed')
    expect(vi.getTimerCount()).toBe(0)
  })
  it('formats errors without stacks and handles arbitrary thrown values', () => {
    expect(formatError(new Error('offline'))).toBe('offline')
    expect(formatError('failed')).toBe('failed')
    expect(formatError(null)).toBe('null')
    const { ui, output } = setup()
    ui.error(new Error('offline'), 'Retry checkout')
    expect(output()).toBe('x offline\n  Retry checkout\n')
  })
})
