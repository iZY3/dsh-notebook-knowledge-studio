/**
 * 存储层:.notebook-knowledge/ 目录布局、Notebook CRUD、index.md/log.md 维护、路径安全。
 * 所有知识文件都是人可读的 Markdown(OKF);.cache/ 只是可重建的索引缓存。
 *
 * 布局(merged.md 第 9 节):
 *   .notebook-knowledge/
 *     notebooks/<notebook-slug>/
 *       index.md  log.md
 *       sources/<source-id>.md
 *       concepts/ notes/ (预留)
 *       studio/{mindmaps,reports,flashcards,quizzes,infographics,slides,tables}/
 *       assets/{images,documents,generated}/
 *       .cache/{embeddings,thumbnails}/
 */
import fs from 'node:fs'
import path from 'node:path'
import { parseOkf, writeOkf } from './okf.mjs'
import { nowIso, shortId, slugify } from './util.mjs'

const STUDIO_DIRS = ['mindmaps', 'reports', 'flashcards', 'quizzes', 'infographics', 'slides', 'tables']
const KIND_TO_DIR = { mindmap: 'mindmaps', report: 'reports', flashcards: 'flashcards', quiz: 'quizzes', infographic: 'infographics', slides: 'slides', table: 'tables' }
const ASSET_DIRS = ['images', 'documents', 'generated']
const CACHE_DIRS = ['embeddings', 'thumbnails']

export class Store {
  constructor(root) {
    this.root = path.resolve(String(root ?? '.notebook-knowledge'))
  }

  /** 路径安全:解析后必须仍在 root 内,拒绝 `..` 逃逸。 */
  resolve(...parts) {
    const joined = path.resolve(this.root, ...parts)
    const normRoot = path.resolve(this.root)
    if (joined !== normRoot && !joined.startsWith(normRoot + path.sep)) {
      throw new Error(`path escapes workspace root: ${parts.join('/')}`)
    }
    return joined
  }

  ensureRoot() {
    fs.mkdirSync(this.root, { recursive: true })
  }

  // ── Notebook CRUD ──────────────────────────────────────────────

  /** notebook id = slug,创建时唯一化。 */
  createNotebook(title) {
    const cleanTitle = String(title ?? '').trim() || 'Untitled Notebook'
    let id = slugify(cleanTitle).toLowerCase() || 'notebook'
    if (fs.existsSync(this.resolve('notebooks', id))) id = `${id}-${shortId().slice(-4)}`
    const dir = this.resolve('notebooks', id)
    for (const d of ['sources', 'concepts', 'notes', ...STUDIO_DIRS.map(s => `studio/${s}`), ...ASSET_DIRS.map(a => `assets/${a}`), ...CACHE_DIRS.map(c => `.cache/${c}`)]) {
      fs.mkdirSync(path.join(dir, d), { recursive: true })
    }
    const fm = {
      type: 'Notebook',
      title: cleanTitle,
      description: `${cleanTitle} — Notebook Knowledge Studio`,
      status: 'active',
      generated: { by: 'process:notebook-knowledge-studio', at: nowIso() },
    }
    fs.writeFileSync(path.join(dir, 'index.md'), writeOkf(fm, `# ${cleanTitle}\n\n(Empty notebook. Add sources to begin.)\n`))
    fs.writeFileSync(path.join(dir, 'log.md'), writeOkf({ type: 'NotebookLog', title: `${cleanTitle} log` }, `# ${cleanTitle} — Log\n\n- ${nowIso()} notebook created\n`))
    return { id, title: cleanTitle }
  }

  listNotebooks() {
    const dir = this.resolve('notebooks')
    if (!fs.existsSync(dir)) return []
    const out = []
    for (const name of fs.readdirSync(dir)) {
      const stat = fs.statSync(path.join(dir, name))
      if (!stat.isDirectory()) continue
      const index = this.readIndex(name)
      out.push({
        id: name,
        title: index?.frontmatter?.title ?? name,
        description: index?.frontmatter?.description ?? '',
        createdAt: index?.frontmatter?.generated?.at ?? null,
        lastModified: this.lastModified(name),
        sourceCount: this.listSources(name).length,
        artifactCount: this.countArtifacts(name),
      })
    }
    out.sort((a, b) => String(b.lastModified ?? '').localeCompare(String(a.lastModified ?? '')))
    return out
  }

  /** 删除 = 删除 workspace 内该 notebook 目录。调用方负责显式确认。 */
  deleteNotebook(id) {
    const dir = this.resolve('notebooks', id)
    if (!fs.existsSync(dir)) return false
    fs.rmSync(dir, { recursive: true, force: true })
    return true
  }

  renameNotebook(id, newTitle) {
    const dir = this.resolve('notebooks', id)
    const index = this.readIndex(id)
    if (!index) throw new Error(`notebook not found: ${id}`)
    const fm = { ...index.frontmatter, title: String(newTitle) }
    fs.writeFileSync(path.join(dir, 'index.md'), writeOkf(fm, index.body.replace(/^# .*$/m, `# ${newTitle}`)))
    this.appendLog(id, `notebook renamed "${id}" → "${newTitle}"`)
    return { id, title: String(newTitle) }
  }

  readIndex(notebook) {
    return this.readMd(notebook, 'index.md')
  }

  readMd(notebook, relPath) {
    const file = this.resolve('notebooks', notebook, relPath)
    if (!fs.existsSync(file)) return null
    return parseOkf(fs.readFileSync(file, 'utf8'))
  }

  lastModified(notebook) {
    const dir = this.resolve('notebooks', notebook)
    if (!fs.existsSync(dir)) return null
    let latest = 0
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (e.name.startsWith('.cache')) continue
        const p = path.join(d, e.name)
        if (e.isDirectory()) walk(p)
        else latest = Math.max(latest, fs.statSync(p).mtimeMs)
      }
    }
    walk(dir)
    return latest ? new Date(latest).toISOString() : null
  }

  appendLog(notebook, message) {
    const file = this.resolve('notebooks', notebook, 'log.md')
    const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : `# Log\n`
    fs.writeFileSync(file, existing.replace(/\n*$/, '\n') + `- ${nowIso()} ${message}\n`)
  }

  // ── Sources ────────────────────────────────────────────────────

  writeSource(notebook, sourceId, fm, body) {
    const file = this.resolve('notebooks', notebook, 'sources', `${sourceId}.md`)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, writeOkf(fm, body))
    return file
  }

  readSource(notebook, sourceId) {
    const file = this.resolve('notebooks', notebook, 'sources', `${sourceId}.md`)
    if (!fs.existsSync(file)) return null
    return parseOkf(fs.readFileSync(file, 'utf8'))
  }

  listSources(notebook) {
    const dir = this.resolve('notebooks', notebook, 'sources')
    if (!fs.existsSync(dir)) return []
    const out = []
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith('.md')) continue
      const { frontmatter: fm, body } = parseOkf(fs.readFileSync(path.join(dir, name), 'utf8'))
      out.push({
        id: name.slice(0, -3),
        title: fm.title ?? name,
        type: fm.source_type ?? 'text',
        resource: fm.resource ?? null,
        status: fm.status ?? 'indexed',
        importedAt: fm.generated?.at ?? null,
        hash: fm.content_hash ?? null,
        words: String(body ?? '').trim() ? String(body).trim().split(/\s+/).length : 0,
      })
    }
    out.sort((a, b) => String(b.importedAt ?? '').localeCompare(String(a.importedAt ?? '')))
    return out
  }

  removeSource(notebook, sourceId) {
    const file = this.resolve('notebooks', notebook, 'sources', `${sourceId}.md`)
    if (!fs.existsSync(file)) return false
    fs.rmSync(file, { force: true })
    return true
  }

  // ── Studio artifacts ───────────────────────────────────────────

  writeArtifact(notebook, kind, fileName, fm, body) {
    const dirName = KIND_TO_DIR[kind] ?? 'reports'
    const file = this.resolve('notebooks', notebook, 'studio', dirName, fileName)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, writeOkf(fm, body))
    return path.relative(this.resolve('notebooks', notebook), file).split(path.sep).join('/')
  }

  /** 裸写产物文件(CSV/JSON 等不能带 frontmatter 的格式)。 */
  writeRawArtifact(notebook, kind, fileName, data) {
    const dirName = KIND_TO_DIR[kind] ?? 'reports'
    const file = this.resolve('notebooks', notebook, 'studio', dirName, fileName)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, data)
    return path.relative(this.resolve('notebooks', notebook), file).split(path.sep).join('/')
  }

  listArtifacts(notebook) {
    const base = this.resolve('notebooks', notebook, 'studio')
    if (!fs.existsSync(base)) return []
    const out = []
    for (const kind of STUDIO_DIRS) {
      const dir = path.join(base, kind)
      if (!fs.existsSync(dir)) continue
      for (const name of fs.readdirSync(dir)) {
        if (!name.endsWith('.md') && !name.endsWith('.json') && !name.endsWith('.csv')) continue
        const { frontmatter: fm } = parseOkf(fs.readFileSync(path.join(dir, name), 'utf8'))
        out.push({
          kind: kind.slice(0, -1), // mindmaps → mindmap
          file: `studio/${kind}/${name}`,
          title: fm.title ?? name,
          generatedAt: fm.generated?.at ?? null,
          sources: Array.isArray(fm.sources) ? fm.sources : [],
        })
      }
    }
    out.sort((a, b) => String(b.generatedAt ?? '').localeCompare(String(a.generatedAt ?? '')))
    return out
  }

  countArtifacts(notebook) {
    return this.listArtifacts(notebook).length
  }

  readArtifact(notebook, relFile) {
    const file = this.resolve('notebooks', notebook, relFile)
    if (!fs.existsSync(file)) return null
    return fs.readFileSync(file, 'utf8')
  }

  writeAsset(notebook, subdir, fileName, data) {
    const dir = this.resolve('notebooks', notebook, 'assets', subdir)
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, fileName)
    fs.writeFileSync(file, data)
    return path.relative(this.resolve('notebooks', notebook), file).split(path.sep).join('/')
  }

  cacheDir(notebook, kind) {
    const dir = this.resolve('notebooks', notebook, '.cache', kind)
    fs.mkdirSync(dir, { recursive: true })
    return dir
  }
}

export const STUDIO_KINDS = ['mindmap', 'report', 'flashcards', 'quiz', 'infographic', 'slides', 'table']
export { STUDIO_DIRS }
