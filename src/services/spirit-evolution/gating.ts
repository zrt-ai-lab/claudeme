/**
 * 镜像精灵 — Review 门控
 *
 * 决定每轮对话后是否值得花 token 做 review。
 * 避免简单闲聊、短对话浪费成本。
 *
 * 门控条件（满足任一即触发）：
 * 1. 本轮有 ≥3 次 tool 调用（有实质工作）
 * 2. 用户纠正过 AI（检测纠正信号词）
 * 3. 本轮消息 ≥6 条（有足够上下文值得提取）
 * 4. 距上次 review 已过 ≥5 轮
 *
 * 冷却条件（满足任一则跳过）：
 * 1. 距上次 review < 2 分钟
 * 2. 对话总消息 < 4 条（太短）
 */

import type { Message } from '../../types/message.js'

// ─── 常量 ───

/** 冷却时间（毫秒） */
const COOLDOWN_MS = 2 * 60 * 1000 // 2 分钟

/** 最少消息数 */
const MIN_MESSAGES = 4

/** tool 调用阈值 */
const TOOL_CALL_THRESHOLD = 3

/** 消息数阈值 */
const MESSAGE_COUNT_THRESHOLD = 6

/** 轮次间隔强制触发 */
const FORCE_INTERVAL_TURNS = 5

// ─── 状态（模块级） ───

let lastReviewTimestamp = 0
let turnsSinceLastReview = 0

/** 重置门控状态（测试用） */
export function resetGating(): void {
  lastReviewTimestamp = 0
  turnsSinceLastReview = 0
}

/** 记录一次 review 完成 */
export function markReviewDone(): void {
  lastReviewTimestamp = Date.now()
  turnsSinceLastReview = 0
}

/** 递增轮次计数 */
export function incrementTurn(): void {
  turnsSinceLastReview++
}

// ─── 纠正信号检测 ───

const CORRECTION_PATTERNS = [
  /不[是对]/, /错了/, /不要这样/, /别这么/,
  /应该是/, /你搞错/, /不对吧/, /修改一下/,
  /重来/, /重新/, /你理解错/, /不是这个意思/,
  /wrong/i, /no[,，]/, /incorrect/i, /fix (this|it|that)/i,
  /not what i/i, /that's not/i, /don't do/i,
]

function hasUserCorrection(messages: Message[]): boolean {
  // 只检查最近 10 条用户消息
  const recentUserMessages = messages
    .filter(m => m.type === 'user')
    .slice(-10)

  for (const msg of recentUserMessages) {
    if (!('message' in msg) || typeof msg.message !== 'object') continue
    const content = msg.message?.content
    if (!content) continue

    const text = Array.isArray(content)
      ? content
          .filter((b: { type: string }) => b.type === 'text')
          .map((b: { text: string }) => b.text)
          .join(' ')
      : typeof content === 'string'
        ? content
        : ''

    if (CORRECTION_PATTERNS.some(p => p.test(text))) return true
  }
  return false
}

// ─── tool 调用计数 ───

function countToolCalls(messages: Message[]): number {
  return messages.filter(m => m.type === 'tool_result').length
}

// ─── 主门控函数 ───

export interface GatingResult {
  readonly shouldReview: boolean
  readonly reason: string
}

export function shouldRunReview(messages: Message[]): GatingResult {
  // 冷却检查
  const elapsed = Date.now() - lastReviewTimestamp
  if (lastReviewTimestamp > 0 && elapsed < COOLDOWN_MS) {
    return { shouldReview: false, reason: `cooldown (${Math.round(elapsed / 1000)}s < 120s)` }
  }

  // 最少消息检查
  if (messages.length < MIN_MESSAGES) {
    return { shouldReview: false, reason: `too few messages (${messages.length} < ${MIN_MESSAGES})` }
  }

  // 递增轮次
  incrementTurn()

  // 触发条件 1：tool 调用足够多
  const toolCalls = countToolCalls(messages)
  if (toolCalls >= TOOL_CALL_THRESHOLD) {
    return { shouldReview: true, reason: `tool calls (${toolCalls} >= ${TOOL_CALL_THRESHOLD})` }
  }

  // 触发条件 2：用户纠正
  if (hasUserCorrection(messages)) {
    return { shouldReview: true, reason: 'user correction detected' }
  }

  // 触发条件 3：消息足够多
  if (messages.length >= MESSAGE_COUNT_THRESHOLD) {
    return { shouldReview: true, reason: `message count (${messages.length} >= ${MESSAGE_COUNT_THRESHOLD})` }
  }

  // 触发条件 4：距上次 review 间隔过长
  if (turnsSinceLastReview >= FORCE_INTERVAL_TURNS) {
    return { shouldReview: true, reason: `force interval (${turnsSinceLastReview} turns)` }
  }

  return { shouldReview: false, reason: 'no trigger condition met' }
}
