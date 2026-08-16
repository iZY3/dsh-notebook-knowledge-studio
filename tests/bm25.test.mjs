import test from 'node:test'
import assert from 'node:assert/strict'
import { tokenize, chunkText, isCjkText } from '../lib/chunk.mjs'
import { BM25Index } from '../lib/bm25.mjs'

test('tokenize:拉丁词 + CJK 二元', () => {
  const t = tokenize('Transformer 自注意力机制')
  assert.ok(t.includes('transformer'))
  assert.ok(t.includes('自注'))
  assert.ok(t.includes('注意'))
  assert.ok(t.includes('意力'))
  assert.ok(t.includes('力机'))
})

test('tokenize:空与纯符号', () => {
  assert.deepEqual(tokenize(''), [])
  assert.deepEqual(tokenize('!!! ???'), [])
})

test('isCjkText 判别', () => {
  assert.equal(isCjkText('这是一段中文文本'), true)
  assert.equal(isCjkText('plain english text'), false)
})

test('chunkText:按标题分节、带偏移、非空', () => {
  const text = '# 标题一\n\n第一段内容。\n\n第二段内容。\n\n# 标题二\n\n另一节的内容,稍微长一点。'.repeat(3)
  const chunks = chunkText(text)
  assert.ok(chunks.length > 0)
  for (const c of chunks) {
    assert.ok(c.text.trim().length > 0)
    assert.ok(typeof c.start === 'number' && typeof c.end === 'number')
  }
  assert.ok(chunks.some(c => c.heading === '标题一'))
  assert.ok(chunks.some(c => c.heading === '标题二'))
})

test('chunkText:空文本返回空数组', () => {
  assert.deepEqual(chunkText(''), [])
  assert.deepEqual(chunkText('   \n  '), [])
})

test('BM25:中文检索命中相关文档', () => {
  const idx = new BM25Index()
  idx.add(1, 'Transformer 是一种基于自注意力机制的序列模型架构')
  idx.add(2, '今天天气很好,适合出门散步')
  idx.add(3, '自注意力 self-attention 允许模型关注序列中任意位置')
  const hits = idx.search('自注意力机制', 3)
  assert.ok(hits.length >= 2)
  assert.equal(Number(hits[0].id), 1)
  assert.ok(hits[0].score > 0)
})

test('BM25:无命中返回空', () => {
  const idx = new BM25Index()
  idx.add(1, '苹果 香蕉')
  assert.deepEqual(idx.search('量子计算机'), [])
})

test('BM25:空索引', () => {
  assert.deepEqual(new BM25Index().search('anything'), [])
})
