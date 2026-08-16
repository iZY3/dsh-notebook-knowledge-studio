/**
 * Notebook Knowledge Studio — host 半。
 * Cordis 插件:注册 nb_* 工具(agent 对话用)与 /notebook-studio/api 前缀路由(client 面板用)。
 * 依赖:tools(工具注册)、webServer(HTTP API);web/llm 按需探测,缺失时优雅降级。
 *
 * 零外部包导入(同 router-tools 模式):link: 安装时 Node 按真实路径解析裸导入会失败,
 * 因此内联一个最小 spec→JSON Schema 编译器,替代 @deepseek-ai/dsh-tools 的 defineTool。
 */
import { createCore } from './core.mjs'
import { generateStudio } from './studio.mjs'
import { SessionActivationStore, SessionContextError } from './activation.mjs'

export const name = 'notebook-knowledge-studio'

export const inject = ['tools', 'webServer', 'agents']

/** spec → JSON Schema(参数 DSL 子集:标量/枚举/数组+items)。 */
function toJsonSchema(spec) {
  const properties = {}
  const required = []
  for (const [key, meta] of Object.entries(spec || {})) {
    const prop = { type: meta.type }
    if (meta.type === 'array' && meta.items) prop.items = { type: meta.items.type ?? 'string' }
    if (Array.isArray(meta.enum)) prop.enum = meta.enum
    if (meta.description) prop.description = meta.description
    properties[key] = prop
    if (meta.required) required.push(key)
  }
  return { type: 'object', properties, required, additionalProperties: false }
}

const text = (v) => JSON.stringify(v, null, 2)

export function apply(ctx, config = {}) {
  const core = createCore({ ctx, config })
  const activations = new SessionActivationStore(core.store.root, { logger: ctx?.logger })
  const agents = ctx.get('agents')

  // ── 主对话集成:激活 notebook 时向系统提示注入 RAG 使用说明 ──
  // (与主对话框合并:用户在原生聊天直接提问,agent 调 nb_query 带引用回答)
  const resolveActive = (sessionId) => {
    if (!sessionId) return null
    const notebooks = core.store.listNotebooks()
    const ids = new Set(notebooks.map(notebook => notebook.id))
    return activations.get(sessionId, id => ids.has(id))
  }

  const activePayload = (sessionId) => {
    const id = resolveActive(sessionId)
    if (!id) return null
    const nb = core.store.listNotebooks().find(notebook => notebook.id === id)
    return nb ? { id: nb.id, title: nb.title, sourceCount: nb.sourceCount } : null
  }

  const requireExecutionSession = (exec) => {
    const sessionId = exec?.agent?.id
    if (!sessionId) throw new SessionContextError('当前工具调用缺少 Harness 对话上下文')
    return String(sessionId)
  }

  const deleteNotebook = async (notebook, options) => {
    const result = await core.deleteNotebook(notebook, options)
    if (result.deleted && result.id) activations.removeNotebook(result.id)
    return result
  }

  const notebookPromptText = (sessionId) => {
    const id = resolveActive(sessionId)
    if (!id) return ''
    const nb = core.store.listNotebooks().find(n => n.id === id)
    if (!nb) return ''
    const sources = core.store.listSources(id).filter(s => s.status !== 'multimodal-pending')
    return [
      '## Notebook Knowledge Studio(本地知识库已接入)',
      `当前激活 Notebook:「${nb.title}」(id: ${id}),已索引来源 ${sources.length} 个:${sources.map(s => s.title).join('、') || '(无)'}。`,
      '使用规则:',
      '1. 用户问题若涉及上述来源内容,先调用 nb_query 检索(返回带 [n] 引用编号的答案与引用列表),再基于其结果作答,并在回答中保留 [n] 引用。',
      '2. 资料不足以回答时,如实说明"当前资料中没有足够信息",不得杜撰。',
      '3. 需要生成思维导图/报告/闪卡/测验/信息图/幻灯/表格时调用 nb_studio。',
      '4. 未激活的 notebook 内容不在你的知识范围内,不要编造。',
    ].join('\n')
  }

  const sp = ctx.get('systemPrompt')
  if (sp) {
    ctx.effect(() => sp.variable('notebook_context', context => notebookPromptText(context?.agent?.id)), 'notebook-studio: variable')
    ctx.effect(() => sp.section({ name: 'notebook-studio', order: 90, text: '{{notebook_context}}' }), 'notebook-studio: section')
  }

  const reg = (tool) => {
    ctx.effect(() => ctx.tools.register({
      ...tool,
      parameters: toJsonSchema(tool.parameters),
    }), `notebook-studio: ${tool.name}`)
  }

  // ── 工具:状态 ────────────────────────────────────────────────

  reg({
    name: 'nb_status',
    description: 'Notebook Knowledge Studio 状态:数据根目录、激活 notebook、notebook 数、LLM 路由、web/ Qwen-MM 可用性。',
    parameters: {},
    output: { schema: { type: 'object' }, render: (_a, v) => [{ type: 'text', text: text(v) }] },
    async execute(_args, exec) {
      const s = await core.status()
      return { ...s, activationScope: 'session', activeNotebook: activePayload(exec?.agent?.id) }
    },
  })

  reg({
    name: 'nb_activate',
    description: '激活一个 Notebook 作为当前对话的知识上下文(系统提示会注入其来源清单;此后知识类提问将走 nb_query 带引用检索)。notebook 省略时返回当前激活状态。',
    parameters: {
      notebook: { type: 'string', description: '要激活的 notebook id 或标题 slug(省略=只查询)' },
    },
    output: { schema: { type: 'object' }, render: (_a, v) => [{ type: 'text', text: text(v) }] },
    async execute(args, exec) {
      const sessionId = requireExecutionSession(exec)
      if (args.notebook === undefined) {
        const id = resolveActive(sessionId)
        return { active: id ? { id } : null }
      }
      const detail = await core.getNotebook(args.notebook)
      activations.set(sessionId, detail.id)
      return { active: { id: detail.id, title: detail.title, sourceCount: detail.sources.length }, note: '已注入当前对话上下文;知识类提问将自动走 nb_query。' }
    },
  })

  // ── 工具:Notebook 管理 ────────────────────────────────────────

  reg({
    name: 'nb_notebook_manage',
    description: '管理 Notebook。action: create(需 title)| list | open(返回详情含 sources/artifacts)| rename(需 new_title)| delete(需 confirm:true,二次调用才执行)。',
    parameters: {
      action: { type: 'string', required: true, enum: ['create', 'list', 'open', 'rename', 'delete'], description: '操作' },
      title: { type: 'string', description: 'create 时的标题' },
      notebook: { type: 'string', description: 'notebook id 或标题 slug' },
      new_title: { type: 'string', description: 'rename 时的新标题' },
      confirm: { type: 'boolean', description: 'delete 时必须显式传 true' },
    },
    output: { schema: { type: 'object' }, render: (_a, v) => [{ type: 'text', text: text(v) }] },
    async execute(args) {
      switch (args.action) {
        case 'create': return core.createNotebook(args.title)
        case 'list': return { notebooks: await core.listNotebooks() }
        case 'open': return core.getNotebook(args.notebook)
        case 'rename': return core.renameNotebook(args.notebook, args.new_title)
        case 'delete': return deleteNotebook(args.notebook, { confirm: args.confirm === true })
        default: throw new Error(`unknown action: ${args.action}`)
      }
    },
  })

  // ── 工具:来源管理 ─────────────────────────────────────────────

  reg({
    name: 'nb_source_add',
    description: '向 Notebook 添加来源。type: file(本地路径;多模态文件标记 pending 交 Qwen-MM 转写)| url(抓取并提取正文)| text(直接粘贴)。重复内容默认拒绝,可用 on_duplicate: update|anyway。',
    parameters: {
      notebook: { type: 'string', required: true },
      type: { type: 'string', required: true, enum: ['file', 'url', 'text'] },
      path: { type: 'string', description: 'type=file 时的本地文件绝对路径' },
      url: { type: 'string', description: 'type=url 时的网址' },
      text: { type: 'string', description: 'type=text 时的正文' },
      title: { type: 'string', description: '可选标题' },
      on_duplicate: { type: 'string', enum: ['reject', 'update', 'anyway'], description: '重复内容处理策略' },
    },
    timeoutMs: 120000,
    output: { schema: { type: 'object' }, render: (_a, v) => [{ type: 'text', text: text(v) }] },
    async execute(args, exec) {
      return core.addSource(args.notebook, {
        type: args.type, path: args.path, url: args.url, text: args.text, title: args.title,
      }, { onDuplicate: args.on_duplicate ?? 'reject' })
    },
  })

  reg({
    name: 'nb_source_list',
    description: '列出 Notebook 的全部来源(id/标题/类型/状态/字数)。',
    parameters: { notebook: { type: 'string', required: true } },
    output: { schema: { type: 'object' }, render: (_a, v) => [{ type: 'text', text: text(v) }] },
    async execute(args) { return { sources: await core.listSources(args.notebook) } },
  })

  reg({
    name: 'nb_source_remove',
    description: '移除 Notebook 中的一个来源(按 source id)。不影响其他来源。',
    parameters: { notebook: { type: 'string', required: true }, source: { type: 'string', required: true } },
    output: { schema: { type: 'object' }, render: (_a, v) => [{ type: 'text', text: text(v) }] },
    async execute(args) { return core.removeSource(args.notebook, args.source) },
  })

  reg({
    name: 'nb_source_refresh',
    description: '刷新 Web 来源:重新 fetch,内容 hash 变化才更新,并记录 log。',
    parameters: { notebook: { type: 'string', required: true }, source: { type: 'string', required: true } },
    timeoutMs: 120000,
    output: { schema: { type: 'object' }, render: (_a, v) => [{ type: 'text', text: text(v) }] },
    async execute(args) { return core.refreshSource(args.notebook, args.source) },
  })

  reg({
    name: 'nb_source_update',
    description: '写回来源正文。主要用于多模态来源:调用 Qwen-MM-Plugins(vision_chat/ocr/ASR/read_video 等)提取文本后写回,状态从 multimodal-pending 变为 indexed。',
    parameters: {
      notebook: { type: 'string', required: true },
      source: { type: 'string', required: true },
      text: { type: 'string', required: true, description: '提取到的文本内容' },
      transcribed_by: { type: 'string', description: '所用工具名,如 mcp__qwen-mm-plugins-api__vision_chat' },
    },
    output: { schema: { type: 'object' }, render: (_a, v) => [{ type: 'text', text: text(v) }] },
    async execute(args) {
      return core.updateSourceText(args.notebook, args.source, args.text, { transcribedBy: args.transcribed_by })
    },
  })

  reg({
    name: 'nb_discover_sources',
    description: '在线搜索发现候选来源(对标 NotebookLM Discover)。只返回候选列表(title/domain/snippet/url);snippet 不是知识——确认后用 nb_import_urls 抓取全文导入。',
    parameters: {
      query: { type: 'string', required: true, description: '关键词/主题/自然语言研究问题' },
      max_results: { type: 'number', description: '最大返回数,默认 10' },
    },
    timeoutMs: 120000,
    output: { schema: { type: 'object' }, render: (_a, v) => [{ type: 'text', text: text(v) }] },
    async execute(args, exec) {
      return core.discoverSources(args.query, { maxResults: args.max_results ?? 10 })
    },
  })

  reg({
    name: 'nb_import_urls',
    description: '抓取并导入网页来源:对每个 URL fetch 全文、提取正文、转 OKF、建索引。用于 nb_discover_sources 确认后的导入。',
    parameters: {
      notebook: { type: 'string', required: true },
      urls: { type: 'array', required: true, items: { type: 'string' }, description: '要导入的 URL 列表' },
      on_duplicate: { type: 'string', enum: ['reject', 'update', 'anyway'] },
    },
    timeoutMs: 300000,
    output: { schema: { type: 'object' }, render: (_a, v) => [{ type: 'text', text: text(v) }] },
    async execute(args) {
      return core.importUrls(args.notebook, args.urls, { onDuplicate: args.on_duplicate ?? 'reject' })
    },
  })

  // ── 工具:检索问答(source-grounded) ──────────────────────────

  reg({
    name: 'nb_query',
    description: '基于 Notebook 选中来源的 RAG 问答:检索→组装证据→回答→引用映射 [n]。只回答选中来源内的内容;证据不足会明确说明,不杜撰。sources 省略时使用全部已索引来源。',
    parameters: {
      notebook: { type: 'string', required: true },
      question: { type: 'string', required: true },
      sources: { type: 'array', items: { type: 'string' }, description: '限定使用的 source id 列表(默认全部)' },
    },
    timeoutMs: 300000,
    output: { schema: { type: 'object' }, render: (_a, v) => [{ type: 'text', text: text(v) }] },
    async execute(args) {
      return core.query(args.notebook, args.question, { sourceIds: args.sources })
    },
  })

  // ── 工具:Studio 七件套 ────────────────────────────────────────

  reg({
    name: 'nb_studio',
    description: '生成 Studio 产物。kind: mindmap(3-5主分支/≤4层)| report(briefing/study-guide/faq/timeline/research/custom)| flashcards(20-50张JSON)| quiz(10-20题,难度30/50/20)| infographic(Mermaid,Qwen-MM 缺失时降级)| slides(≤12页)| table(MD+CSV,缺失值不编造)。全部写入 studio/ 目录并带 provenance。',
    parameters: {
      notebook: { type: 'string', required: true },
      kind: { type: 'string', required: true, enum: ['mindmap', 'report', 'flashcards', 'quiz', 'infographic', 'slides', 'table'] },
      topic: { type: 'string', description: '主题(默认整个知识库综述)' },
      instruction: { type: 'string', description: '附加要求' },
      sources: { type: 'array', items: { type: 'string' }, description: '限定使用的 source id 列表' },
      report_type: { type: 'string', enum: ['briefing', 'study-guide', 'faq', 'timeline', 'research', 'custom'] },
      count: { type: 'number', description: 'flashcards/quiz 的数量建议' },
    },
    timeoutMs: 600000,
    output: { schema: { type: 'object' }, render: (_a, v) => [{ type: 'text', text: text(v) }] },
    async execute(args) {
      return generateStudio(ctx, core, {
        notebook: args.notebook, kind: args.kind, topic: args.topic, instruction: args.instruction,
        sourceIds: args.sources, reportType: args.report_type, count: args.count,
      })
    },
  })

  // ── HTTP API(client 面板消费) ────────────────────────────────

  const PREFIX = '/notebook-studio/api'

  function json(res, code, value) {
    const body = JSON.stringify(value)
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(body)
  }

  async function readBody(req) {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    if (!chunks.length) return {}
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { return {} }
  }

  function requestSessionId(req, { required = false } = {}) {
    const header = req.headers?.['x-dsh-session-id']
    const raw = Array.isArray(header) ? header[0] : header
    if (!String(raw ?? '').trim()) {
      if (required) throw new SessionContextError('该操作需要当前 Harness 对话 ID')
      return null
    }
    const sessionId = String(raw).trim()
    if (!agents?.get?.(sessionId)) {
      throw new SessionContextError('指定的 Harness 对话不存在或尚未加载', 'SESSION_NOT_FOUND', 404)
    }
    return sessionId
  }

  async function handleApi(req, res) {
    const url = new URL(req.url, 'http://local')
    let pathname = url.pathname
    const idx = pathname.indexOf(PREFIX)
    if (idx >= 0) pathname = pathname.slice(idx + PREFIX.length) || '/'
    const parts = pathname.split('/').filter(Boolean).map(p => {
      try { return decodeURIComponent(p) } catch { return p }
    })
    const method = req.method ?? 'GET'
    try {
      // GET /status
      if (method === 'GET' && parts[0] === 'status') {
        const s = await core.status()
        const sessionId = requestSessionId(req)
        return json(res, 200, {
          ...s,
          activationScope: 'session',
          activeNotebook: activePayload(sessionId),
        })
      }

      // POST /preview-url — 抓取单个候选 URL 的正文预览(不导入)
      if (method === 'POST' && parts[0] === 'preview-url') {
        const body = await readBody(req)
        if (!String(body.url ?? '').trim()) return json(res, 400, { error: 'url required' })
        return json(res, 200, await core.previewUrl(body.url))
      }

      // /notebooks...
      if (parts[0] === 'notebooks') {
        if (method === 'GET' && parts.length === 1) return json(res, 200, { notebooks: await core.listNotebooks() })
        if (method === 'POST' && parts.length === 1) {
          const body = await readBody(req)
          if (!String(body.title ?? '').trim()) return json(res, 400, { error: 'title required' })
          return json(res, 200, await core.createNotebook(body.title))
        }
        const nb = parts[1]
        if (!nb) return json(res, 404, { error: 'not found' })
        if (method === 'GET' && parts.length === 2) return json(res, 200, await core.getNotebook(nb))
        if (parts.length === 3) {
          const body = await readBody(req)
          if (parts[2] === 'rename' && method === 'POST') {
            if (!String(body.title ?? '').trim()) return json(res, 400, { error: 'title required' })
            return json(res, 200, await core.renameNotebook(nb, body.title))
          }
          if (parts[2] === 'delete' && method === 'POST') {
            return json(res, 200, await deleteNotebook(nb, { confirm: body.confirm === true }))
          }
          if (parts[2] === 'activate' && method === 'POST') {
            const sessionId = requestSessionId(req, { required: true })
            const detail = await core.getNotebook(nb)
            activations.set(sessionId, detail.id)
            return json(res, 200, { active: { id: detail.id, title: detail.title, sourceCount: detail.sources.length } })
          }
          if (parts[2] === 'sources' && method === 'POST') {
            const { type, path: filePath, url, text, title, onDuplicate } = body
            if (!['file', 'url', 'text'].includes(type)) return json(res, 400, { error: 'type must be file|url|text' })
            return json(res, 200, await core.addSource(nb, { type, path: filePath, url, text, title }, { onDuplicate: onDuplicate ?? 'reject' }))
          }
          if (parts[2] === 'discover' && method === 'POST') {
            if (!String(body.query ?? '').trim()) return json(res, 400, { error: 'query required' })
            return json(res, 200, await core.discoverSources(body.query, { maxResults: body.maxResults ?? 10 }))
          }
          if (parts[2] === 'query' && method === 'POST') {
            if (!String(body.question ?? '').trim()) return json(res, 400, { error: 'question required' })
            return json(res, 200, await core.query(nb, body.question, { sourceIds: body.sourceIds }))
          }
          if (parts[2] === 'studio' && method === 'POST') {
            if (!body.kind) return json(res, 400, { error: 'kind required' })
            return json(res, 200, await generateStudio(ctx, core, {
              notebook: nb, kind: body.kind, topic: body.topic, instruction: body.instruction,
              sourceIds: body.sourceIds, reportType: body.reportType, count: body.count,
            }))
          }
          if (parts[2] === 'import-urls' && method === 'POST') {
            if (!Array.isArray(body.urls) || !body.urls.length) return json(res, 400, { error: 'urls required' })
            return json(res, 200, await core.importUrls(nb, body.urls, { onDuplicate: body.onDuplicate ?? 'reject' }))
          }
        }
        // /notebooks/:id/sources/:sid[/refresh|/remove]
        if (parts[2] === 'sources' && parts.length >= 4) {
          const sid = parts[3]
          if (parts.length === 4 && method === 'GET') {
            const nid = await resolveNid(nb)
            const doc = core.store.readSource(nid, sid)
            if (!doc) return json(res, 404, { error: 'source not found' })
            return json(res, 200, { id: sid, frontmatter: doc.frontmatter, body: doc.body })
          }
          if (parts[4] === 'remove' && method === 'POST') return json(res, 200, await core.removeSource(nb, sid))
          if (parts[4] === 'refresh' && method === 'POST') return json(res, 200, await core.refreshSource(nb, sid))
        }
        // /notebooks/:id/artifact?file=studio/...
        if (parts[2] === 'artifact' && method === 'GET') {
          const file = url.searchParams.get('file') ?? ''
          const nid = await resolveNid(nb)
          const content = core.store.readArtifact(nid, file)
          if (content === null) return json(res, 404, { error: 'artifact not found' })
          return json(res, 200, { file, content })
        }
      }
      return json(res, 404, { error: `no route: ${method} ${pathname}` })
    } catch (error) {
      ctx.logger?.warn?.('[notebook-studio] api error:', error?.stack ?? error)
      const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 500
      return json(res, statusCode, {
        error: String(error?.message ?? error),
        ...(error?.code ? { code: String(error.code) } : {}),
      })
    }
  }

  async function resolveNid(nb) {
    const list = await core.listNotebooks()
    const found = list.find(n => n.id === nb)
    if (found) return found.id
    return core.getNotebook(nb).then(d => d.id).catch(() => { throw new Error(`notebook not found: ${nb}`) })
  }

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: PREFIX,
    handler: handleApi,
  }), 'notebook-studio: api')

  ctx.logger?.info?.('[notebook-studio] ready — root:', core.store.root)
}
