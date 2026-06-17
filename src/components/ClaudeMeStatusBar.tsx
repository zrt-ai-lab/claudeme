/**
 * ClaudeMe 内置状态栏（含镜像精灵）
 *
 * 方案 A 布局：
 * 第1行：模型 + 进度条 + token 数据 + 费用 ... 右侧精灵动画
 * 第2行（由 footer 控制）：bypass ... 右侧气泡对话
 *
 * spiritStatus 由外部传入，便于 footer 在第二行渲染气泡。
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
import { SpiritAvatar } from './spirit/index.js'
import type { SpiritStatus } from './spirit/index.js'

// ─── 常量 ───

const BAR_WIDTH = 12

// ─── 工具函数（导出供 hook 使用） ───

export function formatTokenCount(n: number): string {
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

// ─── 计算上下文百分比的 Hook（供 footer 调用精灵用） ───

export function useContextPercent(messages: Message[]): {
  percent: number
  totalCost: number
} {
  const modelConfig = useMemo(() => claudemeConfig.getCurrentModelConfig(), [])
  const contextWindow = modelConfig?.context_window ?? 200_000
  const totalCost = getTotalCost()

  const lastValidSnapshot = useRef<number>(0)

  const currentTokens = useMemo(() => {
    const usage = getCurrentUsage(messages)
    if (usage && usage.input_tokens > 0) {
      const snapshot = usage.input_tokens +
        usage.cache_creation_input_tokens +
        usage.cache_read_input_tokens +
        usage.output_tokens
      lastValidSnapshot.current = snapshot
      return snapshot
    }
    return lastValidSnapshot.current
  }, [messages])

  const percent = contextWindow > 0
    ? clamp(Math.round((currentTokens / contextWindow) * 100))
    : 0

  return { percent, totalCost }
}

// ─── 组件 ───

type Props = {
  messages: Message[]
  spiritStatus: SpiritStatus
}

function ClaudeMeStatusBarInner({ messages, spiritStatus }: Props): React.ReactNode {
  const modelConfig = useMemo(() => claudemeConfig.getCurrentModelConfig(), [])
  const modelName = modelConfig?.name ?? 'Unknown'
  const contextWindow = modelConfig?.context_window ?? 200_000
  const providerName = modelConfig?.providerName ?? ''

  // 累计 token
  const totalInput = getTotalInputTokens()
  const totalOutput = getTotalOutputTokens()
  const totalCost = getTotalCost()
  const totalTokens = totalInput + totalOutput

  // 当前上下文 token 数
  const lastValidSnapshot = useRef<number>(0)

  const currentTokens = useMemo(() => {
    const usage = getCurrentUsage(messages)
    if (usage && usage.input_tokens > 0) {
      const snapshot = usage.input_tokens +
        usage.cache_creation_input_tokens +
        usage.cache_read_input_tokens +
        usage.output_tokens
      lastValidSnapshot.current = snapshot
      return snapshot
    }
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
  const filledBar = '\u2588'.repeat(filledCount)
  const emptyBar = '\u2591'.repeat(emptyCount)

  // 费用颜色
  const costColor: BarColor = totalCost > 5 ? 'ansi:red' : totalCost > 1 ? 'ansi:yellow' : 'ansi:green'

  // 模型标签
  const modelLabel = providerName ? `${modelName} ${providerName}` : modelName

  return (
    <Box flexDirection="row" justifyContent="space-between" width="100%">
      {/* 左侧：状态数据 */}
      <Box flexDirection="row" flexShrink={1}>
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
      {/* 右侧：精灵头像 */}
      <SpiritAvatar status={spiritStatus} />
    </Box>
  )
}

export const ClaudeMeStatusBar = memo(ClaudeMeStatusBarInner)
