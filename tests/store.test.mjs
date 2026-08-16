import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Store } from '../lib/store.mjs'

function tmpStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nks-store-'))
  return { store: new Store(path.join(dir, '.notebook-knowledge')), dir }
}

test('notebook CRUD 全流程', () => {
  const { store } = tmpStore()
  const { id } = store.createNotebook('测试知识库 Alpha')
  assert.ok(fs.existsSync(store.resolve('notebooks', id, 'index.md')))
  assert.ok(fs.existsSync(store.resolve('notebooks', id, 'log.md')))
  assert.ok(fs.existsSync(store.resolve('notebooks', id, 'studio', 'mindmaps')))

  let list = store.listNotebooks()
  assert.equal(list.length, 1)
  assert.equal(list[0].title, '测试知识库 Alpha')

  store.renameNotebook(id, '改名后的库')
  list = store.listNotebooks()
  assert.equal(list[0].title, '改名后的库')
  assert.ok(fs.readFileSync(store.resolve('notebooks', id, 'log.md'), 'utf8').includes('renamed'))

  assert.equal(store.deleteNotebook(id), true)
  assert.equal(store.listNotebooks().length, 0)
})

test('路径逃逸被拒绝', () => {
  const { store } = tmpStore()
  assert.throws(() => store.resolve('..', 'evil'))
  assert.throws(() => store.resolve('notebooks/../../evil'))
})

test('source 写入/列出/移除', () => {
  const { store } = tmpStore()
  const { id } = store.createNotebook('S')
  store.writeSource(id, 'src1-abc', {
    type: 'Source', title: '来源一', source_type: 'url', resource: 'https://a.b/c',
    status: 'indexed', content_hash: 'h1', generated: { by: 'x', at: '2026-08-16T00:00:00Z' },
  }, '正文内容')
  let sources = store.listSources(id)
  assert.equal(sources.length, 1)
  assert.equal(sources[0].title, '来源一')
  assert.equal(sources[0].hash, 'h1')

  assert.ok(store.removeSource(id, 'src1-abc'))
  assert.equal(store.listSources(id).length, 0)
  assert.equal(store.removeSource(id, 'src1-abc'), false)
})

test('artifact 写入与列出(MD + 裸 CSV)', () => {
  const { store } = tmpStore()
  const { id } = store.createNotebook('A')
  const rel = store.writeArtifact(id, 'table', 't1-表.md', { type: 'StudioArtifact', kind: 'table', title: '表', generated: { by: 'x', at: '2026-08-16T00:00:00Z' } }, '| a | b |\n|---|---|\n| 1 | 2 |')
  assert.equal(rel, 'studio/tables/t1-表.md')
  const csvRel = store.writeRawArtifact(id, 'table', 't1-表.csv', 'a,b\n1,2')
  assert.equal(csvRel, 'studio/tables/t1-表.csv')
  const raw = fs.readFileSync(store.resolve('notebooks', id, 'studio', 'tables', 't1-表.csv'), 'utf8')
  assert.equal(raw, 'a,b\n1,2') // CSV 不带 frontmatter
  const arts = store.listArtifacts(id)
  assert.equal(arts.length, 2)
  assert.ok(store.readArtifact(id, rel).includes('| a | b |'))
  assert.equal(store.readArtifact(id, 'studio/tables/missing.md'), null)
})
