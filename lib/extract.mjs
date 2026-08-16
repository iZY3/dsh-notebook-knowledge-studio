/**
 * HTML 正文提取:去掉导航/广告/脚本等非正文结构,保留标题层级。
 * 只提取"可靠获得"的元数据(title/author/date),拿不到就不写——宁可缺省,不伪造。
 */
import { decodeEntities } from './util.mjs'

const STRIP = /<(script|style|noscript|svg|canvas|iframe|form|nav|header|footer|aside|template)\b[^>]*>[\s\S]*?<\/\1>/gi
const STRIP_SELF = /<(nav|header|footer|aside)\b[^>]*\/>/gi

function tagText(html, tag) {
  const m = html.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i'))
  return m ? m[1] : null
}

export function extractHtml(html, url) {
  let src = String(html ?? '')
  const title = (tagText(src, 'title')?.trim())
    || (src.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.replace(/<[^>]+>/g, '').trim())
    || ''

  const author = src.match(/<meta[^>]+name=["']author["'][^>]+content=["']([^"']+)["']/i)?.[1]
    ?? src.match(/<meta[^>]+property=["']article:author["'][^>]+content=["']([^"']+)["']/i)?.[1]
    ?? null
  const publishedAt = src.match(/<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)["']/i)?.[1]
    ?? src.match(/<time\b[^>]*datetime=["']([^"']+)["']/i)?.[1]
    ?? null

  src = src.replace(STRIP, ' ').replace(STRIP_SELF, ' ')
  // 优先 article/main 主体
  const main = tagText(src, 'article') ?? tagText(src, 'main')
  if (main && main.replace(/<[^>]+>/g, '').trim().length > 200) src = main

  // 块级标签转换为 markdown 结构
  let text = src
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_, level, inner) => `\n\n${'#'.repeat(Number(level))} ${inner.replace(/<[^>]+>/g, '').trim()}\n\n`)
    .replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_, inner) => `\n- ${inner.replace(/<[^>]+>/g, '').trim()}`)
    .replace(/<(p|div|section|article|blockquote|pre|table|tr|ul|ol|br)\b[^>]*>/gi, '\n')
    .replace(/<\/(p|div|section|article|blockquote|pre|table|ul|ol)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
  text = decodeEntities(text)
  text = text
    .split('\n').map(l => l.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  return { title: title || 'Untitled page', text, author, publishedAt, url }
}
