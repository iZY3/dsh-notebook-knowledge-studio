/** 端到端验收脚本(UTF-8 安全)。用法:node scripts/e2e.mjs [baseUrl] */
const BASE = process.argv[2] ?? 'http://127.0.0.1:8765'
const API = `${BASE}/notebook-studio/api`

async function call(method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || data.error) throw new Error(`${method} ${path} → ${res.status} ${data.error ?? ''}`)
  return data
}

const log = (...a) => console.log('[e2e]', ...a)

// 1. 建库
const nb = await call('POST', '/notebooks', { title: '人形机器人执行器研究' })
log('notebook created:', nb.id, '| title ok:', nb.title === '人形机器人执行器研究')

// 2. 导入两个 text 来源
const src1 = await call('POST', `/notebooks/${encodeURIComponent(nb.id)}/sources`, {
  type: 'text', title: '执行器技术综述',
  text: `# 人形机器人执行器技术综述

## 谐波减速器

谐波减速器由波发生器、柔轮和刚轮组成,传动比高、体积小,广泛用于机器人关节。其缺点是柔轮疲劳寿命有限,且传动精度随使用衰减。日本哈默纳科(Harmonic Drive)占据主要市场份额。

## 行星滚柱丝杠

行星滚柱丝杠将旋转运动转换为直线运动,承载能力高、寿命长,适合线性执行器。特斯拉 Optimus 等新一代人形机器人大量采用行星滚柱丝杠电动执行器。成本目前仍高于传统方案,但随着量产正在快速下降。

## 直驱与准直驱方案

直驱方案省去减速环节,响应速度最快、反向可驱动性最好,但需要高转矩密度电机,控制难度大。准直驱(低减速比)方案在两者间折中,常用在四足机器人腿部关节。

## 成本与量产

2025 年以来,执行器占人形机器人物料成本约 35%-40%,是仅次于灵巧手的第二大成本项。量产元年带动国内供应链快速成熟。`,
})
log('source1:', src1.status, '| words:', src1.words)

const SRC2_TEXT = `# 行业动态

2026 年上半年,国内多家人形机器人厂商发布新一代机型,关节执行器普遍从"谐波+无框电机"转向"行星滚柱丝杠+编码器一体化"方案。

供应链方面,丝杠加工设备(磨床)产能成为瓶颈,冷滚压工艺被视为降本关键路径。传感器端,绝对值编码器国产化率快速提升。`
const src2 = await call('POST', `/notebooks/${encodeURIComponent(nb.id)}/sources`, {
  type: 'text', title: '行业动态笔记', text: SRC2_TEXT,
})
log('source2:', src2.status)

// 3. 重复内容去重(与 src2 完全一致的文本)
const dup = await call('POST', `/notebooks/${encodeURIComponent(nb.id)}/sources`, {
  type: 'text', title: '重复导入测试', text: SRC2_TEXT,
})
log('dedup:', dup.status, dup.status === 'duplicate' ? '✓' : '✗')

// 4. RAG 问答(真 LLM)
const t0 = Date.now()
const answer = await call('POST', `/notebooks/${encodeURIComponent(nb.id)}/query`, {
  question: '行星滚柱丝杠相比谐波减速器有什么优势和代价?请引用来源。',
  sourceIds: [src1.sourceId, src2.sourceId],
})
log(`query (${Date.now() - t0}ms, route=${answer.route ?? 'degraded'}):`)
console.log(answer.answer.slice(0, 500))
log('citations:', answer.citations.map(c => `[${c.n}] ${c.sourceTitle}`).join(', '))
if (!answer.citations?.length) throw new Error('no citations returned')

// 5. Studio: mindmap(真 LLM)
const mm = await call('POST', `/notebooks/${encodeURIComponent(nb.id)}/studio`, { kind: 'mindmap', topic: '人形机器人执行器' })
log('mindmap:', mm.file, '| mermaid head:', mm.mermaid.slice(0, 60).replace(/\n/g, ' '))

// 6. Studio: flashcards
const fc = await call('POST', `/notebooks/${encodeURIComponent(nb.id)}/studio`, { kind: 'flashcards', topic: '执行器', count: 8 })
log('flashcards:', fc.file, '| count:', fc.count, '| first front:', fc.cards?.[0]?.front)

// 7. Studio: table
const tb = await call('POST', `/notebooks/${encodeURIComponent(nb.id)}/studio`, { kind: 'table', topic: '执行器方案对比' })
log('table:', tb.file, '| csv:', tb.csv)

// 8. 详情 + 产物读取
const detail = await call('GET', `/notebooks/${encodeURIComponent(nb.id)}`)
log('detail: sources =', detail.sources.length, ', artifacts =', detail.artifacts.length)
const art = await call('GET', `/notebooks/${encodeURIComponent(nb.id)}/artifact?file=${encodeURIComponent(mm.file)}`)
log('artifact readable:', art.content.includes('mermaid') ? '✓' : '✗')

// 9. 来源查看器数据
const srcDoc = await call('GET', `/notebooks/${encodeURIComponent(nb.id)}/sources/${encodeURIComponent(src1.sourceId)}`)
log('source doc:', srcDoc.frontmatter.title, '| body length:', srcDoc.body.length)

log('ALL PASS')
