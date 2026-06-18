/**
 * 镜像精灵 — PostTurn Review
 *
 * 每轮对话结束后的后台自我 review。
 * Fire-and-forget：不阻塞主循环，失败静默。
 *
 * 实现方式：
 * - 使用当前模型的 API 直接调用（非 forkedAgent，避免复杂依赖）
 * - 将对话摘要 + 当前知识库发给模型
 * - 解析 JSON 响应，写入对应 .md 文件
 * - 通过 claudemeConfig 获取 API 配置
 */

import type { Message } from '../../types/message.js'
import * as claudemeConfig from '../../utils/claudemeConfig.js'
import { shouldRunReview, markReviewDone, type GatingResult } from './gating.js'
import { REVIEW_SYSTEM_PROMPT, buildReviewUserPrompt } from './reviewPrompt.js'
import { emitSpiritEvent } from './events.js'
import {
  readFile,
  appendToFile,
  writeFile,
  recordReview,
  type SpiritFileKey,
} from './spiritStore.js'
import { logError } from '../../utils/log.js'

// ─── 类型 ───

interface ReviewEntry {
  readonly action: 'add' | 'update' | 'none'
  readonly content?: string
  readonly old_content?: string
}

interface ReviewResult {
  readonly insights: readonly ReviewEntry[]
  readonly skills: readonly ReviewEntry[]
  readonly pitfalls: readonly ReviewEntry[]
}

// ─── 对话摘要 ───

/** 将 messages 压缩为文本摘要（限制 token 量） */
function summarizeConversation(messages: Message[], maxChars: number = 12000): string {
  const lines: string[] = []

  for (const msg of messages) {
    if (msg.type === 'user') {
      const content = extractTextContent(msg)
      if (content) lines.push(`[User]: ${content}`)
    } else if (msg.type === 'assistant') {
      const content = extractTextContent(msg)
      if (content) lines.push(`[Assistant]: ${content}`)
    } else if (msg.type === 'tool_result') {
      lines.push(`[Tool Result]: (omitted)`)
    }
  }

  const text = lines.join('\n')
  if (text.length <= maxChars) return text
  // 截取最后 maxChars 字符（保留最近的对话）
  return '...(earlier conversation omitted)\n' + text.slice(-maxChars)
}

function extractTextContent(msg: Message): string {
  if (!('message' in msg)) return ''
  const message = msg.message as { content?: unknown }
  if (!message?.content) return ''

  const content = message.content
  if (typeof content === 'string') return content.slice(0, 500)
  if (Array.isArray(content)) {
    return content
      .filter((b: { type: string }) => b.type === 'text')
      .map((b: { text: string }) => b.text)
      .join(' ')
      .slice(0, 500)
  }
  return ''
}

// ─── API 调用 ───

async function callReviewAPI(
  systemPrompt: string,
  userPrompt: string,
): Promise<string | null> {
  const config = claudemeConfig.getCurrentModelConfig()
  if (!config) return null

  const { baseUrl, apiKey, model } = config

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 2000,
      }),
    })

    if (!response.ok) return null

    const data = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>
    }
    return data.choices?.[0]?.message?.content ?? null
  } catch {
    return null
  }
}

// ─── 解析响应 ───

function parseReviewResponse(raw: string): ReviewResult | null {
  try {
    // 提取 JSON 块（可能被 ```json ... ``` 包裹）
    const jsonMatch = raw.match(/```json\s*([\s\S]*?)```/) ?? raw.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return null

    const jsonStr = jsonMatch[1] ?? jsonMatch[0]
    const parsed = JSON.parse(jsonStr)

    return {
      insights: Array.isArray(parsed.insights) ? parsed.insights : [],
      skills: Array.isArray(parsed.skills) ? parsed.skills : [],
      pitfalls: Array.isArray(parsed.pitfalls) ? parsed.pitfalls : [],
    }
  } catch {
    return null
  }
}

// ─── 应用更新 ───

function applyEntries(key: SpiritFileKey, entries: readonly ReviewEntry[]): number {
  let count = 0

  for (const entry of entries) {
    if (entry.action === 'none' || !entry.content) continue

    if (entry.action === 'add') {
      appendToFile(key, entry.content)
      count++
    } else if (entry.action === 'update' && entry.old_content) {
      const current = readFile(key)
      if (current.includes(entry.old_content)) {
        const updated = current.replace(entry.old_content, entry.content)
        writeFile(key, updated)
        count++
      } else {
        // old_content 找不到，降级为 add
        appendToFile(key, entry.content)
        count++
      }
    }
  }

  return count
}

// ─── 主入口 ───

/**
 * 执行 PostTurn Review。Fire-and-forget，不抛出异常。
 * 返回门控结果（即使未执行 review 也返回原因）。
 */
export async function executePostTurnReview(messages: Message[]): Promise<GatingResult> {
  // 门控检查
  const gating = shouldRunReview(messages)
  if (!gating.shouldReview) return gating

  try {
    // 准备数据
    const conversation = summarizeConversation(messages)
    const currentInsights = readFile('insights')
    const currentSkills = readFile('skills')
    const currentPitfalls = readFile('pitfalls')

    const userPrompt = buildReviewUserPrompt(
      conversation,
      currentInsights,
      currentSkills,
      currentPitfalls,
    )

    // 调用 API
    const rawResponse = await callReviewAPI(REVIEW_SYSTEM_PROMPT, userPrompt)
    if (!rawResponse) {
      markReviewDone()
      return { shouldReview: true, reason: 'executed (no response)' }
    }

    // 解析
    const result = parseReviewResponse(rawResponse)
    if (!result) {
      markReviewDone()
      return { shouldReview: true, reason: 'executed (parse failed)' }
    }

    // 应用更新
    const newInsights = applyEntries('insights', result.insights)
    const newSkills = applyEntries('skills', result.skills)
    const newPitfalls = applyEntries('pitfalls', result.pitfalls)

    // 记录统计
    recordReview(newInsights, newSkills, newPitfalls)
    markReviewDone()

    const total = newInsights + newSkills + newPitfalls

    // 通知精灵
    if (total > 0) {
      emitSpiritEvent({
        type: 'review_done',
        insightCount: newInsights,
        skillCount: newSkills,
        pitfallCount: newPitfalls,
      })
    }

    return {
      shouldReview: true,
      reason: `executed (${total} entries written: ${newInsights}I/${newSkills}S/${newPitfalls}P)`,
    }
  } catch (error) {
    logError(error)
    markReviewDone()
    return { shouldReview: true, reason: 'executed (error)' }
  }
}
