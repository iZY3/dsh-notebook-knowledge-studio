/**
 * OKF (Open Knowledge Format) v0.2 读写层。
 * 每个概念 = 一个带 YAML Frontmatter 的 Markdown 文件。
 * 只实现我们写入所需的 YAML 子集(标量、字符串列表、两级嵌套 map),
 * 解析对外部文件保持宽容:解不开的行原样保留在 raw 段。
 */

const FM_OPEN = /^---\r?\n/
const FM_CLOSE = /\r?\n---(\r?\n|$)/

/** 解析一个 .md 文件文本为 { frontmatter, body }。无 frontmatter 时返回空对象。 */
export function parseOkf(text) {
  const src = String(text ?? '')
  if (!FM_OPEN.test(src)) return { frontmatter: {}, body: src }
  const afterOpen = src.slice(src.indexOf('\n') + 1)
  const closeMatch = FM_CLOSE.exec(afterOpen)
  if (!closeMatch) return { frontmatter: {}, body: src }
  const yamlBlock = afterOpen.slice(0, closeMatch.index)
  const body = afterOpen.slice(closeMatch.index + closeMatch[0].length)
  return { frontmatter: parseYaml(yamlBlock), body: body.replace(/^\r?\n/, '') }
}

function scalar(value) {
  const v = value.trim()
  if (v === '' || v === 'null' || v === '~') return null
  if (v === 'true') return true
  if (v === 'false') return false
  if (/^-?\d+$/.test(v)) return parseInt(v, 10)
  if (/^-?\d+\.\d+$/.test(v)) return parseFloat(v)
  const quoted = v.match(/^(['"])([\s\S]*)\1$/)
  return quoted ? quoted[2] : v
}

/** 宽容的 YAML 子集解析:顶层标量、`- item` 列表、一级嵌套 map(list of maps 也支持)。 */
export function parseYaml(block) {
  const result = {}
  const lines = String(block).split(/\r?\n/)
  let key = null
  let list = null
  let listOfMaps = null
  for (const rawLine of lines) {
    if (!rawLine.trim() || rawLine.trim().startsWith('#')) continue
    const listMatch = rawLine.match(/^\s+-\s+(.*)$/)
    if (listMatch && key) {
      if (listOfMaps) {
        const inline = listMatch[1]
        const objMatch = inline.match(/^(\w[\w-]*):\s*(.*)$/)
        if (objMatch) {
          const obj = {}
          obj[objMatch[1]] = scalar(objMatch[2])
          listOfMaps.push(obj)
        } else {
          // map 的延续属性行(如 `  resource: ...` 挂在最后一个 map 上)
          const contMatch = inline.match(/^(\w[\w-]*):\s*(.*)$/)
          if (contMatch && listOfMaps.length) listOfMaps[listOfMaps.length - 1][contMatch[1]] = scalar(contMatch[2])
        }
      } else if (list) {
        list.push(scalar(listMatch[1]))
      } else if (result[key] === undefined || result[key] === null) {
        list = [scalar(listMatch[1])]
        result[key] = list
        // 检测 list-of-maps:`- key: value` 形式
        if (listMatch[1].match(/^\w[\w-]*:\s*/)) {
          listOfMaps = list
          list = null
          const m = listMatch[1].match(/^(\w[\w-]*):\s*(.*)$/)
          const obj = {}
          obj[m[1]] = scalar(m[2])
          listOfMaps.length = 0
          listOfMaps.push(obj)
        }
      }
      continue
    }
    const mapMatch = rawLine.match(/^(\w[\w-]*):\s*(.*)$/)
    if (mapMatch && !rawLine.startsWith(' ')) {
      key = mapMatch[1]
      list = null
      listOfMaps = null
      if (mapMatch[2].trim() === '') {
        if (result[key] === undefined) result[key] = null // 可能随后被列表填充
      } else {
        result[key] = scalar(mapMatch[2])
      }
      continue
    }
    const nestedMatch = rawLine.match(/^ {2}(\w[\w-]*):\s*(.*)$/)
    if (nestedMatch && key) {
      if (typeof result[key] !== 'object' || result[key] === null || Array.isArray(result[key])) {
        result[key] = {}
      }
      result[key][nestedMatch[1]] = scalar(nestedMatch[2])
      continue
    }
    // list-of-maps 的续属性行(更深缩进、无列表符)挂到最后一个 map 上
    const contMatch = rawLine.match(/^ {3,}(\w[\w-]*):\s*(.*)$/)
    if (contMatch && listOfMaps && listOfMaps.length) {
      listOfMaps[listOfMaps.length - 1][contMatch[1]] = scalar(contMatch[2])
    }
  }
  return result
}

function yamlScalar(value) {
  if (value === null || value === undefined) return ''
  if (typeof value === 'boolean' || typeof value === 'number') return String(value)
  const s = String(value)
  if (/^[A-Za-z0-9_./@#-]+$/.test(s) && !/^\s|\s$/.test(s)) return s
  return JSON.stringify(s) // JSON 字符串转义与 YAML 双引号规则兼容
}

/** 序列化 frontmatter 对象为 `---\n...\n---` 块。字段顺序:先必填 type,其余按插入序。 */
export function serializeFrontmatter(fm) {
  const lines = ['---']
  for (const [k, v] of Object.entries(fm ?? {})) {
    if (v === undefined) continue
    if (Array.isArray(v)) {
      if (v.length === 0) { lines.push(`${k}: []`); continue }
      lines.push(`${k}:`)
      for (const item of v) {
        if (item !== null && typeof item === 'object') {
          const entries = Object.entries(item)
          lines.push(`  - ${entries[0]?.[0] ?? 'id'}: ${yamlScalar(entries[0]?.[1])}`)
          for (const [ik, iv] of entries.slice(1)) lines.push(`    ${ik}: ${yamlScalar(iv)}`)
        } else {
          lines.push(`  - ${yamlScalar(item)}`)
        }
      }
    } else if (v !== null && typeof v === 'object') {
      lines.push(`${k}:`)
      for (const [ik, iv] of Object.entries(v)) lines.push(`  ${ik}: ${yamlScalar(iv)}`)
    } else {
      lines.push(`${k}: ${yamlScalar(v)}`)
    }
  }
  lines.push('---')
  return lines.join('\n')
}

/** 组装完整 OKF 文档文本。 */
export function writeOkf(fm, body) {
  return `${serializeFrontmatter(fm)}\n\n${String(body ?? '').replace(/^\s*\n/, '')}\n`
}

/**
 * 校验 frontmatter 的 OKF 合规性,返回问题列表(空数组 = 合规)。
 * type 为必填字段。
 */
export function validateOkf(fm) {
  const problems = []
  if (!fm || typeof fm !== 'object') { problems.push('frontmatter 缺失'); return problems }
  if (!fm.type) problems.push('缺少必填字段 type')
  if (fm.trust !== undefined && !['high', 'medium', 'low'].includes(fm.trust)) problems.push('trust 必须是 high/medium/low')
  if (fm.lifecycle !== undefined && !['active', 'review', 'archived'].includes(fm.lifecycle)) problems.push('lifecycle 必须是 active/review/archived')
  return problems
}
