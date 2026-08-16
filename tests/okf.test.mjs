import test from 'node:test'
import assert from 'node:assert/strict'
import { parseOkf, writeOkf, serializeFrontmatter, validateOkf } from '../lib/okf.mjs'

test('roundtrip: 写入后可解析回相同字段', () => {
  const fm = {
    type: 'Article',
    title: 'Transformer 架构综述',
    description: '一句话描述: 含,逗号',
    resource: 'https://arxiv.org/abs/1706.03762',
    trust: 'high',
    tags: ['deep learning', 'NLP'],
    generated: { by: 'process:notebook-knowledge-studio', at: '2026-08-16T10:00:00Z' },
    sources: [{ id: 'original', resource: 'https://example.com', title: 'Example Source' }],
  }
  const text = writeOkf(fm, '# 正文\n\n内容')
  const back = parseOkf(text)
  assert.equal(back.frontmatter.type, 'Article')
  assert.equal(back.frontmatter.title, 'Transformer 架构综述')
  assert.equal(back.frontmatter.description, '一句话描述: 含,逗号')
  assert.equal(back.frontmatter.trust, 'high')
  assert.deepEqual(back.frontmatter.tags, ['deep learning', 'NLP'])
  assert.equal(back.frontmatter.generated.by, 'process:notebook-knowledge-studio')
  assert.equal(back.frontmatter.generated.at, '2026-08-16T10:00:00Z')
  assert.deepEqual(back.frontmatter.sources, [{ id: 'original', resource: 'https://example.com', title: 'Example Source' }])
  assert.match(back.body, /^# 正文/)
})

test('无 frontmatter 的文本返回空对象', () => {
  const r = parseOkf('# 只有正文')
  assert.deepEqual(r.frontmatter, {})
  assert.equal(r.body, '# 只有正文')
})

test('frontmatter 未闭合时按原文处理', () => {
  const r = parseOkf('---\ntype: Article\n正文没有闭合')
  assert.deepEqual(r.frontmatter, {})
})

test('validateOkf:type 必填,trust/lifecycle 枚举', () => {
  assert.deepEqual(validateOkf({ type: 'Article' }), [])
  assert.ok(validateOkf({}).some(p => p.includes('type')))
  assert.ok(validateOkf({ type: 'X', trust: 'ultra' }).some(p => p.includes('trust')))
  assert.ok(validateOkf({ type: 'X', lifecycle: 'zombie' }).some(p => p.includes('lifecycle')))
})

test('serializeFrontmatter 空列表与空值', () => {
  const out = serializeFrontmatter({ type: 'X', tags: [], note: null })
  assert.match(out, /tags: \[\]/)
  assert.match(out, /note: \n/)
})
