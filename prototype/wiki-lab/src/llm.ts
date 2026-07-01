// Wiki Lab — OpenAI-compatible LLM 调用封装

import type { LLMConfig, LLMCallOptions, ChatCompletion, LLMTool } from './types.js'

export async function llmCall(
  config: LLMConfig,
  opts: LLMCallOptions,
): Promise<ChatCompletion> {
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

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const errText = await response.text().catch(() => 'unknown')
    throw new Error(`LLM API 错误: ${response.status} - ${errText}`)
  }

  return response.json() as Promise<ChatCompletion>
}

/**
 * 结构化输出调用——通过 forced tool_choice 实现
 * 兼容所有 OpenAI Compatible API
 */
export async function llmStructuredCall<T>(
  config: LLMConfig,
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

  const result = await llmCall(config, {
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
        throw new Error(`LLM 返回的内容不是有效 JSON: ${content.slice(0, 200)}`)
      }
    }
    throw new Error('LLM 未返回 tool_call 也无有效内容')
  }

  try {
    return JSON.parse(toolCall.function.arguments) as T
  } catch {
    throw new Error(`tool_call arguments 解析失败: ${toolCall.function.arguments.slice(0, 200)}`)
  }
}

/**
 * 简单文本调用——不需要工具/结构化输出
 */
export async function llmTextCall(
  config: LLMConfig,
  system: string,
  userMessage: string,
): Promise<string> {
  const result = await llmCall(config, {
    system,
    messages: [{ role: 'user', content: userMessage }],
  })

  return result.choices[0]?.message?.content ?? ''
}
