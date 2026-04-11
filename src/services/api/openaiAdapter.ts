/**
 * OpenAI Compatible Adapter
 *
 * 伪装成 Anthropic SDK 客户端接口，内部将请求翻译为 OpenAI Compatible 格式
 * 发送到任意 v1/chat/completions 端点，再将响应翻译回 Anthropic 事件流。
 *
 * 这样下游代码（claude.ts、sideQuery.ts 等）完全无感知。
 */

import type { ModelConfig } from '../../utils/claudemeConfig.js'
import {
  type OpenAIChatCompletionChunk,
  createStreamState,
  streamSSEToAnthropicEvents,
  translateChunk,
} from './openaiStreamAdapter.js'

// ─── 类型定义（简化的 Anthropic 接口类型） ───

interface AnthropicMessage {
  readonly role: string
  readonly content: ReadonlyArray<Record<string, unknown>>
}

interface OpenAIMessage {
  role: string
  content: string | Array<Record<string, unknown>>
  tool_calls?: Array<Record<string, unknown>>
  tool_call_id?: string
  name?: string
}

interface OpenAITool {
  type: 'function'
  function: {
    name: string
    description?: string
    parameters?: Record<string, unknown>
  }
}

interface OpenAIChatCompletionResponse {
  readonly id: string
  readonly object: string
  readonly created: number
  readonly model: string
  readonly choices: ReadonlyArray<{
    readonly index: number
    readonly message: {
      readonly role: string
      readonly content: string | null
      readonly tool_calls?: ReadonlyArray<{
        readonly id: string
        readonly type: string
        readonly function: {
          readonly name: string
          readonly arguments: string
        }
      }>
    }
    readonly finish_reason: string
  }>
  readonly usage?: {
    readonly prompt_tokens: number
    readonly completion_tokens: number
    readonly total_tokens: number
  }
}

// ─── 请求翻译：Anthropic → OpenAI ───

/**
 * 翻译 Anthropic system 参数为 OpenAI system message
 */
function translateSystem(
  system: unknown,
): OpenAIMessage[] {
  if (!system) return []

  // Anthropic system 可以是字符串或 TextBlockParam[]
  if (typeof system === 'string') {
    return [{ role: 'system', content: system }]
  }

  if (Array.isArray(system)) {
    const texts = system
      .filter((b: Record<string, unknown>) => b.type === 'text')
      .map((b: Record<string, unknown>) => b.text as string)
    if (texts.length > 0) {
      return [{ role: 'system', content: texts.join('\n\n') }]
    }
  }

  return []
}

/**
 * 翻译单个 Anthropic content block 为 OpenAI 格式
 */
function translateContentBlock(
  block: Record<string, unknown>,
  supportsVision: boolean,
): string | Record<string, unknown> | null {
  switch (block.type) {
    case 'text':
      return block.text as string

    case 'image': {
      if (!supportsVision) return null // 不支持视觉，剥离图片
      const source = block.source as Record<string, unknown>
      if (source?.type === 'base64') {
        return {
          type: 'image_url',
          image_url: {
            url: `data:${source.media_type};base64,${source.data}`,
          },
        }
      }
      if (source?.type === 'url') {
        return {
          type: 'image_url',
          image_url: { url: source.url },
        }
      }
      return null
    }

    case 'tool_use':
      // tool_use 在 assistant 消息中作为 tool_calls 处理，不在 content 中
      return null

    case 'tool_result':
      // tool_result 翻译为独立的 tool 消息，不在 content 中
      return null

    case 'thinking':
    case 'redacted_thinking':
      // thinking 降级处理——忽略
      return null

    case 'document':
      // 文档块降级为文本描述
      if (block.title) {
        return `[Document: ${block.title}]`
      }
      return null

    default:
      // 未知类型，尝试提取 text
      if (typeof block.text === 'string') return block.text as string
      return null
  }
}

/**
 * 翻译 Anthropic messages 为 OpenAI messages
 */
function translateMessages(
  messages: ReadonlyArray<AnthropicMessage>,
  supportsVision: boolean,
): OpenAIMessage[] {
  const result: OpenAIMessage[] = []

  for (const msg of messages) {
    if (msg.role === 'user') {
      const parts: Array<string | Record<string, unknown>> = []
      let toolResults: OpenAIMessage[] = []

      if (typeof msg.content === 'string') {
        result.push({ role: 'user', content: msg.content })
        continue
      }

      for (const block of msg.content) {
        if (block.type === 'tool_result') {
          // tool_result → 独立 tool 消息
          const toolContent = extractToolResultContent(block, supportsVision)
          toolResults = [
            ...toolResults,
            {
              role: 'tool',
              content: toolContent,
              tool_call_id: block.tool_use_id as string,
            },
          ]
        } else {
          const translated = translateContentBlock(block, supportsVision)
          if (translated !== null) {
            parts.push(translated)
          }
        }
      }

      // 先加 tool results（必须紧跟 assistant 的 tool_calls 之后）
      result.push(...toolResults)

      // 再加 user content
      if (parts.length > 0) {
        const hasNonString = parts.some((p) => typeof p !== 'string')
        if (hasNonString) {
          // 多模态内容，用数组格式
          result.push({
            role: 'user',
            content: parts.map((p) =>
              typeof p === 'string' ? { type: 'text', text: p } : p,
            ),
          })
        } else {
          // 纯文本，合并为字符串
          result.push({
            role: 'user',
            content: (parts as string[]).join('\n'),
          })
        }
      }
    } else if (msg.role === 'assistant') {
      const textParts: string[] = []
      const toolCalls: Array<Record<string, unknown>> = []

      if (typeof msg.content === 'string') {
        result.push({ role: 'assistant', content: msg.content })
        continue
      }

      for (const block of msg.content) {
        if (block.type === 'text') {
          textParts.push(block.text as string)
        } else if (block.type === 'tool_use') {
          toolCalls.push({
            id: block.id,
            type: 'function',
            function: {
              name: block.name,
              arguments:
                typeof block.input === 'string'
                  ? block.input
                  : JSON.stringify(block.input),
            },
          })
        }
        // thinking / redacted_thinking 忽略
      }

      const assistantMsg: OpenAIMessage = {
        role: 'assistant',
        content: textParts.join('') || '',
      }
      if (toolCalls.length > 0) {
        assistantMsg.tool_calls = toolCalls
      }
      result.push(assistantMsg)
    }
  }

  return result
}

/**
 * 从 tool_result block 提取文本内容
 */
function extractToolResultContent(
  block: Record<string, unknown>,
  supportsVision: boolean,
): string {
  const content = block.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''

  const parts: string[] = []
  for (const item of content) {
    if (item.type === 'text') {
      parts.push(item.text as string)
    } else if (item.type === 'image' && supportsVision) {
      parts.push('[image]')
    }
  }
  return parts.join('\n') || ''
}

/**
 * 翻译 Anthropic tools 为 OpenAI tools
 */
function translateTools(
  tools: ReadonlyArray<Record<string, unknown>> | undefined,
): OpenAITool[] | undefined {
  if (!tools || tools.length === 0) return undefined

  return tools
    .filter((t) => {
      // 只翻译标准工具，跳过 server_tool_use 等
      const toolType = t.type as string | undefined
      return !toolType || toolType === 'custom'
    })
    .map((t) => ({
      type: 'function' as const,
      function: {
        name: t.name as string,
        description: (t.description as string) || undefined,
        parameters: (t.input_schema as Record<string, unknown>) || undefined,
      },
    }))
}

/**
 * 翻译 Anthropic tool_choice 为 OpenAI tool_choice
 */
function translateToolChoice(
  toolChoice: Record<string, unknown> | undefined,
): string | Record<string, unknown> | undefined {
  if (!toolChoice) return undefined

  const type = toolChoice.type as string
  switch (type) {
    case 'auto':
      return 'auto'
    case 'any':
      return 'required'
    case 'tool':
      return {
        type: 'function',
        function: { name: toolChoice.name as string },
      }
    default:
      return 'auto'
  }
}

// ─── 构建 OpenAI 请求体 ───

function buildOpenAIRequest(
  params: Record<string, unknown>,
  modelConfig: ModelConfig,
  stream: boolean,
): Record<string, unknown> {
  const supportsVision = modelConfig.capabilities.vision
  const systemMessages = translateSystem(params.system)
  const userMessages = translateMessages(
    params.messages as ReadonlyArray<AnthropicMessage>,
    supportsVision,
  )
  const messages = [...systemMessages, ...userMessages]

  const request: Record<string, unknown> = {
    model: modelConfig.model,
    messages,
    max_tokens: (params.max_tokens as number) || modelConfig.max_tokens,
    stream,
  }

  // 翻译工具
  const tools = translateTools(
    params.tools as ReadonlyArray<Record<string, unknown>> | undefined,
  )
  if (tools && tools.length > 0) {
    request.tools = tools
    const toolChoice = translateToolChoice(
      params.tool_choice as Record<string, unknown> | undefined,
    )
    if (toolChoice) {
      request.tool_choice = toolChoice
    }
  }

  // temperature（只有 Anthropic 关闭 thinking 时才传）
  if (params.temperature != null) {
    request.temperature = params.temperature
  }

  // stream_options（获取 usage）
  if (stream) {
    request.stream_options = { include_usage: true }
  }

  return request
}

// ─── 响应翻译：OpenAI → Anthropic ───

/**
 * 非流式响应翻译
 */
function translateNonStreamingResponse(
  response: OpenAIChatCompletionResponse,
  requestModel: string,
): Record<string, unknown> {
  const choice = response.choices[0]
  if (!choice) {
    return {
      id: response.id || `msg_${Date.now()}`,
      type: 'message',
      role: 'assistant',
      content: [],
      model: requestModel,
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 },
    }
  }

  const content: Array<Record<string, unknown>> = []

  // 文本内容
  if (choice.message.content) {
    content.push({
      type: 'text',
      text: choice.message.content,
    })
  }

  // 工具调用
  if (choice.message.tool_calls) {
    for (const tc of choice.message.tool_calls) {
      let input: unknown = {}
      try {
        input = JSON.parse(tc.function.arguments)
      } catch {
        input = {}
      }
      content.push({
        type: 'tool_use',
        id: tc.id,
        name: tc.function.name,
        input,
      })
    }
  }

  const stopReason =
    choice.finish_reason === 'tool_calls'
      ? 'tool_use'
      : choice.finish_reason === 'length'
        ? 'max_tokens'
        : 'end_turn'

  return {
    id: response.id || `msg_${Date.now()}`,
    type: 'message',
    role: 'assistant',
    content,
    model: requestModel,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: {
      input_tokens: response.usage?.prompt_tokens || 0,
      output_tokens: response.usage?.completion_tokens || 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
  }
}

// ─── Stream 包装（伪装 Anthropic Stream） ───

/**
 * 创建一个伪装的 Anthropic Stream 对象
 * 实现 AsyncIterable + controller 接口
 */
function createAnthropicStream(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): unknown {
  const controller = new AbortController()

  // 如果外部 signal 被 abort，也 abort 内部 controller
  if (signal) {
    if (signal.aborted) {
      controller.abort()
    } else {
      signal.addEventListener('abort', () => controller.abort(), { once: true })
    }
  }

  const stream = {
    controller,
    [Symbol.asyncIterator]() {
      return streamSSEToAnthropicEvents(body, controller.signal)
    },
  }

  return stream
}

// ─── 核心 Adapter 工厂 ───

/**
 * 创建 OpenAI Compatible Adapter，伪装成 Anthropic 客户端
 *
 * @param modelConfig - 当前模型配置（从 claudeme.json 读取）
 * @returns 伪装的 Anthropic 客户端对象
 */
export function createOpenAICompatAdapter(modelConfig: ModelConfig): unknown {
  const baseUrl = (modelConfig.api_base || '').replace(/\/$/, '')
  const apiKey = modelConfig.api_key

  /**
   * 发送 HTTP 请求到 OpenAI Compatible 端点
   */
  async function sendRequest(
    body: Record<string, unknown>,
    options?: {
      signal?: AbortSignal
      headers?: Record<string, string>
      timeout?: number
    },
  ): Promise<Response> {
    const url = `${baseUrl}/chat/completions`

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options?.headers || {}),
    }
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`
    }

    const controller = new AbortController()
    let timeoutId: ReturnType<typeof setTimeout> | undefined

    // 超时控制
    if (options?.timeout) {
      timeoutId = setTimeout(() => controller.abort(), options.timeout)
    }

    // 链接外部 signal
    if (options?.signal) {
      if (options.signal.aborted) {
        controller.abort()
      } else {
        options.signal.addEventListener(
          'abort',
          () => controller.abort(),
          { once: true },
        )
      }
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      })

      if (!response.ok) {
        const errorBody = await response.text().catch(() => 'unknown error')
        throw new Error(
          `OpenAI Compatible API error: ${response.status} ${response.statusText} - ${errorBody}`,
        )
      }

      return response
    } finally {
      if (timeoutId) clearTimeout(timeoutId)
    }
  }

  // ─── 伪装的 beta.messages 接口 ───

  const messagesApi = {
    /**
     * create() — 核心 API
     *
     * 支持：
     * - await result → BetaMessage（非流式）或 Stream（流式）
     * - result.withResponse() → { data: Stream, request_id, response }
     * - result.asResponse() → Response
     */
    create(
      params: Record<string, unknown>,
      options?: {
        signal?: AbortSignal
        headers?: Record<string, string>
        timeout?: number
      },
    ): unknown {
      const isStream = params.stream === true
      const openaiBody = buildOpenAIRequest(params, modelConfig, isStream)

      if (isStream) {
        // ─── 流式模式 ───
        const responsePromise = sendRequest(openaiBody, options)

        // 创建一个 "thenable" 对象，支持 await 和 .withResponse()
        const apiPromise = {
          then(
            resolve: (value: unknown) => void,
            reject: (reason: unknown) => void,
          ) {
            responsePromise
              .then((response) => {
                if (!response.body) {
                  throw new Error('Response body is null')
                }
                resolve(
                  createAnthropicStream(response.body, options?.signal),
                )
              })
              .catch(reject)
          },

          catch(reject: (reason: unknown) => void) {
            return apiPromise.then(undefined as never, reject)
          },

          withResponse() {
            return responsePromise.then((response) => {
              if (!response.body) {
                throw new Error('Response body is null')
              }
              return {
                data: createAnthropicStream(response.body, options?.signal),
                request_id: response.headers.get('x-request-id') || `req_${Date.now()}`,
                response,
              }
            })
          },

          asResponse() {
            return responsePromise
          },
        }

        return apiPromise
      } else {
        // ─── 非流式模式 ───
        const responsePromise = sendRequest(openaiBody, options).then(
          async (response) => {
            const json =
              (await response.json()) as OpenAIChatCompletionResponse
            return {
              data: translateNonStreamingResponse(json, modelConfig.model),
              response,
            }
          },
        )

        const apiPromise = {
          then(
            resolve: (value: unknown) => void,
            reject: (reason: unknown) => void,
          ) {
            responsePromise.then(({ data }) => resolve(data)).catch(reject)
          },

          catch(reject: (reason: unknown) => void) {
            return apiPromise.then(undefined as never, reject)
          },

          withResponse() {
            return responsePromise.then(({ data, response }) => ({
              data,
              request_id:
                response.headers.get('x-request-id') || `req_${Date.now()}`,
              response,
            }))
          },

          asResponse() {
            return sendRequest(openaiBody, options)
          },
        }

        return apiPromise
      }
    },

    /**
     * countTokens() — 本地估算
     * OpenAI Compatible API 没有 countTokens 端点，本地粗略估算
     */
    async countTokens(
      params: Record<string, unknown>,
    ): Promise<{ input_tokens: number }> {
      // 粗略估算：把所有文本拼起来按 4 字符 ≈ 1 token
      let totalChars = 0

      // system
      const system = params.system
      if (typeof system === 'string') {
        totalChars += system.length
      } else if (Array.isArray(system)) {
        for (const block of system) {
          if (block.type === 'text') totalChars += (block.text as string).length
        }
      }

      // messages
      const messages = params.messages as ReadonlyArray<Record<string, unknown>>
      if (messages) {
        for (const msg of messages) {
          const content = msg.content
          if (typeof content === 'string') {
            totalChars += content.length
          } else if (Array.isArray(content)) {
            for (const block of content) {
              if (block.type === 'text') {
                totalChars += (block.text as string).length
              }
            }
          }
        }
      }

      // tools
      const tools = params.tools as ReadonlyArray<Record<string, unknown>>
      if (tools) {
        totalChars += JSON.stringify(tools).length
      }

      return { input_tokens: Math.ceil(totalChars / 4) }
    },
  }

  // ─── 伪装的 models 接口 ───

  const modelsApi = {
    async *list(
      _params?: Record<string, unknown>,
    ): AsyncGenerator<Record<string, unknown>> {
      // 从 modelConfig 返回当前模型信息
      yield {
        id: modelConfig.model,
        display_name: modelConfig.name,
        type: 'model',
        created_at: new Date().toISOString(),
      }
    },
  }

  // ─── 组装伪装客户端 ───

  return {
    beta: {
      messages: messagesApi,
    },
    messages: messagesApi, // 有些调用可能不走 beta
    models: modelsApi,
  }
}
