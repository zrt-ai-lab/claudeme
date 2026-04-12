// Wiki 知识库 — LLM 调用桥接层
// 从 ClaudeMe 的 claudemeConfig 取配置，直接 fetch 调 OpenAI 兼容接口
// 支持 wiki 专属模型配置：claudeme.json 的 wiki.model 字段

import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { getCurrentModelConfig, getModelConfigByKey } from '../utils/claudemeConfig.js'

// ─── 内部类型（不导出） ───

interface ChatCompletionResponse {
  readonly id: string
  readonly choices: readonly {
    readonly index: number
    readonly message: {
      readonly role: string
      readonly content: string | null
      readonly tool_calls?: readonly {
        readonly id: string
        readonly type: 'function'
        readonly function: {
          readonly name: string
          readonly arguments: string
        }
      }[]
    }
    readonly finish_reason: string
  }[]
  readonly usage?: {
    readonly prompt_tokens: number
    readonly completion_tokens: number
    readonly total_tokens: number
  }
}

interface LLMMessage {
  readonly role: 'system' | 'user' | 'assistant' | 'tool'
  readonly content: string
  readonly tool_call_id?: string
  readonly tool_calls?: readonly {
    readonly id: string
    readonly type: 'function'
    readonly function: { readonly name: string; readonly arguments: string }
  }[]
}

interface LLMTool {
  readonly type: 'function'
  readonly function: {
    readonly name: string
    readonly description?: string
    readonly parameters?: Record<string, unknown>
  }
}

interface LLMCallOptions {
  readonly system?: string
  readonly messages: readonly LLMMessage[]
  readonly tools?: readonly LLMTool[]
  readonly toolChoice?: 'auto' | 'required' | { type: 'function'; function: { name: string } }
  readonly temperature?: number
  readonly maxTokens?: number
}

// ─── 配置读取 ───

/** 从 claudeme.json 读取 wiki.model 配置 */
function getWikiModelKey(): string | null {
  const candidatePaths = [
    process.env.CLAUDEME_CONFIG,
    join(process.cwd(), 'claudeme.json'),
  ].filter((p): p is string => !!p)

  for (const configPath of candidatePaths) {
    if (!existsSync(configPath)) continue
    try {
      const raw = readFileSync(configPath, 'utf-8')
      const parsed = JSON.parse(raw)
      if (typeof parsed.wiki?.model === 'string') {
        return parsed.wiki.model
      }
    } catch {
      // 忽略
    }
  }
  return null
}

function getConfig(): { apiBase: string; apiKey: string; model: string; maxTokens: number } {
  // 优先使用 wiki 专属模型，没配则用当前模型
  const wikiModelKey = getWikiModelKey()
  const modelConfig = wikiModelKey
    ? getModelConfigByKey(wikiModelKey)
    : getCurrentModelConfig()

  if (!modelConfig) {
    const hint = wikiModelKey
      ? `wiki.model "${wikiModelKey}" 在 providers 中不存在`
      : '未找到 ClaudeMe 模型配置'
    throw new Error(`Wiki LLM 调用失败：${hint}。请检查 claudeme.json`)
  }

  const apiBase = modelConfig.api_base?.replace(/\/+$/, '')
  if (!apiBase) {
    throw new Error('Wiki LLM 调用失败：模型配置缺少 api_base')
  }

  const apiKey = modelConfig.api_key
  if (!apiKey) {
    throw new Error('Wiki LLM 调用失败：模型配置缺少 api_key')
  }

  return {
    apiBase,
    apiKey,
    model: modelConfig.model,
    maxTokens: modelConfig.max_tokens ?? 4096,
  }
}

// ─── 基础调用（含自动重试） ───

const MAX_RETRIES = 2
const RETRY_DELAY_MS = 2000
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504])

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function llmCall(opts: LLMCallOptions): Promise<ChatCompletionResponse> {
  const config = getConfig()
  const url = `${config.apiBase}/chat/completions`

  const messages = [
    ...(opts.system ? [{ role: 'system' as const, content: opts.system }] : []),
    ...opts.messages,
  ]

  const body: Record<string, unknown> = {
    model: config.model,
    messages,
    max_tokens: opts.maxTokens ?? config.maxTokens,
    stream: false,
  }

  if (opts.tools && opts.tools.length > 0) {
    body.tools = opts.tools
    if (opts.toolChoice) {
      body.tool_choice = opts.toolChoice
    }
  }

  if (opts.temperature != null) {
    body.temperature = opts.temperature
  }

  let lastError: Error | null = null

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      await sleep(RETRY_DELAY_MS * attempt)
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120_000),
      })

      if (!response.ok) {
        const errText = await response.text().catch(() => 'unknown')

        if (RETRYABLE_STATUS_CODES.has(response.status) && attempt < MAX_RETRIES) {
          lastError = new Error(`Wiki LLM API 错误: ${response.status} - ${errText}`)
          continue
        }

        throw new Error(`Wiki LLM API 错误: ${response.status} - ${errText}`)
      }

      return response.json() as Promise<ChatCompletionResponse>
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))

      // 超时或网络错误也重试
      if (attempt < MAX_RETRIES && !(err instanceof Error && err.message.includes('Wiki LLM API 错误'))) {
        continue
      }

      throw lastError
    }
  }

  throw lastError ?? new Error('Wiki LLM 调用失败（未知错误）')
}

// ─── 结构化输出（forced tool_choice） ───

export async function llmStructuredCall<T>(
  system: string,
  userMessage: string,
  schema: {
    readonly name: string
    readonly description: string
    readonly parameters: Record<string, unknown>
  },
): Promise<T> {
  const tool: LLMTool = {
    type: 'function',
    function: {
      name: schema.name,
      description: schema.description,
      parameters: schema.parameters,
    },
  }

  const result = await llmCall({
    system,
    messages: [{ role: 'user', content: userMessage }],
    tools: [tool],
    toolChoice: { type: 'function', function: { name: schema.name } },
    maxTokens: 8192,
  })

  const toolCall = result.choices[0]?.message?.tool_calls?.[0]
  if (!toolCall) {
    // 有些 API 不返回 tool_call，而是直接返回 JSON 内容
    const content = result.choices[0]?.message?.content
    if (content) {
      try {
        return JSON.parse(content) as T
      } catch {
        throw new Error(`Wiki LLM 返回的内容不是有效 JSON: ${content.slice(0, 200)}`)
      }
    }
    throw new Error('Wiki LLM 未返回 tool_call 也无有效内容')
  }

  try {
    return JSON.parse(toolCall.function.arguments) as T
  } catch {
    throw new Error(`Wiki tool_call arguments 解析失败: ${toolCall.function.arguments.slice(0, 200)}`)
  }
}

// ─── 简单文本调用 ───

export async function llmTextCall(
  system: string,
  userMessage: string,
): Promise<string> {
  const result = await llmCall({
    system,
    messages: [{ role: 'user', content: userMessage }],
  })

  return result.choices[0]?.message?.content ?? ''
}
