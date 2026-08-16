import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createCore } from '../lib/core.mjs'
import { generateStudio } from '../lib/studio.mjs'

/** 无 web/llm/tools 服务的 mock ctx → 全部走降级路径。 */
function mockCtx(root) {
  return {
    get: (name) => undefined,
    logger: undefined,
    _root: root,
  }
}

function tmpCore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nks-core-'))
  const root = path.join(dir, '.notebook-knowledge')
  const ctx = mockCtx(root)
  const core = createCore({ ctx, config: { root } })
  return { core, ctx, dir }
}

test('集成:text 来源导入 → 去重 → 检索问答(降级) → 引用', async () => {
  const { core } = tmpCore()
  const nb = await core.createNotebook('测试库')
  assert.ok(nb.id)

  const r1 = await core.addSource(nb.id, {
    type: 'text',
    title: '注意力机制简介',
    text: '# 注意力机制\n\n自注意力(self-attention)允许模型在处理每个位置时关注序列中的所有其他位置。Transformer 完全基于注意力机制,抛弃了循环结构。注意力的计算复杂度与序列长度呈平方关系。',
  })
  assert.equal(r1.status, 'ok')

  // 相同内容再次导入 → duplicate
  const r2 = await core.addSource(nb.id, { type: 'text', text: '# 注意力机制\n\n自注意力(self-attention)允许模型在处理每个位置时关注序列中的所有其他位置。Transformer 完全基于注意力机制,抛弃了循环结构。注意力的计算复杂度与序列长度呈平方关系。' })
  assert.equal(r2.status, 'duplicate')

  // onDuplicate=anyway → 新来源(相同内容)
  const dupText = '# 注意力机制\n\n自注意力(self-attention)允许模型在处理每个位置时关注序列中的所有其他位置。Transformer 完全基于注意力机制,抛弃了循环结构。注意力的计算复杂度与序列长度呈平方关系。'
  const r3 = await core.addSource(nb.id, { type: 'text', title: '再来一份', text: dupText }, { onDuplicate: 'anyway' })
  assert.equal(r3.status, 'ok')

  const sources = await core.listSources(nb.id)
  assert.equal(sources.length, 2)

  // 问答(LLM 不可用 → 降级抽取式,但必须有引用)
  const answer = await core.query(nb.id, '自注意力有什么特点?')
  assert.ok(answer.answer.length > 10)
  assert.ok(answer.citations.length >= 1)
  assert.equal(answer.citations[0].sourceId, r1.sourceId)
  assert.ok(answer.degraded)

  // 限定 sourceIds 过滤
  const filtered = await core.query(nb.id, '自注意力', { sourceIds: [r1.sourceId] })
  assert.ok(filtered.citations.every(c => c.sourceId === r1.sourceId))
})

test('集成:多模态文件标记 pending,不解析', async () => {
  const { core, dir } = tmpCore()
  const nb = await core.createNotebook('多模态')
  const png = path.join(dir, 'pic.png')
  fs.writeFileSync(png, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  const r = await core.addSource(nb.id, { type: 'file', path: png })
  assert.equal(r.status, 'multimodal-pending')
  assert.ok(r.multimodal)

  // pending 来源不进入检索
  const sources = await core.listSources(nb.id)
  assert.equal(sources[0].status, 'multimodal-pending')
  const answer = await core.query(nb.id, '任何问题')
  assert.ok(answer.answer.includes('没有足够信息') || answer.answer.includes('无已索引来源'))

  // 转写写回后进入检索
  await core.updateSourceText(nb.id, r.sourceId, '# 图中内容\n\n这是一张关于机器人执行器的示意图,包含谐波减速器与行星滚柱丝杠的对比。')
  const sourcesAfter = await core.listSources(nb.id)
  assert.equal(sourcesAfter[0].status, 'indexed')
  const answer2 = await core.query(nb.id, '谐波减速器')
  assert.ok(answer2.citations.length >= 1)
})

test('集成:md 文件导入 + notebook 详情 + 删除确认', async () => {
  const { core, dir } = tmpCore()
  const nb = await core.createNotebook('文件库')
  const md = path.join(dir, 'note.md')
  fs.writeFileSync(md, '# 研究笔记\n\n人形机器人执行器的三大路线:谐波减速器、行星滚柱丝杠、直驱方案。\n\n## 成本对比\n\n谐波减速器成本最低但精度受限。')
  const r = await core.addSource(nb.id, { type: 'file', path: md })
  assert.equal(r.status, 'ok')
  assert.equal(r.type, 'file')

  const detail = await core.getNotebook(nb.id)
  assert.equal(detail.sources.length, 1)
  assert.ok(detail.sources[0].words > 0)

  // 删除需二次确认
  const noConfirm = await core.deleteNotebook(nb.id, { confirm: false })
  assert.ok(noConfirm.requireConfirm)
  const confirmed = await core.deleteNotebook(nb.id, { confirm: true })
  assert.equal(confirmed.deleted, true)
  assert.equal((await core.listNotebooks()).length, 0)
})

test('集成:web 不可用时 discover/url 明确报错', async () => {
  const { core } = tmpCore()
  await assert.rejects(() => core.discoverSources('机器人'), /unavailable/)
  const nb = await core.createNotebook('W')
  await assert.rejects(() => core.addSource(nb.id, { type: 'url', url: 'https://example.com' }), /unavailable/)
})

test('集成:Studio 降级生成(mindmap/table/flashcards,LLM 不可用)', async () => {
  const { core, ctx } = tmpCore()
  const nb = await core.createNotebook('Studio')
  await core.addSource(nb.id, { type: 'text', title: '执行器综述', text: '# 人形机器人执行器\n\n## 谐波减速器\n\n成本低、精度高,但柔轮易疲劳。\n\n## 行星滚柱丝杠\n\n承载高、寿命长,成本也高。\n\n## 直驱方案\n\n响应最快,控制最难。' })

  const mm = await generateStudio(ctx, core, { notebook: nb.id, kind: 'mindmap', topic: '执行器' })
  assert.equal(mm.kind, 'mindmap')
  assert.match(mm.mermaid, /mindmap/)
  assert.ok(mm.file.startsWith('studio/mindmaps/'))

  const tb = await generateStudio(ctx, core, { notebook: nb.id, kind: 'table', topic: '执行器对比' })
  assert.equal(tb.kind, 'table')
  assert.ok(tb.file.startsWith('studio/tables/'))
  assert.ok(tb.markdown.includes('|'))

  const fc = await generateStudio(ctx, core, { notebook: nb.id, kind: 'flashcards', topic: '执行器' })
  assert.equal(fc.kind, 'flashcards')
  assert.ok(Array.isArray(fc.cards) && fc.cards.length > 0)

  const qz = await generateStudio(ctx, core, { notebook: nb.id, kind: 'quiz', topic: '执行器' })
  assert.ok(Array.isArray(qz.quiz) && qz.quiz.length > 0)

  // 产物列表
  const detail = await core.getNotebook(nb.id)
  assert.equal(detail.artifacts.length, 4)

  // 未知 kind
  await assert.rejects(() => generateStudio(ctx, core, { notebook: nb.id, kind: 'nope' }), /unknown studio kind/)
})

test('状态:降级模式下各项可用性如实报告', async () => {
  const { core } = tmpCore()
  const s = await core.status()
  assert.equal(s.plugin, 'notebook-knowledge-studio')
  assert.match(s.llm, /unavailable/)
  assert.equal(s.web, 'unavailable')
  assert.match(s.qwenMmPlugins, /not detected/)
})
