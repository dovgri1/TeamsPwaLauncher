import { app, shell } from 'electron'
import { appendFileSync, existsSync, mkdirSync, readdirSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

type LogFields = Record<string, unknown>

const MAX_LOG_FILES = 14
const WRITE_QUEUE: string[] = []
let writing = false
let currentLogPath: string | null = null
let started = false

function logsDir(): string {
  return join(app.getPath('userData'), 'logs')
}

function dayStamp(date = new Date()): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function ensureLogFile(): string {
  const dir = logsDir()
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  const path = join(dir, `launcher-${dayStamp()}.log`)
  if (currentLogPath !== path) {
    currentLogPath = path
    if (!existsSync(path)) {
      writeFileSync(path, '', 'utf8')
    }
  }
  return path
}

function pruneOldLogs(): void {
  const dir = logsDir()
  if (!existsSync(dir)) {
    return
  }
  const files = readdirSync(dir)
    .filter((name) => /^launcher-\d{4}-\d{2}-\d{2}\.log$/.test(name))
    .sort()
  const excess = files.length - MAX_LOG_FILES
  if (excess <= 0) {
    return
  }
  for (const name of files.slice(0, excess)) {
    try {
      unlinkSync(join(dir, name))
    } catch {
      // Ignore prune failures.
    }
  }
}

function flushQueue(): void {
  if (writing || WRITE_QUEUE.length === 0) {
    return
  }
  writing = true
  try {
    const path = ensureLogFile()
    const chunk = WRITE_QUEUE.splice(0, WRITE_QUEUE.length).join('')
    appendFileSync(path, chunk, 'utf8')
  } catch (error) {
    console.error('[logger] failed to write log file', error)
  } finally {
    writing = false
    if (WRITE_QUEUE.length > 0) {
      flushQueue()
    }
  }
}

function sanitizeValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return sanitizeUrlish(value)
  }
  if (Array.isArray(value)) {
    return value.map(sanitizeValue)
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      out[key] = sanitizeValue(nested)
    }
    return out
  }
  return value
}

/** Strip tokens/query noise from URLs while keeping host + path for diagnosis. */
export function sanitizeUrlish(value: string): string {
  if (!value) {
    return value
  }
  try {
    const parsed = new URL(value)
    if (parsed.search) {
      const kept = new URLSearchParams()
      for (const [key, raw] of parsed.searchParams.entries()) {
        if (/token|code|secret|password|session|auth|sso|ticket|assertion/i.test(key)) {
          kept.set(key, '[redacted]')
        } else if (raw.length > 80) {
          kept.set(key, `${raw.slice(0, 24)}…`)
        } else {
          kept.set(key, raw)
        }
      }
      parsed.search = kept.toString() ? `?${kept.toString()}` : ''
    }
    return parsed.toString()
  } catch {
    return value.length > 400 ? `${value.slice(0, 400)}…` : value
  }
}

export function initLogger(): string {
  if (started) {
    return getCurrentLogPath()
  }
  started = true
  pruneOldLogs()
  const path = ensureLogFile()
  log('info', 'app', 'logger-ready', {
    logPath: path,
    logsDir: logsDir(),
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    platform: process.platform,
    arch: process.arch
  })
  return path
}

export function log(level: LogLevel, scope: string, message: string, fields?: LogFields): void {
  if (!started && !app.isReady()) {
    return
  }
  if (!started) {
    initLogger()
  }

  const entry = {
    ts: new Date().toISOString(),
    level,
    scope,
    message,
    ...(fields ? (sanitizeValue(fields) as LogFields) : {})
  }
  const line = `${JSON.stringify(entry)}\n`
  WRITE_QUEUE.push(line)
  flushQueue()

  const prefix = `[${entry.ts}] ${level.toUpperCase()} ${scope}`
  if (level === 'error') {
    console.error(prefix, message, fields ?? '')
  } else if (level === 'warn') {
    console.warn(prefix, message, fields ?? '')
  } else if (process.env.ELECTRON_RENDERER_URL || !app.isPackaged) {
    console.log(prefix, message, fields ?? '')
  }
}

export function getLogsDir(): string {
  return logsDir()
}

export function getCurrentLogPath(): string {
  return currentLogPath ?? ensureLogFile()
}

export async function openLogsFolder(): Promise<string> {
  const dir = logsDir()
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  const result = await shell.openPath(dir)
  if (result) {
    log('warn', 'app', 'open-logs-folder-failed', { result, dir })
  }
  return dir
}

export async function revealCurrentLog(): Promise<string> {
  const path = getCurrentLogPath()
  shell.showItemInFolder(path)
  return path
}
