/**
 * ClaudeMe 内置状态栏
 *
 * 直接从内部 cost-tracker 读取数据，
 * 显示当前模型、token 用量、上下文窗口百分比、费用等。
 * 动态颜色随上下文使用率变化（绿→黄→红→紫）。
 *
 * 进度条使用 █/░，填充部分跟随百分比颜色变化。
 */

import * as React from 'react'
import { memo, useMemo, useRef } from 'react'
import { Box, Text } from '../ink.js'
import type { Message } from '../types/message.js'
import { getCurrentUsage } from '../utils/tokens.js'
import {
  getTotalInputTokens,
  getTotalOutputTokens,
  getTotalCost,
} from '../cost-tracker.js'
import * as claudemeConfig from '../utils/claudemeConfig.js'

// ─── 常量 ───

const BAR_WIDTH = 12

// ─── 工具函数 ───

function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 10_000) return `${(n / 1_000).toFixed(0)}k`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return `${n}`
}

function formatCost(cost: number): string {
  if (cost <= 0) return '$0.00'
  if (cost < 0.01) return `$${cost.toFixed(4)}`
  if (cost < 1) return `$${cost.toFixed(3)}`
  return `$${cost.toFixed(2)}`
}

type BarColor = 'ansi:green' | 'ansi:yellow' | 'ansi:red' | 'ansi:magenta'

/**
 * 根据百分比返回颜色
 * 0-40%: green, 40-65%: yellow, 65-85%: red, 85%+: magenta
 */
function getBarColor(percent: number): BarColor {
  if (percent >= 85) return 'ansi:magenta'
  if (percent >= 65) return 'ansi:red'
  if (percent >= 40) return 'ansi:yellow'
  return 'ansi:green'
}

function clamp(n: number): number {
  return Math.min(100, Math.max(0, n))
}

// ─── 组件 ───

type Props = {
  messages: Message[]
}

function ClaudeMeStatusBarInner({ messages }: Props): React.ReactNode {
  const modelConfig = useMemo(() => claudemeConfig.getCurrentModelConfig(), [])
  const modelName = modelConfig?.name ?? 'Unknown'
  const contextWindow = modelConfig?.context_window ?? 200_000
  const providerName = modelConfig?.providerName ?? ''

  // 累计 token（从 cost-tracker 全局状态读取）
  const totalInput = getTotalInputTokens()
  const totalOutput = getTotalOutputTokens()
  const totalCost = getTotalCost()
  const totalTokens = totalInput + totalOutput

  // 当前上下文 token 数（代表最近一次 API 请求的上下文快照）
  // 注意：这不是累计值，而是"单次请求"的上下文大小
  //
  // 关键区别：
  // - totalInput/totalOutput 是所有请求的累计值（会超过 context window）
  // - currentTokens 是单次请求的上下文大小（不应超过 context window）
  //
  // 使用 ref 保持稳定：streaming 过程中最新 message 尚无 usage，
  // 此时保持上一次有效快照不变，避免在"精确值"和"粗估值"之间跳转
  const lastValidSnapshot = useRef<number>(0)

  const currentTokens = useMemo(() => {
    // 从最后一条有 usage 的 API 响应获取精确的上下文快照
    // input_tokens = 该次请求发送给模型的全部 context（系统提示+历史+工具定义等）
    const usage = getCurrentUsage(messages)
    if (usage && usage.input_tokens > 0) {
      const snapshot = usage.input_tokens +
        usage.cache_creation_input_tokens +
        usage.cache_read_input_tokens +
        usage.output_tokens
      lastValidSnapshot.current = snapshot
      return snapshot
    }

    // 没有有效 usage — 保持上一次快照值（避免跳转）
    // 第一次进入（尚无任何 API 响应）时返回 0
    return lastValidSnapshot.current
  }, [messages])

  // 百分比
  const percent = contextWindow > 0
    ? clamp(Math.round((currentTokens / contextWindow) * 100))
    : 0

  // 进度条
  const barColor = getBarColor(percent)
  const filledCount = Math.round((percent / 100) * BAR_WIDTH)
  const emptyCount = BAR_WIDTH - filledCount
  const filledBar = '\u2588'.repeat(filledCount)   // █
  const emptyBar = '\u2591'.repeat(emptyCount)      // ░

  // 费用颜色
  const costColor: BarColor = totalCost > 5 ? 'ansi:red' : totalCost > 1 ? 'ansi:yellow' : 'ansi:green'

  // 模型标签
  const modelLabel = providerName ? `${modelName} ${providerName}` : modelName

  return (
    <Box flexDirection="row">
      <Text color="ansi:cyan" bold>{modelLabel}</Text>
      <Text>{' '}</Text>
      <Text color={barColor}>{filledBar}</Text>
      <Text dimColor>{emptyBar}</Text>
      <Text color={barColor} bold>{` ${percent}%`}</Text>
      <Text dimColor>{` ${formatTokenCount(currentTokens)}/${formatTokenCount(contextWindow)}`}</Text>
      <Text dimColor>{'  in '}</Text>
      <Text color="ansi:green">{formatTokenCount(totalInput)}</Text>
      <Text dimColor>{' out '}</Text>
      <Text color="ansi:blue">{formatTokenCount(totalOutput)}</Text>
      <Text dimColor>{` total ${formatTokenCount(totalTokens)}  `}</Text>
      <Text color={costColor}>{formatCost(totalCost)}</Text>
    </Box>
  )
}

export const ClaudeMeStatusBar = memo(ClaudeMeStatusBarInner)
