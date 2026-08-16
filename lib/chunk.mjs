/**
 * 分块与分词。检索索引属于缓存层(.cache/),不是知识本体——可随时删除重建。
 * 分词:拉丁词 + CJK 单字/二元组合,兼顾中英文混合内容。
 */

const CJK = /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|[朝鲜谚文]/u

export function tokenize(text) {
  const tokens = []
  const lowered = String(text ?? '').toLowerCase()
  const latin = lowered.match(/[a-z0-9][a-z0-9_'.-]*/g) ?? []
  tokens.push(...latin)
  // 抽取连续 CJK 段,做单字 + 相邻二元
  const cjkRuns = lowered.match(/[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]+/gu) ?? []
  for (const run of cjkRuns) {
    for (let i = 0; i < run.length; i++) {
      tokens.push(run[i])
      if (i + 1 < run.length) tokens.push(run.slice(i, i + 2))
    }
  }
  return tokens
}

export function isCjkText(text) {
  const s = String(text ?? '')
  let cjk = 0
  let total = 0
  for (const ch of s) {
    if (/\s/.test(ch)) continue
    total++
    if (CJK.test(ch)) cjk++
  }
  return total > 0 && cjk / total > 0.3
}

/**
 * 按标题/段落切块。每块带 (start, end) 字符偏移与所属小节标题,供 citation 定位高亮。
 * 目标块长 ~600 字符(CJK 按字算,拉丁按词算的差异可接受),重叠 ~80。
 */
export function chunkText(text, { maxLen = 600, overlap = 80 } = {}) {
  const src = String(text ?? '')
  if (!src.trim()) return []
  // 先按 markdown 标题切段
  const sections = []
  let heading = ''
  let buffer = []
  for (const line of src.split(/\r?\n/)) {
    const h = line.match(/^(#{1,4})\s+(.*)$/)
    if (h) {
      if (buffer.length) sections.push({ heading, text: buffer.join('\n') })
      heading = h[2].trim()
      buffer = [line]
    } else {
      buffer.push(line)
    }
  }
  if (buffer.length) sections.push({ heading, text: buffer.join('\n') })

  const chunks = []
  let offset = 0
  for (const section of sections) {
    const sectionStart = offset
    offset += section.text.length + 1
    const paragraphs = section.text.split(/\n\s*\n/)
    let current = ''
    let currentStart = sectionStart
    const push = (end) => {
      const trimmed = current.trim()
      if (trimmed) {
        chunks.push({
          heading: section.heading || null,
          text: trimmed,
          start: currentStart,
          end,
        })
      }
    }
    let cursor = sectionStart
    for (const para of paragraphs) {
      if (current && (current + '\n\n' + para).length > maxLen) {
        push(cursor - 1)
        // 重叠:保留尾部
        const tail = current.length > overlap ? current.slice(-overlap) : ''
        current = tail + '\n\n' + para
        currentStart = cursor - (tail ? tail.length + 2 : 0)
      } else {
        current = current ? current + '\n\n' + para : para
      }
      cursor += para.length + 2
    }
    if (current.trim()) push(sectionStart + section.text.length)
  }
  return chunks
}
