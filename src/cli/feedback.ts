interface DiagnosticStream {
  isTTY?: boolean
  write(text: string): unknown
}

/**
 * @zh 将异常转为简洁可读的消息，不暴露调用栈
 * @en format thrown values as concise messages without stack traces
 */
export function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * @zh 创建写入 stderr 的统一反馈，按终端能力启用动画与颜色
 * @en create stderr feedback with animation and color based on terminal capabilities
 */
export function createFeedback(options: { stream?: DiagnosticStream; env?: NodeJS.ProcessEnv } = {}) {
  const stream = options.stream ?? process.stderr
  const env = options.env ?? process.env
  const animate = !!stream.isTTY && !env.CI && env.TERM !== 'dumb'
  const color = animate && env.NO_COLOR === undefined
  let stopActive: (() => void) | undefined
  let active: { clear(): void; render(): void } | undefined
  const paint = (text: string, code: number) => color ? `\x1b[${code}m${text}\x1b[0m` : text
  const line = (symbol: string, text: string, code = 36) => {
    active?.clear()
    stream.write(`${paint(symbol, code)} ${text}\n`)
    active?.render()
  }
  return {
    info: (text: string) => line('>', text),
    warn: (text: string) => line('!', text, 33),
    error: (error: unknown, hint?: string) => line('x', `${formatError(error)}${hint ? `\n  ${hint}` : ''}`, 31),
    summary: (title: string, details: Record<string, string>) => {
      line('+', title, 32)
      for (const [key, value] of Object.entries(details)) line(' ', `${key}: ${value}`)
    },
    spinner(text: string) {
      // Only one live progress line may own the terminal at a time.
      active?.clear()
      let finished = false
      let frame = 0
      const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
      const progress = {
        clear: () => { if (animate) stream.write('\r\x1b[2K') },
        render: () => { if (animate) stream.write(`${paint(frames[frame++ % frames.length], 36)} ${text}`) },
      }
      // Stop an earlier spinner when a new one supersedes it.
      stopActive?.()
      active = progress
      if (animate) progress.render()
      else stream.write(`> ${text}\n`)
      const timer = animate ? setInterval(() => { progress.clear(); progress.render() }, 80) : undefined
      timer?.unref?.()
      const finish = (symbol?: string, message = text, code = 32) => {
        if (finished) return
        finished = true
        if (timer) clearInterval(timer)
        progress.clear()
        if (active === progress) { active = undefined; stopActive = undefined }
        if (symbol) line(symbol, message, code)
      }
      stopActive = () => finish()
      return {
        succeed: (message = text) => finish('+', message),
        fail: (error: unknown = text) => finish('x', formatError(error), 31),
        stop: () => finish(),
      }
    },
  }
}
