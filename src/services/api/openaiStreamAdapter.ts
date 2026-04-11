/**
 * OpenAI SSE Stream → Anthropic BetaRawMessageStreamEvent 翻译器
 *
 * 将 OpenAI Compatible API 的 Server-Sent Events 流翻译为
 * Anthropic SDK 的 BetaRawMessageStreamEvent 格式，使下游代码无感知。
 */

// ─── OpenAI 响应类型 ───

export interface OpenAIChatCompletionChunk {
  readonly id: string
  readonly object: string
  readonly created: number
  readonly model: string
  readonly choices: ReadonlyArray<{
    readonly index: number
    readonly delta: {
      readonly role?: string
      readonly content?: string | null
      readonly tool_calls?: ReadonlyArray<{
        readonly index: number
        readonly id?: string
        readonly type?: string
        readonly function?: {
          readonly name?: string
          readonly arguments?: string
        }
      }>
    }
    readonly finish_reason?: string | null
  }>
  readonly usage?: {
    readonly prompt_tokens: number
    readonly completion_tokens: number
    readonly total_tokens: number
  }
}

// ─── 翻译状态 ───

interface StreamState {
  messageId: string
  model: string
  inputTokens: number
  outputTokens: number
  // 当前正在构建的 content block 索引
  nextBlockIndex: number
  // 是否已发送 message_start
  messageStarted: boolean
  // 文本块是否已开始
  textBlockStarted: boolean
  // tool_calls 追踪：openai index → anthropic block index + 累积 arguments
  toolCallMap: Map<number, {
    blockIndex: number
    id: string
    name: string
    arguments: string
  }>
}

// ─── 翻译器 ───

/**
 * 将单个 OpenAI chunk 翻译为一组 Anthropic 事件
 */
export function translateChunk(
  chunk: OpenAIChatCompletionChunk,
  state: StreamState,
): unknown[] {
  const events: unknown[] = []

  // 1. message_start（首次）
  if (!state.messageStarted) {
    state.messageStarted = true
    state.messageId = chunk.id || `msg_${Date.now()}`
    state.model = chunk.model || 'unknown'
    events.push({
      type: 'message_start',
      message: {
        id: state.messageId,
        type: 'message',
        role: 'assistant',
        content: [],
        model: state.model,
        stop_reason: null,
        stop_sequence: null,
        usage: {
          input_tokens: 0,
          output_tokens: 0,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
      },
    })
  }

  for (const choice of chunk.choices) {
    const delta = choice.delta

    // 2. 文本内容
    if (delta.content != null && delta.content !== '') {
      // 如果还没开始文本块，先发 content_block_start
      if (!state.textBlockStarted) {
        state.textBlockStarted = true
        events.push({
          type: 'content_block_start',
          index: state.nextBlockIndex,
          content_block: { type: 'text', text: '' },
        })
        state.nextBlockIndex++
      }
      events.push({
        type: 'content_block_delta',
        index: state.nextBlockIndex - 1,
        delta: { type: 'text_delta', text: delta.content },
      })
    }

    // 3. 工具调用
    if (delta.tool_calls) {
      for (const tc of delta.tool_calls) {
        const existing = state.toolCallMap.get(tc.index)

        if (!existing) {
          // 新工具调用开始
          // 先关闭文本块（如果有）
          if (state.textBlockStarted) {
            events.push({
              type: 'content_block_stop',
              index: state.nextBlockIndex - 1,
            })
            state.textBlockStarted = false
          }

          const blockIndex = state.nextBlockIndex
          state.nextBlockIndex++

          const toolId = tc.id || `tool_${Date.now()}_${tc.index}`
          const toolName = tc.function?.name || ''

          state.toolCallMap.set(tc.index, {
            blockIndex,
            id: toolId,
            name: toolName,
            arguments: tc.function?.arguments || '',
          })

          events.push({
            type: 'content_block_start',
            index: blockIndex,
            content_block: {
              type: 'tool_use',
              id: toolId,
              name: toolName,
              input: {},
            },
          })

          // 如果首个 chunk 就带了 arguments
          if (tc.function?.arguments) {
            events.push({
              type: 'content_block_delta',
              index: blockIndex,
              delta: {
                type: 'input_json_delta',
                partial_json: tc.function.arguments,
              },
            })
          }
        } else {
          // 累积 arguments
          if (tc.function?.arguments) {
            existing.arguments += tc.function.arguments
            events.push({
              type: 'content_block_delta',
              index: existing.blockIndex,
              delta: {
                type: 'input_json_delta',
                partial_json: tc.function.arguments,
              },
            })
          }
          // 更新 name（有些模型分批发 name）
          if (tc.function?.name && !existing.name) {
            existing.name = tc.function.name
          }
        }
      }
    }

    // 4. finish_reason → 关闭所有块 + message_delta + message_stop
    if (choice.finish_reason) {
      // 关闭文本块
      if (state.textBlockStarted) {
        events.push({
          type: 'content_block_stop',
          index: state.nextBlockIndex - 1,
        })
        state.textBlockStarted = false
      }

      // 关闭所有工具块
      for (const [, tc] of state.toolCallMap) {
        events.push({
          type: 'content_block_stop',
          index: tc.blockIndex,
        })
      }

      // 映射 stop_reason
      const stopReason = mapFinishReason(choice.finish_reason)

      // 取 usage
      const usage = chunk.usage
      if (usage) {
        state.inputTokens = usage.prompt_tokens
        state.outputTokens = usage.completion_tokens
      }

      events.push({
        type: 'message_delta',
        delta: { stop_reason: stopReason },
        usage: { output_tokens: state.outputTokens },
      })
      events.push({ type: 'message_stop' })
    }
  }

  // 5. 独立的 usage 事件（有些模型在最后一个 chunk 单独发 usage）
  if (chunk.usage && chunk.choices.length === 0) {
    state.inputTokens = chunk.usage.prompt_tokens
    state.outputTokens = chunk.usage.completion_tokens
  }

  return events
}

/**
 * 创建初始翻译状态
 */
export function createStreamState(): StreamState {
  return {
    messageId: '',
    model: '',
    inputTokens: 0,
    outputTokens: 0,
    nextBlockIndex: 0,
    messageStarted: false,
    textBlockStarted: false,
    toolCallMap: new Map(),
  }
}

/**
 * 解析 SSE 文本行为事件对象
 */
export function parseSSELine(line: string): OpenAIChatCompletionChunk | null {
  const trimmed = line.trim()

  // 跳过空行和注释
  if (!trimmed || trimmed.startsWith(':')) return null

  // 检测 [DONE]
  if (trimmed === 'data: [DONE]') return null

  // 提取 data: 前缀
  if (!trimmed.startsWith('data: ')) return null

  const jsonStr = trimmed.slice(6) // 去掉 "data: "
  try {
    return JSON.parse(jsonStr) as OpenAIChatCompletionChunk
  } catch {
    return null
  }
}

/**
 * 映射 OpenAI finish_reason → Anthropic stop_reason
 */
function mapFinishReason(reason: string): string {
  switch (reason) {
    case 'stop':
      return 'end_turn'
    case 'tool_calls':
      return 'tool_use'
    case 'length':
      return 'max_tokens'
    case 'content_filter':
      return 'end_turn'
    default:
      return 'end_turn'
  }
}

/**
 * 从 SSE Response body 创建 Anthropic 事件的 AsyncIterable
 */
export async function* streamSSEToAnthropicEvents(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<unknown> {
  const state = createStreamState()
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      if (signal?.aborted) break

      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })

      // 按换行分割，处理 SSE 事件
      const lines = buffer.split('\n')
      // 最后一行可能不完整，保留在 buffer
      buffer = lines.pop() || ''

      for (const line of lines) {
        const chunk = parseSSELine(line)
        if (!chunk) continue

        const events = translateChunk(chunk, state)
        for (const event of events) {
          yield event
        }
      }
    }

    // 处理 buffer 中剩余内容
    if (buffer.trim()) {
      const chunk = parseSSELine(buffer)
      if (chunk) {
        const events = translateChunk(chunk, state)
        for (const event of events) {
          yield event
        }
      }
    }

    // 如果没有收到 finish_reason，补发结束事件
    if (state.messageStarted && !state.outputTokens) {
      // 关闭未关闭的块
      if (state.textBlockStarted) {
        yield { type: 'content_block_stop', index: state.nextBlockIndex - 1 }
      }
      for (const [, tc] of state.toolCallMap) {
        yield { type: 'content_block_stop', index: tc.blockIndex }
      }
      yield {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn' },
        usage: { output_tokens: 0 },
      }
      yield { type: 'message_stop' }
    }
  } finally {
    reader.releaseLock()
  }
}
