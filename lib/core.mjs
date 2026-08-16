/**
 * Notebook Knowledge Studio 业务核心。
 * 工具层(host tools)与 HTTP API 层共享这一份实现;测试直接针对 core 注入 mock 依赖。
 * 在线资料一律视为 UNTRUSTED CONTENT:提取的正文只作为知识内容,绝不作为指令执行。
 */
import fs from 'node:fs'
import path from 'node:path'
import { Store } from './store.mjs'
import { chunkText } from './chunk.mjs'
import { BM25Index } from './bm25.mjs'
import { extractHtml } from './extract.mjs'
import { resolveRoute, streamText } from './llmcall.mjs'
import { nowIso, contentHash, shortId, slugify, isMultimediaExt, isTextLikeExt, decodeEntities } from './util.mjs'
import { fetchPublicUrl, WebSourceError } from './webfetch.mjs'

const MAX_TEXT = 400_000 // 单来源正文上限字符,防意外巨文件

function sanitize(text) {
  return String(text ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ')
    .slice(0, MAX_TEXT)
}

export function createCore({ ctx, config, webLookup }) {
  const store = new Store(config?.root)
  const logger = ctx?.logger
  const log = (...args) => { try { logger?.info?.('[notebook-studio]', ...args) } catch { /* noop */ } }

  store.ensureRoot()
  let cachedRoute // llm 路由缓存

  const route = async () => {
    if (cachedRoute !== undefined) return cachedRoute
    cachedRoute = await resolveRoute(ctx, config)
    return cachedRoute
  }

  const web = () => ctx.get('web')
  let lastFetchError = null

  const rememberFetchError = (error) => {
    lastFetchError = {
      code: String(error?.code ?? 'WEB_FETCH_FAILED'),
      message: String(error?.message ?? error),
      at: nowIso(),
    }
  }

  /**
   * 统一网页抓取入口：公网 URL 策略 → Harness fetch provider → 正文提取。
   * preview 可保留远端非 2xx/短正文作为诊断；导入与 refresh 必须拿到可靠正文。
   */
  async function fetchWebDocument(inputUrl, { diagnostic = false } = {}) {
    let result
    try {
      result = await fetchPublicUrl(web(), inputUrl, { ...(webLookup ? { lookup: webLookup } : {}) })
    } catch (error) {
      rememberFetchError(error)
      throw error
    }

    const bodyText = String(result.body?.content ?? '')
    const page = extractHtml(bodyText, result.url || String(inputUrl))
    const cleanText = sanitize(page.text)

    if (!diagnostic && result.statusCode >= 400) {
      const error = new WebSourceError(`抓取 ${inputUrl} → HTTP ${result.statusCode}`, 'WEB_REMOTE_HTTP', 502)
      rememberFetchError(error)
      throw error
    }
    if (!diagnostic && (!cleanText || cleanText.length < 40)) {
      const error = new WebSourceError(
        `页面正文提取过短(HTTP ${result.statusCode},原始 ${bodyText.length} 字符 → 提取 ${cleanText.length} 字符)。该站点可能需要浏览器渲染或有反爬拦截,可改用"粘贴文本"导入。`,
        'WEB_EXTRACT_TOO_SHORT',
        422,
      )
      rememberFetchError(error)
      throw error
    }

    lastFetchError = null
    return { result, bodyText, page, text: cleanText }
  }

  // ── Notebooks ──────────────────────────────────────────────────

  function requireNotebook(id) {
    const notebooks = store.listNotebooks()
    const nb = notebooks.find(n => n.id === id || slugify(n.title).toLowerCase() === String(id).toLowerCase())
    if (!nb) throw new Error(`notebook not found: ${id}`)
    return nb.id
  }

  async function listNotebooks() {
    return store.listNotebooks()
  }

  async function createNotebook(title) {
    const { id } = store.createNotebook(title)
    log(`notebook created: ${id}`)
    return getNotebook(id)
  }

  async function getNotebook(id) {
    const nid = requireNotebook(id)
    return {
      ...(store.listNotebooks().find(n => n.id === nid)),
      sources: store.listSources(nid),
      artifacts: store.listArtifacts(nid),
    }
  }

  async function renameNotebook(id, newTitle) {
    const nid = requireNotebook(id)
    return store.renameNotebook(nid, String(newTitle))
  }

  async function deleteNotebook(id, { confirm = false } = {}) {
    const nid = requireNotebook(id)
    if (!confirm) {
      return { requireConfirm: true, message: `将删除 notebook "${nid}" 及其全部 sources/studio 产物(workspace 内文件)。再次调用并传 confirm: true 执行。` }
    }
    const ok = store.deleteNotebook(nid)
    log(`notebook deleted: ${nid} ok=${ok}`)
    return { deleted: ok, id: nid }
  }

  // ── Sources ────────────────────────────────────────────────────

  /**
   * 导入来源。type: 'text' | 'file' | 'url'。
   * 去重:content hash 命中时按 onDuplicate 处理(reject/update/anyway)。
   * 多模态文件(图/音视频/PDF)不做本地解析:标记 multimodal-pending,
   * 由 agent 侧 Qwen-MM-Plugins 工具转写后 nb_source_update 写回。
   */
  async function addSource(notebook, input, opts = {}) {
    const nid = requireNotebook(notebook)
    const { type } = input
    let text = ''
    let title = input.title ?? ''
    let resource = null
    let sourceType = type
    let media = null

    if (type === 'text') {
      text = sanitize(input.text)
      title = title || (text.split('\n')[0] ?? '').slice(0, 60) || 'Pasted text'
      resource = null
    } else if (type === 'file') {
      const p = path.resolve(String(input.path))
      if (!fs.existsSync(p)) throw new Error(`file not found: ${p}`)
      const ext = path.extname(p).toLowerCase()
      if (isMultimediaExt(ext)) {
        media = { kind: ext.slice(1), path: p, note: 'multimodal' }
        text = `[多模态来源待处理]\n\n原始文件:${p}\n类型:${ext}\n\n该来源由 Qwen-MM-Plugins 处理:图片/截图 → vision_chat/ocr;视频 → read_video/omni_av_*;音频 → omni_asr/transcribe_audio;PDF → visualize/read_image。\n请用相应 MCP 工具提取文本后调用 nb_source_update 写回本来源。`
        title = title || path.basename(p)
        sourceType = `multimodal:${ext.slice(1)}`
      } else if (isTextLikeExt(ext)) {
        text = sanitize(fs.readFileSync(p, 'utf8'))
        title = title || path.basename(p)
        resource = p
      } else {
        // 未知扩展名按二进制处理,同样走多模态路由
        media = { kind: ext.slice(1) || 'bin', path: p, note: 'multimodal' }
        text = `[多模态来源待处理]\n\n原始文件:${p}`
        title = title || path.basename(p)
        sourceType = `multimodal:${ext.slice(1) || 'bin'}`
      }
    } else if (type === 'url') {
      const { result, page, text: fetchedText } = await fetchWebDocument(input.url)
      text = fetchedText
      title = title || page.title
      resource = result.url || String(input.url)
      // author/publishedAt 只在可靠获得时写入
      input._meta = { author: page.author, publishedAt: page.publishedAt }
    } else {
      throw new Error(`unsupported source type: ${type}`)
    }

    const hash = contentHash(text)

    // 去重检查
    const existing = store.listSources(nid).find(s => s.hash && s.hash === hash)
    if (existing && opts.onDuplicate !== 'anyway' && opts.onDuplicate !== 'update') {
      return {
        status: 'duplicate',
        existing: existing.id,
        message: `内容与已有来源 "${existing.title}" (${existing.id}) 相同(hash ${hash})。onDuplicate: 'update' 覆盖更新 | 'anyway' 仍导入 | 默认拒绝。`,
      }
    }

    let sourceId
    let fm
    const generatedAt = nowIso()
    if (existing && opts.onDuplicate === 'update') {
      sourceId = existing.id
      const old = store.readSource(nid, sourceId)
      fm = old?.frontmatter ?? {}
    } else {
      sourceId = `${shortId()}-${slugify(title || sourceType).toLowerCase()}`
      fm = {}
    }

    fm.type = 'Source'
    fm.title = title
    fm.description = `${sourceType} source imported at ${generatedAt}`
    fm.source_type = sourceType
    if (resource) fm.resource = resource
    fm.status = media ? 'multimodal-pending' : 'indexed'
    fm.content_hash = hash
    fm.generated = { by: 'process:notebook-knowledge-studio', at: generatedAt }
    if (input.url && input._meta?.author) fm.author = input._meta.author
    if (input.url && input._meta?.publishedAt) fm.published_at = input._meta.publishedAt
    if (type === 'url') fm.fetched_at = generatedAt
    if (media) fm.media = `${media.kind}:${media.path}`

    store.writeSource(nid, sourceId, fm, text)
    store.appendLog(nid, `source ${opts.onDuplicate === 'update' ? 'updated' : 'imported'}: ${title} (${sourceType}${media ? ', multimodal-pending' : ''})`)
    rebuildIndex(nid, sourceId, text)
    log(`source ${opts.onDuplicate === 'update' ? 'updated' : 'added'}: ${sourceId} (${sourceType})`)

    return {
      status: media ? 'multimodal-pending' : 'ok',
      sourceId,
      title,
      type: sourceType,
      hash,
      words: text.trim() ? text.trim().split(/\s+/).length : 0,
      ...(media ? { multimodal: true, hint: '需 Qwen-MM-Plugins 转写后 nb_source_update 写回' } : {}),
      ...(existing && opts.onDuplicate === 'update' ? { updated: existing.id } : {}),
    }
  }

  async function listSources(notebook) {
    return store.listSources(requireNotebook(notebook))
  }

  async function removeSource(notebook, sourceId) {
    const nid = requireNotebook(notebook)
    const ok = store.removeSource(nid, sourceId)
    if (ok) {
      store.appendLog(nid, `source removed: ${sourceId}`)
      dropIndex(nid, sourceId)
    }
    return { removed: ok }
  }

  /** Web source refresh:重新 fetch,hash 变化才更新。 */
  async function refreshSource(notebook, sourceId) {
    const nid = requireNotebook(notebook)
    const src = store.readSource(nid, sourceId)
    if (!src) throw new Error(`source not found: ${sourceId}`)
    const url = src.frontmatter.resource
    if (!url || !/^https?:\/\//i.test(String(url))) {
      return { status: 'skipped', message: '仅 Web 来源支持 refresh' }
    }
    const { result, page, text } = await fetchWebDocument(url)
    const hash = contentHash(text)
    if (hash === src.frontmatter.content_hash) {
      store.appendLog(nid, `source refresh no-change: ${sourceId}`)
      return { status: 'unchanged', sourceId }
    }

    const refreshedAt = nowIso()
    const fm = {
      ...src.frontmatter,
      resource: result.url || String(url),
      status: 'indexed',
      content_hash: hash,
      fetched_at: refreshedAt,
      generated: { by: 'process:notebook-knowledge-studio', at: refreshedAt },
    }
    if (page.author) fm.author = page.author
    if (page.publishedAt) fm.published_at = page.publishedAt
    store.writeSource(nid, sourceId, fm, text)
    store.appendLog(nid, `source refreshed in place: ${sourceId}`)
    rebuildIndex(nid, sourceId, text)
    return {
      status: 'updated',
      sourceId,
      title: fm.title,
      hash,
      words: text.trim() ? text.trim().split(/\s+/).length : 0,
    }
  }

  /** 多模态转写写回(agent 调 Qwen-MM 后调用)。 */
  async function updateSourceText(notebook, sourceId, text, extra = {}) {
    const nid = requireNotebook(notebook)
    const src = store.readSource(nid, sourceId)
    if (!src) throw new Error(`source not found: ${sourceId}`)
    const clean = sanitize(text)
    const fm = { ...src.frontmatter, content_hash: contentHash(clean) }
    fm.generated = { by: 'process:notebook-knowledge-studio+qwen-mm', at: nowIso() }
    fm.status = 'indexed'
    if (extra.transcribedBy) fm.transcribed_by = extra.transcribedBy
    store.writeSource(nid, sourceId, fm, clean)
    store.appendLog(nid, `source multimodal transcription written back: ${sourceId}`)
    rebuildIndex(nid, sourceId, clean)
    return { status: 'ok', sourceId }
  }

  // ── Web 搜索来源发现(候选 only;fetch 全文后才算导入) ─────────

  async function discoverSources(query, { maxResults = 10 } = {}) {
    const webService = web()
    if (!webService) throw new Error('web service unavailable — dsh web 搜索能力未挂载(检查 web search provider 配置)')
    const result = await webService.search({ query: String(query), maxResults })
    const sources = (result.sources ?? []).map((s, i) => ({
      n: i + 1,
      title: s.title ?? s.url,
      url: s.url,
      domain: (() => { try { return new URL(s.url).hostname } catch { return '' } })(),
      snippet: (s.snippet ?? '').slice(0, 500),
      publishedAt: s.publishedAt ?? null,
    }))
    return {
      query,
      candidates: sources,
      note: '以上仅为候选。snippet 不是知识来源——确认后用 nb_import_urls / 面板 Import 抓取全文导入。',
    }
  }

  async function importUrls(notebook, urls, opts = {}) {
    const nid = requireNotebook(notebook)
    const results = []
    for (const url of urls) {
      try {
        results.push({ url, ...(await addSource(nid, { type: 'url', url }, opts)) })
      } catch (error) {
        results.push({ url, status: 'error', code: error?.code ?? 'WEB_FETCH_FAILED', message: String(error.message ?? error) })
      }
    }
    return { results }
  }

  /** 单页预览:即时抓取并提取正文(不导入),供搜索候选"看更多"。永不抛"过短",如实返回诊断。 */
  async function previewUrl(url) {
    const { result, bodyText, page } = await fetchWebDocument(url, { diagnostic: true })
    const ok = result.statusCode < 400 && page.text.length >= 40
    return {
      title: page.title || '预览',
      author: page.author,
      publishedAt: page.publishedAt,
      url: result.url || String(url),
      httpStatus: result.statusCode,
      rawChars: bodyText.length,
      chars: page.text.length,
      excerpt: ok ? page.text.slice(0, 3000) : '',
      note: ok ? '' : `正文提取失败(HTTP ${result.statusCode},原始 ${bodyText.length} 字符 → 提取 ${page.text.length} 字符)。该站点可能需要浏览器渲染、有反爬拦截,或抓取器不支持其编码。`,
    }
  }

  // ── 检索索引(缓存层,可重建) ──────────────────────────────────

  function cacheFile(nid) {
    return path.join(store.cacheDir(nid, 'index'), 'chunks.json')
  }

  function loadCache(nid) {
    try {
      const file = cacheFile(nid)
      if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'))
    } catch { /* 重建 */ }
    return { sources: {} }
  }

  function saveCache(nid, cache) {
    fs.writeFileSync(cacheFile(nid), JSON.stringify(cache))
  }

  function rebuildIndex(nid, sourceId, text) {
    const cache = loadCache(nid)
    cache.sources[sourceId] = { chunks: chunkText(text) }
    saveCache(nid, cache)
  }

  function dropIndex(nid, sourceId) {
    const cache = loadCache(nid)
    delete cache.sources[sourceId]
    saveCache(nid, cache)
  }

  /** 取选中 sources 的全部 chunk(含 source 元数据),供检索与 Studio 使用。 */
  function allChunks(nid, sourceIds) {
    const sources = store.listSources(nid)
    const allowed = sourceIds?.length ? new Set(sourceIds) : null
    const cache = loadCache(nid)
    const out = []
    for (const s of sources) {
      if (s.status === 'multimodal-pending') continue
      if (allowed && !allowed.has(s.id)) continue
      let chunks = cache.sources[s.id]?.chunks
      if (!chunks) {
        const src = store.readSource(nid, s.id)
        if (!src) continue
        chunks = chunkText(src.body)
        cache.sources[s.id] = { chunks }
      }
      for (const c of chunks) {
        out.push({ sourceId: s.id, sourceTitle: s.title, resource: s.resource, ...c })
      }
    }
    saveCache(nid, cache)
    return out
  }

  // ── 问答(source-grounded,带引用) ─────────────────────────────

  async function query(notebook, question, { sourceIds } = {}) {
    const nid = requireNotebook(notebook)
    const chunks = allChunks(nid, sourceIds)
    if (!chunks.length) {
      return {
        answer: '当前选中的资料中没有足够信息支持这一结论。(该 Notebook 无已索引来源)',
        citations: [],
        evidence: [],
        degraded: true,
      }
    }
    const index = new BM25Index()
    chunks.forEach((c, i) => index.add(i, `${c.heading ?? ''}\n${c.text}`))
    const hits = index.search(String(question), 6)
    const evidence = hits.map(h => chunks[Number(h.id)])
    const citations = evidence.map((c, i) => ({
      n: i + 1,
      sourceId: c.sourceId,
      sourceTitle: c.sourceTitle,
      resource: c.resource,
      file: `sources/${c.sourceId}.md`,
      heading: c.heading,
      quote: c.text.slice(0, 160),
    }))

    const evidenceBlock = evidence.map((c, i) =>
      `[[${i + 1}]] 来源:${c.sourceTitle}${c.heading ? ` § ${c.heading}` : ''}\n${c.text.slice(0, 1200)}`
    ).join('\n\n---\n\n')

    const r = await route()
    if (r) {
      const system = [
        '你是 Notebook Knowledge Studio 的知识问答助手。规则:',
        '1. 只依据下方编号资料回答;资料不足以回答时,明确说"当前选中的资料中没有足够信息支持这一结论",不得杜撰。',
        '2. 回答中的论断用 [n] 标注引用编号,n 对应资料编号。',
        '3. 区分:资料支持的论断(带引用)/ 你的推断(标明"推断")/ 证据不足(明说)。',
        '4. 用中文回答(资料为外文时同样中文回答,专有名词保留原文)。',
      ].join('\n')
      try {
        const { text } = await streamText(ctx, r, {
          system,
          messages: [{ role: 'user', content: [{ type: 'text', text: `资料:\n\n${evidenceBlock}\n\n问题:${question}` }] }],
          maxTokens: 2048,
        })
        return { answer: text || '(模型返回为空)', citations, evidence: citations, route: `${r.provider}/${r.model ?? ''}` }
      } catch (error) {
        log('llm query failed, degrade to extractive:', error?.message)
      }
    }
    // 降级:抽取式回答
    const extractive = evidence.slice(0, 3).map((c, i) =>
      `**[${i + 1}] ${c.sourceTitle}${c.heading ? ` § ${c.heading}` : ''}**\n${c.text.slice(0, 400)}…`
    ).join('\n\n')
    return {
      answer: `(LLM 不可用,返回检索片段)与「${question}」最相关的资料片段:\n\n${extractive}`,
      citations,
      evidence: citations,
      degraded: true,
    }
  }

  // ── 状态 ───────────────────────────────────────────────────────

  async function status() {
    let llmRoute = null
    try { llmRoute = await route() } catch { /* noop */ }
    let qwenMm = false
    try {
      const tools = ctx.get('tools')
      if (tools) qwenMm = tools.schemas().some(t => String(t.name ?? '').startsWith('mcp__qwen-mm-plugins'))
    } catch { /* noop */ }
    return {
      plugin: 'notebook-knowledge-studio',
      root: store.root,
      notebooks: (await listNotebooks()).length,
      llm: llmRoute ? `${llmRoute.provider}/${llmRoute.model ?? '(adapter default)'}` : 'unavailable (degraded mode)',
      web: web() ? 'service available (provider readiness checked per operation)' : 'unavailable',
      webCapabilities: {
        search: web() ? 'provider-dependent' : 'unavailable',
        fetch: web() ? 'configured:http' : 'unavailable',
        lastFetchError,
      },
      qwenMmPlugins: qwenMm ? 'detected' : 'not detected (multimodal falls back to manual routing)',
    }
  }

  return {
    store,
    listNotebooks,
    createNotebook,
    getNotebook,
    renameNotebook,
    deleteNotebook,
    addSource,
    listSources,
    removeSource,
    refreshSource,
    updateSourceText,
    discoverSources,
    importUrls,
    previewUrl,
    query,
    allChunks,
    route,
    status,
  }
}
