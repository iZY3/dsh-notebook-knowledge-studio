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
const CACHE_DIRS = ['embeddings', 'thumbnails', 'index']

export class StorePathError extends Error {
  constructor(message) {
    super(message)
    this.name = 'StorePathError'
    this.code = 'NOTEBOOK_PATH_BLOCKED'
    this.statusCode = 400
  }
}

function blocked(message) {
  throw new StorePathError(message)
}

function isWithin(base, target) {
  return target === base || target.startsWith(base + path.sep)
}

/** Notebook/source/file identifiers are opaque path segments, never paths. */
function pathSegment(value, label) {
  const text = String(value ?? '')
  if (
    !text || text === '.' || text === '..' || path.isAbsolute(text)
    || /[\\/\0:]/.test(text) || /[. ]$/.test(text)
  ) {
    blocked(`${label} must be one safe path segment`)
  }
  return text
}

function artifactParts(relFile) {
  const raw = String(relFile ?? '')
  if (!raw || path.isAbsolute(raw) || raw.includes('\\') || raw.includes('\0')) {
    blocked('artifact path must be a relative studio path')
  }
  const parts = raw.split('/')
  if (parts.length !== 3 || parts[0] !== 'studio' || !STUDIO_DIRS.includes(parts[1])) {
    blocked('artifact path must match studio/<kind>/<file>')
  }
  const fileName = pathSegment(parts[2], 'artifact filename')
  if (!['.md', '.json', '.csv'].includes(path.extname(fileName).toLowerCase())) {
    blocked('artifact file type is not allowed')
  }
  return ['studio', parts[1], fileName]
}

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

  /** Resolve one Notebook directory and reject symlink/junction aliases. */
  notebookDir(notebook, { mustExist = true } = {}) {
    const id = pathSegment(notebook, 'notebook id')
    const notebooksRoot = this.resolve('notebooks')
    const dir = this.resolve('notebooks', id)
    if (!fs.existsSync(dir)) {
      if (mustExist) throw new Error(`notebook not found: ${id}`)
      return dir
    }
    if (fs.lstatSync(dir).isSymbolicLink()) blocked(`notebook directory is a symbolic link: ${id}`)
    if (fs.existsSync(notebooksRoot)) {
      const realRoot = fs.realpathSync(notebooksRoot)
      const realDir = fs.realpathSync(dir)
      if (!isWithin(realRoot, realDir)) blocked(`notebook directory escapes notebooks root: ${id}`)
    }
    return dir
  }

  /**
   * Resolve a path inside one Notebook. Lexical containment blocks traversal;
   * realpath containment blocks existing symlink/junction components.
   */
  resolveNotebook(notebook, ...parts) {
    const base = this.notebookDir(notebook)
    const target = path.resolve(base, ...parts.map(part => String(part)))
    if (!isWithin(base, target)) blocked(`path escapes notebook: ${parts.join('/')}`)

    const realBase = fs.realpathSync(base)
    let probe = target
    while (!fs.existsSync(probe) && probe !== base) probe = path.dirname(probe)
    const realProbe = fs.realpathSync(probe)
    if (!isWithin(realBase, realProbe)) blocked(`path crosses a symbolic link outside notebook: ${parts.join('/')}`)
    if (fs.existsSync(target)) {
      const realTarget = fs.realpathSync(target)
      if (!isWithin(realBase, realTarget)) blocked(`path crosses a symbolic link outside notebook: ${parts.join('/')}`)
    }
    return target
  }

  // ── Notebook CRUD ──────────────────────────────────────────────

  /** notebook id = slug,创建时唯一化。 */
  createNotebook(title) {
    const cleanTitle = String(title ?? '').trim() || 'Untitled Notebook'
    let id = slugify(cleanTitle).toLowerCase() || 'notebook'
    if (fs.existsSync(this.resolve('notebooks', id))) id = `${id}-${shortId().slice(-4)}`
    const dir = this.notebookDir(id, { mustExist: false })
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
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue
      const name = entry.name
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
    const dir = this.notebookDir(id, { mustExist: false })
    if (!fs.existsSync(dir)) return false
    fs.rmSync(dir, { recursive: true, force: true })
    return true
  }

  renameNotebook(id, newTitle) {
    const dir = this.notebookDir(id)
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
    const file = this.resolveNotebook(notebook, relPath)
    if (!fs.existsSync(file)) return null
    return parseOkf(fs.readFileSync(file, 'utf8'))
  }

  lastModified(notebook) {
    const dir = this.notebookDir(notebook)
    if (!fs.existsSync(dir)) return null
    let latest = 0
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (e.name.startsWith('.cache')) continue
        if (e.isSymbolicLink()) continue
        const p = path.join(d, e.name)
        if (e.isDirectory()) walk(p)
        else latest = Math.max(latest, fs.statSync(p).mtimeMs)
      }
    }
    walk(dir)
    return latest ? new Date(latest).toISOString() : null
  }

  appendLog(notebook, message) {
    const file = this.resolveNotebook(notebook, 'log.md')
    const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : `# Log\n`
    fs.writeFileSync(file, existing.replace(/\n*$/, '\n') + `- ${nowIso()} ${message}\n`)
  }

  // ── Sources ────────────────────────────────────────────────────

  writeSource(notebook, sourceId, fm, body) {
    const id = pathSegment(sourceId, 'source id')
    const file = this.resolveNotebook(notebook, 'sources', `${id}.md`)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, writeOkf(fm, body))
    return file
  }

  readSource(notebook, sourceId) {
    const id = pathSegment(sourceId, 'source id')
    const file = this.resolveNotebook(notebook, 'sources', `${id}.md`)
    if (!fs.existsSync(file)) return null
    return parseOkf(fs.readFileSync(file, 'utf8'))
  }

  listSources(notebook) {
    const dir = this.resolveNotebook(notebook, 'sources')
    if (!fs.existsSync(dir)) return []
    const out = []
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile() || entry.isSymbolicLink()) continue
      const name = entry.name
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
    const id = pathSegment(sourceId, 'source id')
    const file = this.resolveNotebook(notebook, 'sources', `${id}.md`)
    if (!fs.existsSync(file)) return false
    fs.rmSync(file, { force: true })
    return true
  }

  // ── Studio artifacts ───────────────────────────────────────────

  writeArtifact(notebook, kind, fileName, fm, body) {
    const dirName = KIND_TO_DIR[kind]
    if (!dirName) blocked(`unsupported artifact kind: ${kind}`)
    const safeName = pathSegment(fileName, 'artifact filename')
    if (!['.md', '.json', '.csv'].includes(path.extname(safeName).toLowerCase())) blocked('artifact file type is not allowed')
    const file = this.resolveNotebook(notebook, 'studio', dirName, safeName)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, writeOkf(fm, body))
    return path.relative(this.notebookDir(notebook), file).split(path.sep).join('/')
  }

  /** 裸写产物文件(CSV/JSON 等不能带 frontmatter 的格式)。 */
  writeRawArtifact(notebook, kind, fileName, data) {
    const dirName = KIND_TO_DIR[kind]
    if (!dirName) blocked(`unsupported artifact kind: ${kind}`)
    const safeName = pathSegment(fileName, 'artifact filename')
    if (!['.json', '.csv'].includes(path.extname(safeName).toLowerCase())) blocked('raw artifact file type is not allowed')
    const file = this.resolveNotebook(notebook, 'studio', dirName, safeName)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, data)
    return path.relative(this.notebookDir(notebook), file).split(path.sep).join('/')
  }

  listArtifacts(notebook) {
    const base = this.resolveNotebook(notebook, 'studio')
    if (!fs.existsSync(base)) return []
    const out = []
    for (const kind of STUDIO_DIRS) {
      const dir = this.resolveNotebook(notebook, 'studio', kind)
      if (!fs.existsSync(dir)) continue
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isFile() || entry.isSymbolicLink()) continue
        const name = entry.name
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
    const file = this.resolveNotebook(notebook, ...artifactParts(relFile))
    if (!fs.existsSync(file)) return null
    return fs.readFileSync(file, 'utf8')
  }

  writeAsset(notebook, subdir, fileName, data) {
    const safeSubdir = String(subdir)
    if (!ASSET_DIRS.includes(safeSubdir)) blocked(`unsupported asset directory: ${safeSubdir}`)
    const safeName = pathSegment(fileName, 'asset filename')
    const dir = this.resolveNotebook(notebook, 'assets', safeSubdir)
    fs.mkdirSync(dir, { recursive: true })
    const file = this.resolveNotebook(notebook, 'assets', safeSubdir, safeName)
    fs.writeFileSync(file, data)
    return path.relative(this.notebookDir(notebook), file).split(path.sep).join('/')
  }

  cacheDir(notebook, kind) {
    const safeKind = String(kind)
    if (!CACHE_DIRS.includes(safeKind)) blocked(`unsupported cache directory: ${safeKind}`)
    const dir = this.resolveNotebook(notebook, '.cache', safeKind)
    fs.mkdirSync(dir, { recursive: true })
    return dir
  }
}

export const STUDIO_KINDS = ['mindmap', 'report', 'flashcards', 'quiz', 'infographic', 'slides', 'table']
export { STUDIO_DIRS }
