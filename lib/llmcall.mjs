/**
 * LLM 调用助手。绝不写死 provider:配置覆盖 → 当前会话 agent 路由 → 第一个已注册路由。
 * llm 服务不存在时返回 null,调用方降级,不得阻塞插件。
 */

/** 解析可用的 provider/model 路由。 */
export async function resolveRoute(ctx, config) {
  const llm = ctx.get('llm')
  if (!llm) return null
  try {
    if (config?.llmProvider) {
      return { provider: config.llmProvider, model: config.llmModel ?? undefined }
    }
    // 复用当前会话 agent 的路由(与 router-tools 同款探测方式)
    try {
      const initiator = ctx.get('agents')?.currentInitiator?.()
      if (initiator?.options?.provider && initiator?.options?.model) {
        return { provider: initiator.options.provider, model: initiator.options.model }
      }
    } catch { /* fall through */ }
    const providers = llm.listProviders()
    if (providers.length) {
      const provider = providers[0].id ?? providers[0].provider ?? providers[0]
      let model
      try {
        const models = await llm.listModels(String(provider))
        model = models[0]?.id ?? models[0]?.model
      } catch { /* adapter 不支持列模型则交给 adapter 动态解析 */ }
      return { provider: String(provider), model }
    }
  } catch { /* fall through */ }
  return null
}

/**
 * 流式调用,聚合 text-delta 为完整文本。
 * 返回 { text, provider, model };finish 出错时抛出。
 */
export async function streamText(ctx, route, { system, messages, maxTokens = 2048, signal }) {
  const llm = ctx.get('llm')
  if (!llm || !route) throw new Error('llm service unavailable')
  let text = ''
  const stream = llm.stream({
    provider: route.provider,
    model: route.model,
    system,
    messages,
    maxTokens,
    ...(signal ? { signal } : {}),
  })
  for await (const chunk of stream) {
    if (chunk.type === 'text-delta') text += chunk.text
    else if (chunk.type === 'finish' && chunk.kind === 'error') {
      throw new Error(`llm finish error: ${chunk.failure?.message ?? 'unknown'}`)
    }
  }
  return { text, provider: route.provider, model: route.model }
}
