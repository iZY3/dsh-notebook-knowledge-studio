import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { SessionActivationStore, SessionContextError } from '../lib/activation.mjs'

function tempRoot() {
  const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nks-active-')), '.notebook-knowledge')
  fs.mkdirSync(root, { recursive: true })
  return root
}

test('激活状态按 session 隔离并在重建后恢复', () => {
  const root = tempRoot()
  const clock = () => '2026-08-16T00:00:00Z'
  const state = new SessionActivationStore(root, { clock })
  assert.equal(state.get('session-a'), null)
  assert.equal(state.get('session-b'), null)

  state.set('session-a', 'notebook-a')
  state.set('session-b', 'notebook-b')
  assert.equal(state.get('session-a'), 'notebook-a')
  assert.equal(state.get('session-b'), 'notebook-b')

  const restored = new SessionActivationStore(root, { clock })
  assert.equal(restored.get('session-a'), 'notebook-a')
  assert.equal(restored.get('session-b'), 'notebook-b')
  assert.deepEqual(JSON.parse(fs.readFileSync(restored.file, 'utf8')), {
    version: 1,
    sessions: {
      'session-a': { notebookId: 'notebook-a', updatedAt: '2026-08-16T00:00:00Z' },
      'session-b': { notebookId: 'notebook-b', updatedAt: '2026-08-16T00:00:00Z' },
    },
  })
})

test('不存在的 Notebook 会清理映射，删除会清理所有关联 session', () => {
  const root = tempRoot()
  const state = new SessionActivationStore(root)
  state.set('session-a', 'notebook-a')
  state.set('session-b', 'notebook-a')
  state.set('session-c', 'notebook-c')

  assert.equal(state.get('session-a', id => id === 'notebook-c'), null)
  assert.equal(state.removeNotebook('notebook-a'), true)
  assert.equal(state.get('session-b'), null)
  assert.equal(state.get('session-c'), 'notebook-c')

  const restored = new SessionActivationStore(root)
  assert.equal(restored.get('session-a'), null)
  assert.equal(restored.get('session-b'), null)
  assert.equal(restored.get('session-c'), 'notebook-c')
})

test('损坏或未知版本状态文件安全降级，非法 session 被拒绝', () => {
  const root = tempRoot()
  const stateDir = path.join(root, '.state')
  fs.mkdirSync(stateDir, { recursive: true })
  fs.writeFileSync(path.join(stateDir, 'active-notebooks.json'), '{broken')
  const warnings = []
  const broken = new SessionActivationStore(root, { logger: { warn: (...args) => warnings.push(args) } })
  assert.equal(broken.sessions.size, 0)
  assert.equal(warnings.length, 1)

  fs.writeFileSync(path.join(stateDir, 'active-notebooks.json'), JSON.stringify({ version: 999, sessions: {} }))
  const unsupported = new SessionActivationStore(root)
  assert.equal(unsupported.sessions.size, 0)
  assert.throws(() => unsupported.get(''), error => error instanceof SessionContextError && error.code === 'SESSION_CONTEXT_REQUIRED')
})

