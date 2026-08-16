import fs from 'node:fs'
import path from 'node:path'
import { nowIso } from './util.mjs'

const STATE_VERSION = 1

export class SessionContextError extends Error {
  constructor(message, code = 'SESSION_CONTEXT_REQUIRED', statusCode = 400) {
    super(message)
    this.name = 'SessionContextError'
    this.code = code
    this.statusCode = statusCode
  }
}

function sessionKey(value) {
  const key = String(value ?? '').trim()
  if (!key || key.length > 512 || /[\u0000-\u001f\u007f]/.test(key)) {
    throw new SessionContextError('当前操作需要有效的 Harness 对话上下文')
  }
  return key
}

function notebookValue(value) {
  const id = String(value ?? '').trim()
  if (!id) throw new Error('notebook id required')
  return id
}

/** Durable sessionId → notebookId activation state. */
export class SessionActivationStore {
  constructor(root, { logger, clock = nowIso } = {}) {
    this.root = path.resolve(String(root))
    this.file = path.join(this.root, '.state', 'active-notebooks.json')
    this.logger = logger
    this.clock = clock
    this.sessions = new Map()
    this.load()
  }

  warn(message, error) {
    try { this.logger?.warn?.('[notebook-studio]', message, error?.message ?? error ?? '') } catch { /* noop */ }
  }

  load() {
    if (!fs.existsSync(this.file)) return
    try {
      if (fs.lstatSync(this.file).isSymbolicLink()) throw new Error('activation state file must not be a symbolic link')
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'))
      if (parsed?.version !== STATE_VERSION || !parsed.sessions || typeof parsed.sessions !== 'object' || Array.isArray(parsed.sessions)) {
        throw new Error(`unsupported activation state version: ${parsed?.version ?? 'missing'}`)
      }
      for (const [rawSessionId, entry] of Object.entries(parsed.sessions)) {
        try {
          const id = sessionKey(rawSessionId)
          const notebookId = notebookValue(entry?.notebookId)
          this.sessions.set(id, {
            notebookId,
            updatedAt: typeof entry.updatedAt === 'string' ? entry.updatedAt : this.clock(),
          })
        } catch { /* skip invalid entries without rejecting the whole state file */ }
      }
    } catch (error) {
      this.sessions.clear()
      this.warn('激活状态文件无效，已按空状态启动:', error)
    }
  }

  snapshot() {
    return {
      version: STATE_VERSION,
      sessions: Object.fromEntries([...this.sessions.entries()].sort(([a], [b]) => a.localeCompare(b))),
    }
  }

  persist() {
    const dir = path.dirname(this.file)
    fs.mkdirSync(dir, { recursive: true })
    if (fs.lstatSync(dir).isSymbolicLink()) throw new Error('activation state directory must not be a symbolic link')
    const tmp = `${this.file}.${process.pid}.${Date.now()}.tmp`
    try {
      fs.writeFileSync(tmp, JSON.stringify(this.snapshot(), null, 2) + '\n', 'utf8')
      fs.renameSync(tmp, this.file)
    } finally {
      if (fs.existsSync(tmp)) fs.rmSync(tmp, { force: true })
    }
  }

  get(sessionId, notebookExists) {
    const key = sessionKey(sessionId)
    const entry = this.sessions.get(key)
    if (!entry) return null
    if (notebookExists && !notebookExists(entry.notebookId)) {
      this.sessions.delete(key)
      this.persist()
      return null
    }
    return entry.notebookId
  }

  set(sessionId, notebookId) {
    const key = sessionKey(sessionId)
    const id = notebookValue(notebookId)
    this.sessions.set(key, { notebookId: id, updatedAt: this.clock() })
    this.persist()
    return id
  }

  removeNotebook(notebookId) {
    const id = notebookValue(notebookId)
    let changed = false
    for (const [key, entry] of this.sessions) {
      if (entry.notebookId !== id) continue
      this.sessions.delete(key)
      changed = true
    }
    if (changed) this.persist()
    return changed
  }
}

