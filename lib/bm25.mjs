/**
 * 纯 JS BM25(k1=1.5, b=0.75)。无外部依赖、无向量库——检索是缓存层,不是知识本体。
 */
import { tokenize } from './chunk.mjs'

export class BM25Index {
  constructor() {
    this.docs = []       // { id, tokens, len }
    this.df = new Map()  // term → doc frequency
    this.avgLen = 0
  }

  add(id, text) {
    const tokens = tokenize(text)
    this.docs.push({ id, tokens, len: tokens.length })
    const seen = new Set(tokens)
    for (const t of seen) this.df.set(t, (this.df.get(t) ?? 0) + 1)
    this.avgLen = this.docs.reduce((s, d) => s + d.len, 0) / this.docs.length
    return this
  }

  /** 返回 [{ id, score, terms }],按分数降序。 */
  search(query, topK = 8) {
    if (!this.docs.length) return []
    const k1 = 1.5
    const b = 0.75
    const N = this.docs.length
    const terms = [...new Set(tokenize(query))]
    const scores = new Map()
    const hitTerms = new Map()
    for (const doc of this.docs) {
      let score = 0
      const tf = new Map()
      for (const t of doc.tokens) tf.set(t, (tf.get(t) ?? 0) + 1)
      for (const term of terms) {
        const f = tf.get(term)
        if (!f) continue
        const n = this.df.get(term) ?? 0
        const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5))
        score += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * doc.len / this.avgLen))
        if (!hitTerms.has(doc.id)) hitTerms.set(doc.id, [])
        hitTerms.get(doc.id).push(term)
      }
      if (score > 0) scores.set(doc.id, score)
    }
    return [...scores.entries()]
      .map(([id, score]) => ({ id, score, terms: hitTerms.get(id) ?? [] }))
      .sort((a, b2) => b2.score - a.score)
      .slice(0, topK)
  }
}
