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

test('Notebook 边界拒绝跨库 source/artifact/asset/cache 路径', () => {
  const { store } = tmpStore()
  const a = store.createNotebook('甲库').id
  const b = store.createNotebook('乙库').id
  store.writeSource(b, '秘密来源', {
    type: 'Source', title: '秘密', source_type: 'text', status: 'indexed',
    generated: { by: 'x', at: '2026-08-16T00:00:00Z' },
  }, '乙库正文')
  const artifact = store.writeArtifact(b, 'report', '秘密报告.md', {
    type: 'StudioArtifact', kind: 'report', title: '秘密报告',
    generated: { by: 'x', at: '2026-08-16T00:00:00Z' },
  }, '乙库报告')

  const attacks = [
    () => store.readArtifact(a, `../${b}/index.md`),
    () => store.readArtifact(a, `studio/reports/../../../${b}/index.md`),
    () => store.readSource(a, `../../${b}/sources/秘密来源`),
    () => store.readSource(a, decodeURIComponent(`..%2F..%2F${b}%2Fsources%2F秘密来源`)),
    () => store.readSource(a, `..\\..\\${b}\\sources\\秘密来源`),
    () => store.writeSource(a, `../../${b}/sources/覆盖`, {}, 'bad'),
    () => store.removeSource(a, `../../${b}/sources/秘密来源`),
    () => store.writeArtifact(a, 'report', '../../覆盖.md', {}, 'bad'),
    () => store.writeAsset(a, '../documents', 'bad.txt', 'bad'),
    () => store.writeAsset(a, 'documents', '../bad.txt', 'bad'),
    () => store.cacheDir(a, '../index'),
    () => store.readSource(a, 'C:secret'),
    () => store.readSource(a, 'secret.'),
  ]
  for (const attack of attacks) {
    assert.throws(attack, error => error.code === 'NOTEBOOK_PATH_BLOCKED' && error.statusCode === 400)
  }

  assert.equal(store.readSource(b, '秘密来源').body.trim(), '乙库正文')
  assert.equal(store.readArtifact(b, artifact).includes('乙库报告'), true)
  assert.equal(store.readSource(b, '覆盖'), null)
})

test('Notebook 边界拒绝符号链接或 junction 跨库', t => {
  const { store } = tmpStore()
  const a = store.createNotebook('链接甲').id
  const b = store.createNotebook('链接乙').id
  store.writeSource(b, 'secret', {
    type: 'Source', title: 'Secret', source_type: 'text', status: 'indexed',
    generated: { by: 'x', at: '2026-08-16T00:00:00Z' },
  }, 'outside')

  const aSources = store.resolve('notebooks', a, 'sources')
  const bSources = store.resolve('notebooks', b, 'sources')
  fs.rmSync(aSources, { recursive: true })
  try {
    fs.symlinkSync(bSources, aSources, process.platform === 'win32' ? 'junction' : 'dir')
  } catch (error) {
    t.skip(`当前环境不能创建测试链接: ${error.code ?? error.message}`)
    return
  }

  assert.throws(
    () => store.readSource(a, 'secret'),
    error => error.code === 'NOTEBOOK_PATH_BLOCKED',
  )
  assert.equal(store.readSource(b, 'secret').body.trim(), 'outside')
})
