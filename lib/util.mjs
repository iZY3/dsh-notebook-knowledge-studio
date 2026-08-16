import { createHash } from 'node:crypto'

/** 当前 UTC 时间,ISO 8601。所有 generated.at 必须用真实写入时间。 */
export function nowIso() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
}

/** 内容稳定哈希(SHA-256 前 16 位十六进制),用于来源去重。 */
export function contentHash(text) {
  return createHash('sha256').update(String(text ?? ''), 'utf8').digest('hex').slice(0, 16)
}

/** 稳定短 id:时间基 36 进制 + 随机尾,短且基本不碰撞。 */
export function shortId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

/**
 * 生成文件名安全的 slug。CJK 字符保留(Windows 文件名允许),仅去除
 * 路径分隔符/控制字符/保留名风险字符,压缩空白与长度。
 */
export function slugify(input, maxLen = 48) {
  let s = String(input ?? '').trim()
  s = s.replace(/[\\/:*?"<>|\r\n\t#|^]/g, ' ')
  s = s.replace(/\s+/g, '-')
  s = s.replace(/^-+|-+$/g, '')
  if (s.length > maxLen) s = s.slice(0, maxLen).replace(/-+$/, '')
  return s || 'untitled'
}

/** 文件命名:{short-id}-{slug}.md — 内部 id 稳定,标题只在 UI 显示。 */
export function artifactFileName(title) {
  return `${shortId()}-${slugify(title)}.md`
}

const DECODE_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

export function decodeEntities(text) {
  return String(text)
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-zA-Z]+);/g, (m, name) => DECODE_ENTITIES[name] ?? m)
}

/** 判断是否为多模态二进制来源(交给 Qwen-MM-Plugins 路由,不直接解析)。 */
export function isMultimediaExt(ext) {
  return /^\.(png|jpe?g|gif|webp|bmp|svg|ico|tiff?|mp3|wav|flac|aac|ogg|m4a|mp4|mkv|mov|avi|webm|pdf)$/i.test(ext)
}

export function isTextLikeExt(ext) {
  return /^\.(md|markdown|txt|text|json|jsonl|csv|tsv|yaml|yml|log|xml|html?|js|mjs|cjs|ts|css|py|rs|go|java|c|h|cpp|hpp|sh|bat|ps1|toml|ini|conf)$/i.test(ext)
}
