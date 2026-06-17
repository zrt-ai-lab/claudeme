/**
 * 镜像精灵 — UI 组件
 *
 * 拆成两部分：
 * - SpiritAvatar：精灵动画（第1行右侧）
 * - SpiritBubble：对话气泡（第2行，和 bypass 同行）
 */

import * as React from 'react'
import { memo } from 'react'
import { Box, Text } from '../../ink.js'
import { SPIRIT_COLORS } from './frames.js'
import type { SpiritStatus } from './useSpirit.js'

interface SpiritProps {
  readonly status: SpiritStatus
}

// ─── 精灵头像（第1行右侧） ───

function SpiritAvatarInner({ status }: SpiritProps): React.ReactNode {
  const { state, frame } = status
  const color = SPIRIT_COLORS[state]

  return <Text color={color}>{frame}</Text>
}

export const SpiritAvatar = memo(SpiritAvatarInner)

// ─── 对话气泡（第2行） ───

function SpiritBubbleInner({ status }: SpiritProps): React.ReactNode {
  const { bubble } = status

  if (!bubble) return null

  return (
    <Box flexDirection="row">
      <Text dimColor>{'「'}</Text>
      <Text color="ansi:white">{bubble}</Text>
      <Text dimColor>{'」'}</Text>
    </Box>
  )
}

export const SpiritBubble = memo(SpiritBubbleInner)
