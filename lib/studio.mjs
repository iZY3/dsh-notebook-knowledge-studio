/**
 * Studio 七件套生成器:Mind Map / Reports / Flashcards / Quiz / Infographic / Slide Deck / Data Table。
 * 量化规范来自产品提示词(merged.md 第 19-25 节);全部产物带 provenance frontmatter;
 * LLM 不可用时降级为抽取式模板,绝不阻塞;不伪造图片生成。
 */
import { BM25Index } from './bm25.mjs'
import { streamText } from './llmcall.mjs'
import { nowIso, shortId, slugify } from './util.mjs'

const KIND_DIRS = {
  mindmap: 'mindmaps', report: 'reports', flashcards: 'flashcards', quiz: 'quizzes',
  infographic: 'infographics', slides: 'slides', table: 'tables',
}

const REPORT_TYPES = ['briefing', 'study-guide', 'faq', 'timeline', 'research', 'custom']

function artFm(kind, title, sourceIds) {
  return {
    type: 'StudioArtifact',
    kind,
    title,
    status: 'stable',
    sources: sourceIds.map(id => ({ id })),
    generated: { by: 'process:notebook-knowledge-studio', at: nowIso() },
  }
}

/** 从 chunks 里选与 topic 相关的证据上下文。 */
function evidenceFor(chunks, topic, limit = 24) {
  if (!chunks.length) return ''
  const index = new BM25Index()
  chunks.forEach((c, i) => index.add(i, `${c.heading ?? ''}\n${c.text}`))
  const hits = topic ? index.search(topic, limit) : chunks.slice(0, limit).map((_, i) => ({ id: String(i) }))
  const picked = (hits.length ? hits : chunks.slice(0, limit).map((_, i) => ({ id: String(i) }))).map(h => chunks[Number(h.id)])
  return picked.map((c, i) => `[[${i + 1}]] ${c.sourceTitle}${c.heading ? ` § ${c.heading}` : ''}\n${c.text.slice(0, 800)}`).join('\n\n')
}

/** LLM 生成文本;失败记录原因并返回 null(调用方降级)。 */
async function llmText(ctx, route, system, user, maxTokens = 3072, label = 'llm') {
  try {
    const { text } = await streamText(ctx, route, {
      system, messages: [{ role: 'user', content: [{ type: 'text', text: user }] }], maxTokens,
    })
    return (text || '').trim() || null
  } catch (error) {
    try { ctx.logger?.warn?.('[notebook-studio] studio llm failed:', label, error?.message ?? error) } catch { /* noop */ }
    return null
  }
}

/** 从 LLM 输出中抠 JSON(容忍 ```json 围栏与前后说明文字)。 */
function extractJson(text) {
  if (!text) return null
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const raw = fenced ? fenced[1] : text
  const start = Math.min(...['[', '{'].map(ch => { const i = raw.indexOf(ch); return i === -1 ? Infinity : i }))
  if (!isFinite(start)) return null
  const openCh = raw[start]
  const closeCh = openCh === '[' ? ']' : '}'
  const end = raw.lastIndexOf(closeCh)
  if (end <= start) return null
  try { return JSON.parse(raw.slice(start, end + 1)) } catch { return null }
}

// ── 各生成器 ─────────────────────────────────────────────────────

async function genMindmap(ctx, core, store, nid, route, { topic, instruction, sourceIds }) {
  const chunks = core.allChunks(nid, sourceIds)
  const corpus = evidenceFor(chunks, topic, 30)
  const used = [...new Set(chunks.map(c => c.sourceId))]
  let body = null
  if (route) {
    body = await llmText(ctx, route,
      '你是知识结构化专家。基于资料生成 Mermaid mindmap(第一行为 mindmap),遵守:中心概念 1 个;主分支 3-5 个,覆盖主题主要维度且互不重叠;每主分支 2-4 个子分支;总深度≤4 层;每节点≤5 个词的短语;必须有优先级层次,不得泛化放射展开。只输出 mindmap 代码,不要解释。',
      `主题:${topic ?? chunks[0]?.sourceTitle ?? '知识库综述'}\n${instruction ? `附加要求:${instruction}\n` : ''}资料:\n${corpus}`)
  }
  if (!body) {
    // 降级:按来源标题+小节标题构建
    const title = topic ?? '知识库'
    const lines = ['mindmap', `  root((${title}))`]
    const bySource = new Map()
    for (const c of chunks.slice(0, 60)) {
      if (!bySource.has(c.sourceId)) bySource.set(c.sourceId, [])
      if (c.heading) bySource.get(c.sourceId).push(c.heading)
    }
    let branch = 0
    for (const [sid, headings] of bySource) {
      if (branch >= 5) break
      const src = chunks.find(c => c.sourceId === sid)
      lines.push(`  ${String(src?.sourceTitle ?? sid).slice(0, 18)}`)
      for (const h of [...new Set(headings)].slice(0, 4)) lines.push(`    ${h.slice(0, 18)}`)
      branch++
    }
    body = lines.join('\n')
  }
  const title = `Mind Map — ${topic ?? '知识综述'}`
  const fm = artFm('mindmap', title, used)
  const md = `# ${title}\n\n\`\`\`mermaid\n${body.replace(/^```mermaid|```$/gm, '').trim()}\n\`\`\`\n`
  const rel = store.writeArtifact(nid, 'mindmap', `${shortId()}-${slugify(title)}.md`, fm, md)
  return { kind: 'mindmap', title, file: rel, mermaid: body, sources: used }
}

const REPORT_SPECS = {
  'briefing': 'Briefing Document,结构:## BLUF(2 句话核心结论);## Key Findings(3-5 条);## 详细分析(每条发现展开);## 结论与建议;## 引用来源',
  'study-guide': 'Study Guide,结构:## 学习目标;## 核心概念(带定义);## 关键问题与答案;## 知识框架;## 复习要点',
  'faq': 'FAQ,10-15 个最常见问题,每问配基于来源的回答并标注来源',
  'timeline': 'Timeline,按时间顺序的关键事件,每条含时间、事件、重要性,可加因果标注',
  'research': 'Research Report,含摘要/方法线索/发现/局限/来源',
  'custom': '按用户指定结构组织',
}

async function genReport(ctx, core, store, nid, route, { topic, instruction, sourceIds, reportType = 'briefing' }) {
  const type = REPORT_TYPES.includes(reportType) ? reportType : 'briefing'
  const chunks = core.allChunks(nid, sourceIds)
  if (!chunks.length) throw new Error('没有可用的已索引来源')
  const corpus = evidenceFor(chunks, topic, 30)
  const used = [...new Set(chunks.map(c => c.sourceId))]
  const sourcesList = chunks.map((c, i) => `[${i + 1}] ${c.sourceTitle}`).join('\n')
  let md = null
  if (route) {
    md = await llmText(ctx, route,
      `你是研究分析师,基于资料写 ${REPORT_SPECS[type]}。要求:headings/lists/tables/citations(用 [[n]] 引用资料编号);基于来源,不杜撰;资料不足处明说。输出 Markdown 正文(不含 frontmatter)。`,
      `报告主题:${topic ?? chunks[0]?.sourceTitle}\n${instruction ? `附加要求:${instruction}\n` : ''}资料:\n${corpus}\n\n来源清单:\n${sourcesList}`)
  }
  if (!md) {
    md = `# Report — ${topic ?? '知识综述'}(${type})\n\n> (LLM 不可用,以下为检索片段拼接的降级版本)\n\n${corpus.slice(0, 3000)}\n`
  }
  const title = `${REPORT_SPECS[type].split(',')[0]} — ${topic ?? '知识综述'}`
  const fm = artFm('report', title, used)
  fm.report_type = type
  const rel = store.writeArtifact(nid, 'report', `${shortId()}-${slugify(title)}.md`, fm, `# ${title}\n\n${md.replace(/^#.*\n/, '')}`)
  return { kind: 'report', reportType: type, title, file: rel, markdown: md, sources: used }
}

const FLASHCARD_SCHEMA = `[{"front":"概念或问题(≤10 词)","back":"答案(2-3 句,含关键细节)","explanation":"补充说明","difficulty":"easy|medium|hard","source":"来源标题"}]`

async function genFlashcards(ctx, core, store, nid, route, { topic, instruction, sourceIds, count }) {
  const chunks = core.allChunks(nid, sourceIds)
  if (!chunks.length) throw new Error('没有可用的已索引来源')
  const corpus = evidenceFor(chunks, topic, 30)
  const used = [...new Set(chunks.map(c => c.sourceId))]
  const n = Math.min(Math.max(Number(count) || 24, 8), 60)
  let cards = null
  if (route) {
    const raw = await llmText(ctx, route,
      `你是学习卡片设计专家。基于资料生成 ${n} 张闪卡(目标 20-50 张区间内)。每卡:front ≤10 词;back 2-3 句完整准确;difficulty ∈ easy/medium/hard;source 填来源标题;聚焦单一知识点;覆盖资料主要概念。只输出 JSON 数组,不要输出其他文字,schema:${FLASHCARD_SCHEMA}`,
      `${topic ? `主题:${topic}\n` : ''}${instruction ? `附加要求:${instruction}\n` : ''}资料:\n${corpus}`,
      8192, 'flashcards')
    cards = extractJson(raw)
    if (Array.isArray(cards)) cards = cards.filter(c => c && c.front && c.back).slice(0, 60)
  }
  if (!Array.isArray(cards) || !cards.length) {
    // 降级:小节标题 → 卡片
    cards = [...new Set(chunks.map(c => `${c.sourceTitle}|${c.heading ?? c.sourceTitle}`))].slice(0, Math.min(n, 30)).map(pair => {
      const [st, h] = pair.split('|')
      return { front: h.slice(0, 40), back: `(降级生成)见来源《${st}》「${h}」小节;LLM 可用后重新生成可获得完整卡片。`, explanation: '', difficulty: 'medium', source: st }
    })
  }
  const title = `Flashcards — ${topic ?? '核心概念'}`
  const rows = cards.map((c, i) => `| ${i + 1} | ${c.front} | ${String(c.back).replace(/\|/g, '\\|')} | ${c.difficulty ?? 'medium'} |`).join('\n')
  const md = `# ${title}\n\n共 ${cards.length} 张。\n\n| # | 正面 | 背面 | 难度 |\n|---|------|------|------|\n${rows}\n\n\`\`\`json\n${JSON.stringify(cards.map((c, i) => ({ id: i + 1, ...c })), null, 2)}\n\`\`\`\n`
  const fm = artFm('flashcards', title, used)
  fm.count = cards.length
  const rel = store.writeArtifact(nid, 'flashcards', `${shortId()}-${slugify(title)}.md`, fm, md)
  return { kind: 'flashcards', title, file: rel, count: cards.length, cards, sources: used }
}

const QUIZ_SCHEMA = `[{"type":"multiple_choice|true_false|short_answer","question":"题干","options":["A","B","C","D"],"answer":"正确答案","explanation":"基于来源的解析","difficulty":"easy|medium|hard"}]`

async function genQuiz(ctx, core, store, nid, route, { topic, instruction, sourceIds, count }) {
  const chunks = core.allChunks(nid, sourceIds)
  if (!chunks.length) throw new Error('没有可用的已索引来源')
  const corpus = evidenceFor(chunks, topic, 30)
  const used = [...new Set(chunks.map(c => c.sourceId))]
  const n = Math.min(Math.max(Number(count) || 14, 5), 30)
  let quiz = null
  if (route) {
    const raw = await llmText(ctx, route,
      `你是命题专家。基于资料出 ${n} 道题(建议 10-20 题):难度分布约 30% easy / 50% medium / 20% hard;题型混合 multiple_choice(4 项,干扰项合理但明显错误)/true_false/short_answer;explanation 必须基于资料;覆盖核心内容。只输出 JSON 数组,不要输出其他文字,schema:${QUIZ_SCHEMA}(true_false/short_answer 可省略 options)`,
      `${topic ? `主题:${topic}\n` : ''}${instruction ? `附加要求:${instruction}\n` : ''}资料:\n${corpus}`,
      8192, 'quiz')
    quiz = extractJson(raw)
    if (Array.isArray(quiz)) quiz = quiz.filter(q => q && q.question && q.answer).slice(0, 30)
  }
  if (!Array.isArray(quiz) || !quiz.length) {
    quiz = chunks.filter(c => c.heading).slice(0, Math.min(n, 20)).map(c => ({
      type: 'short_answer', question: `《${c.sourceTitle}》中「${c.heading}」讲了什么?`, options: [],
      answer: c.text.slice(0, 200), explanation: '(降级生成,见来源原文)', difficulty: 'medium', source: c.sourceTitle,
    }))
  }
  const title = `Quiz — ${topic ?? '知识测验'}`
  const md = `# ${title}\n\n共 ${quiz.length} 题。答题后再看答案。\n\n${quiz.map((q, i) => {
    const opts = Array.isArray(q.options) && q.options.length ? `\n   ${q.options.map((o, j) => `${'ABCD'[j] ?? '-'}) ${o}`).join('\n   ')}` : ''
    return `\n**${i + 1}. ${q.question}**${opts}\n\n<details><summary>答案</summary>\n\n${q.answer}\n\n${q.explanation ?? ''}\n\n</details>\n`
  }).join('')}\n\`\`\`json\n${JSON.stringify(quiz.map((q, i) => ({ id: i + 1, ...q })), null, 2)}\n\`\`\`\n`
  const fm = artFm('quiz', title, used)
  fm.count = quiz.length
  const rel = store.writeArtifact(nid, 'quiz', `${shortId()}-${slugify(title)}.md`, fm, md)
  return { kind: 'quiz', title, file: rel, count: quiz.length, quiz, sources: used }
}

async function genInfographic(ctx, core, store, nid, route, { topic, instruction, sourceIds }) {
  const chunks = core.allChunks(nid, sourceIds)
  if (!chunks.length) throw new Error('没有可用的已索引来源')
  const corpus = evidenceFor(chunks, topic, 24)
  const used = [...new Set(chunks.map(c => c.sourceId))]
  let structure = null
  if (route) {
    structure = await llmText(ctx, route,
      '你是信息图设计师。基于资料输出信息图文字稿,结构:## 标题与主题;## 核心数据/统计(如有,标注来源);## Mermaid 图(graph TD,概念关系/流程);## 关键要点(带图标符号);## 配色方案建议。信息层次清晰,视觉元素优先,文字精炼。输出 Markdown。',
      `主题:${topic ?? '知识结构'}\n${instruction ? `附加要求:${instruction}\n` : ''}资料:\n${corpus}`)
  }
  if (!structure) {
    structure = `## 标题与主题\n\n${topic ?? '知识结构'}\n\n## 关键要点\n\n${chunks.slice(0, 5).map((c, i) => `- ${'✦❖▲●■'[i % 5]} ${c.heading ?? c.sourceTitle}`).join('\n')}\n\n(降级版本:LLM 不可用)`
  }
  const title = `Infographic — ${topic ?? '信息图'}`
  const fm = artFm('infographic', title, used)
  fm.visual = 'markdown-brief'
  const md = `# ${title}\n\n${structure}\n\n> 视觉渲染说明:文字稿/图表已就绪;位图生成需 Qwen-MM-Plugins(mcp__qwen-mm-plugins-api)。未检测到可用图片生成时以本 Markdown/Mermaid 呈现,不伪造图片。\n`
  const rel = store.writeArtifact(nid, 'infographic', `${shortId()}-${slugify(title)}.md`, fm, md)
  return { kind: 'infographic', title, file: rel, markdown: structure, visualBrief: true, sources: used }
}

async function genSlides(ctx, core, store, nid, route, { topic, instruction, sourceIds }) {
  const chunks = core.allChunks(nid, sourceIds)
  if (!chunks.length) throw new Error('没有可用的已索引来源')
  const corpus = evidenceFor(chunks, topic, 30)
  const used = [...new Set(chunks.map(c => c.sourceId))]
  let deck = null
  if (route) {
    deck = await llmText(ctx, route,
      '你是演示设计专家。基于资料生成幻灯片组,规则:总页数≤12;封面(标题+副标题);目录(3-5 章节);内容页每要点 2-4 个支撑点、每页≤5 个要点、要点用短语;以里程碑/决策点为导向;最后是总结页(核心 takeaways)与来源页。格式:每页以 --- 分隔,页内用 "## 页标题" 开头,要点用列表,[图片/图表占位描述] 单列一行。输出 Markdown。',
      `主题:${topic ?? '知识汇报'}\n${instruction ? `附加要求:${instruction}\n` : ''}资料:\n${corpus}`)
  }
  if (!deck) {
    deck = `## ${topic ?? '知识汇报'}\n\n- (降级版本:LLM 不可用)\n- 来源:${[...new Set(chunks.map(c => c.sourceTitle))].slice(0, 5).join('、')}\n\n---\n\n${chunks.slice(0, 8).map(c => `## ${c.heading ?? c.sourceTitle}\n\n- ${c.text.slice(0, 100)}`).join('\n\n---\n\n')}`
  }
  const title = `Slide Deck — ${topic ?? '知识汇报'}`
  const fm = artFm('slides', title, used)
  const md = `# ${title}\n\n${deck}`
  const rel = store.writeArtifact(nid, 'slides', `${shortId()}-${slugify(title)}.md`, fm, md)
  return { kind: 'slides', title, file: rel, deck, sources: used }
}

async function genTable(ctx, core, store, nid, route, { topic, instruction, sourceIds }) {
  const chunks = core.allChunks(nid, sourceIds)
  if (!chunks.length) throw new Error('没有可用的已索引来源')
  const corpus = evidenceFor(chunks, topic, 24)
  const used = [...new Set(chunks.map(c => c.sourceId))]
  let table = null
  if (route) {
    table = await llmText(ctx, route,
      '你是数据整理专家。从资料提取结构化数据合成 Markdown 表格:每列标题清晰;每行一个条目;缺失值写 null 或 —,严禁编造;末行可不总结。适用:对比/汇总/分类/属性表。输出:先一行表格标题说明,然后 Markdown 表格。',
      `${topic ? `提取目标:${topic}\n` : ''}${instruction ? `附加要求:${instruction}\n` : ''}资料:\n${corpus}`,
      6144, 'table')
  }
  let csv = null
  const mdTable = table?.match(/(\|.+\|\n\|[-: |]+\|\n(?:\|.*\|\n?)+)/)
  if (mdTable) {
    csv = mdTable[1].trim().split('\n').map(row => row.replace(/^\||\|$/g, '').split('|').map(cell => {
      const c = cell.trim()
      return /[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : (c === '—' ? 'null' : c)
    }).join(',')).join('\n')
  }
  if (!table) {
    table = `| 来源 | 类型 | 小节 |\n|------|------|------|\n${chunks.slice(0, 12).map(c => `| ${c.sourceTitle.replace(/\|/g, '\\|')} | source | ${(c.heading ?? '—').replace(/\|/g, '\\|')} |`).join('\n')}\n\n(降级版本:LLM 不可用)`
  }
  const title = `Data Table — ${topic ?? '结构化提取'}`
  const fm = artFm('table', title, used)
  const md = `# ${title}\n\n${table}\n`
  const rel = store.writeArtifact(nid, 'table', `${shortId()}-${slugify(title)}.md`, fm, md)
  let csvRel = null
  if (csv) csvRel = store.writeRawArtifact(nid, 'table', rel.replace(/^studio\/tables\//, '').replace(/\.md$/, '.csv'), csv)
  return { kind: 'table', title, file: rel, markdown: table, csv: csvRel, sources: used }
}

// ── 入口 ─────────────────────────────────────────────────────────

export async function generateStudio(ctx, core, { notebook, kind, topic, instruction, sourceIds, reportType, count }) {
  const nid = (() => {
    const list = core.store.listNotebooks()
    const nb = list.find(n => n.id === notebook || slugify(n.title).toLowerCase() === String(notebook).toLowerCase())
    if (!nb) throw new Error(`notebook not found: ${notebook}`)
    return nb.id
  })()
  const store = core.store
  const route = await core.route().catch(() => null)
  const opts = { topic, instruction, sourceIds, reportType, count }
  switch (kind) {
    case 'mindmap': return genMindmap(ctx, core, store, nid, route, opts)
    case 'report': return genReport(ctx, core, store, nid, route, opts)
    case 'flashcards': return genFlashcards(ctx, core, store, nid, route, opts)
    case 'quiz': return genQuiz(ctx, core, store, nid, route, opts)
    case 'infographic': return genInfographic(ctx, core, store, nid, route, opts)
    case 'slides': return genSlides(ctx, core, store, nid, route, opts)
    case 'table': return genTable(ctx, core, store, nid, route, opts)
    default: throw new Error(`unknown studio kind: ${kind}(可用:mindmap|report|flashcards|quiz|infographic|slides|table)`)
  }
}
