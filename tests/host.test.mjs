import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { apply } from '../lib/index.js'

function createHost(root, sessionIds = ['session-a', 'session-b']) {
  const registeredTools = []
  let promptVariable
  let apiHandler
  const agentMap = new Map(sessionIds.map(id => [id, { id }]))
  const tools = {
    register(tool) { registeredTools.push(tool); return () => {} },
    schemas() { return [] },
  }
  const webServer = {
    register(entry) { apiHandler = entry.handler; return () => {} },
  }
  const systemPrompt = {
    variable(_name, provider) { promptVariable = provider; return () => {} },
    section() { return () => {} },
  }
  const agents = {
    get(id) { return agentMap.get(String(id)) },
    currentInitiator() { return undefined },
  }
  const services = { tools, webServer, systemPrompt, agents }
  const ctx = {
    tools,
    webServer,
    logger: undefined,
    get(name) { return services[name] },
    effect(factory) { return factory() },
  }
  apply(ctx, { root })
  return {
    tools: Object.fromEntries(registeredTools.map(tool => [tool.name, tool])),
    prompt: context => promptVariable(context),
    handler: (...args) => apiHandler(...args),
  }
}

function tempRoot() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nks-host-')), '.notebook-knowledge')
}

async function callApi(handler, method, url, { body, sessionId } = {}) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))])
  req.method = method
  req.url = url
  req.headers = {
    'content-type': 'application/json',
    ...(sessionId ? { 'x-dsh-session-id': sessionId } : {}),
  }
  const response = { status: 0, headers: {}, body: '' }
  const res = {
    writeHead(status, headers) { response.status = status; response.headers = headers },
    end(content) { response.body = String(content ?? '') },
  }
  await handler(req, res)
  return { ...response, json: JSON.parse(response.body) }
}

test('Host 激活状态按工具执行 session 隔离并驱动对应系统提示', async () => {
  const root = tempRoot()
  const host = createHost(root)
  const manage = host.tools.nb_notebook_manage
  const activate = host.tools.nb_activate
  const status = host.tools.nb_status
  const a = await manage.execute({ action: 'create', title: '会话甲知识库' })

  // 即使只有一个 Notebook，新会话也不自动激活。
  assert.equal((await status.execute({}, { agent: { id: 'session-a' } })).activeNotebook, null)
  assert.equal(host.prompt({ agent: { id: 'session-a' } }), '')

  const b = await manage.execute({ action: 'create', title: '会话乙知识库' })
  await activate.execute({ notebook: a.id }, { agent: { id: 'session-a' } })
  await activate.execute({ notebook: b.id }, { agent: { id: 'session-b' } })

  assert.equal((await status.execute({}, { agent: { id: 'session-a' } })).activeNotebook.id, a.id)
  assert.equal((await status.execute({}, { agent: { id: 'session-b' } })).activeNotebook.id, b.id)
  assert.match(host.prompt({ agent: { id: 'session-a' } }), /会话甲知识库/)
  assert.doesNotMatch(host.prompt({ agent: { id: 'session-a' } }), /会话乙知识库/)
  assert.match(host.prompt({ agent: { id: 'session-b' } }), /会话乙知识库/)
  await assert.rejects(
    () => activate.execute({ notebook: a.id }, {}),
    error => error.code === 'SESSION_CONTEXT_REQUIRED' && error.statusCode === 400,
  )

  // 新插件实例从持久化状态恢复，但仍按 session 隔离。
  const restored = createHost(root)
  assert.equal((await restored.tools.nb_status.execute({}, { agent: { id: 'session-a' } })).activeNotebook.id, a.id)
  assert.equal((await restored.tools.nb_status.execute({}, { agent: { id: 'session-b' } })).activeNotebook.id, b.id)

  await restored.tools.nb_notebook_manage.execute({ action: 'delete', notebook: a.id, confirm: true })
  assert.equal((await restored.tools.nb_status.execute({}, { agent: { id: 'session-a' } })).activeNotebook, null)
  assert.equal((await restored.tools.nb_status.execute({}, { agent: { id: 'session-b' } })).activeNotebook.id, b.id)
})

test('激活 API 要求有效 session header，status 无 header 保持兼容', async () => {
  const root = tempRoot()
  const host = createHost(root, ['session-live'])
  const notebook = await host.tools.nb_notebook_manage.execute({ action: 'create', title: 'API 会话库' })
  const activatePath = `/notebook-studio/api/notebooks/${encodeURIComponent(notebook.id)}/activate`

  const missing = await callApi(host.handler, 'POST', activatePath, { body: {} })
  assert.equal(missing.status, 400)
  assert.equal(missing.json.code, 'SESSION_CONTEXT_REQUIRED')

  const unknown = await callApi(host.handler, 'POST', activatePath, { body: {}, sessionId: 'session-unknown' })
  assert.equal(unknown.status, 404)
  assert.equal(unknown.json.code, 'SESSION_NOT_FOUND')

  const activated = await callApi(host.handler, 'POST', activatePath, { body: {}, sessionId: 'session-live' })
  assert.equal(activated.status, 200)
  assert.equal(activated.json.active.id, notebook.id)

  const scopedStatus = await callApi(host.handler, 'GET', '/notebook-studio/api/status', { sessionId: 'session-live' })
  assert.equal(scopedStatus.status, 200)
  assert.equal(scopedStatus.json.activationScope, 'session')
  assert.equal(scopedStatus.json.activeNotebook.id, notebook.id)

  const compatibleStatus = await callApi(host.handler, 'GET', '/notebook-studio/api/status')
  assert.equal(compatibleStatus.status, 200)
  assert.equal(compatibleStatus.json.activationScope, 'session')
  assert.equal(compatibleStatus.json.activeNotebook, null)
})

