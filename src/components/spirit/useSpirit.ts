/**
 * 镜像精灵 — 状态机 Hook
 *
 * 管理精灵的状态转换、帧动画、对话气泡触发。
 *
 * 状态转换规则：
 * - isStreaming=true → working
 * - 3分钟无输入 → sleeping
 * - contextPercent>=70 → alert（优先级高于 idle）
 * - cost>=10 → alert
 * - 其他 → idle
 * - talking 由定时器触发，叠加在 base 状态上
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { SPIRIT_FRAMES, type SpiritState } from './frames.js'
import {
  IDLE_DIALOGUES,
  COST_DIALOGUES,
  CONTEXT_DIALOGUES,
  INACTIVE_DIALOGUES,
  DONE_DIALOGUES,
  LEARNED_DIALOGUES,
  pickRandom,
  type SpiritDialogue,
} from './dialogues.js'
import { onSpiritEvent } from '../../services/spirit-evolution/events.js'

export interface SpiritStatus {
  /** 当前显示状态 */
  readonly state: SpiritState
  /** 当前帧 art 字符串 */
  readonly frame: string
  /** 当前气泡文字（null=不显示） */
  readonly bubble: string | null
}

interface UseSpiritOptions {
  /** AI 是否正在流式生成 */
  readonly isStreaming: boolean
  /** 上下文使用百分比 0-100 */
  readonly contextPercent: number
  /** 累计费用 */
  readonly totalCost: number
}

/** 闲聊间隔范围（毫秒） */
const CHAT_MIN_INTERVAL = 30_000
const CHAT_MAX_INTERVAL = 90_000

/** 无操作多久进入 sleeping（毫秒） */
const INACTIVE_THRESHOLD = 180_000 // 3 分钟

/** 帧动画 tick 间隔（毫秒） */
const FRAME_TICK = 200

function randomInterval(): number {
  return CHAT_MIN_INTERVAL + Math.random() * (CHAT_MAX_INTERVAL - CHAT_MIN_INTERVAL)
}

export function useSpirit(options: UseSpiritOptions): SpiritStatus {
  const { isStreaming, contextPercent, totalCost } = options

  const [baseState, setBaseState] = useState<SpiritState>('idle')
  const [frameIndex, setFrameIndex] = useState(0)
  const [bubble, setBubble] = useState<string | null>(null)

  // 跟踪上一次用户活动时间
  const lastActivityRef = useRef<number>(Date.now())
  // 跟踪上一次 isStreaming 值，检测 working → idle 转换
  const wasStreamingRef = useRef(false)
  // 气泡定时器
  const bubbleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 闲聊定时器
  const chatTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 帧时间累加器
  const frameElapsedRef = useRef(0)

  // ─── 显示气泡 ───
  const showBubble = useCallback((dialogue: SpiritDialogue) => {
    // 清除已有气泡
    if (bubbleTimerRef.current) clearTimeout(bubbleTimerRef.current)
    setBubble(dialogue.text)
    bubbleTimerRef.current = setTimeout(() => {
      setBubble(null)
      bubbleTimerRef.current = null
    }, dialogue.duration)
  }, [])

  // ─── 状态决策（每次 render 同步计算） ───
  useEffect(() => {
    const now = Date.now()

    // working → idle 转换：触发完成对话
    if (wasStreamingRef.current && !isStreaming) {
      showBubble(pickRandom(DONE_DIALOGUES))
      lastActivityRef.current = now
    }
    wasStreamingRef.current = isStreaming

    if (isStreaming) {
      setBaseState('working')
      lastActivityRef.current = now
      return
    }

    // alert 条件
    if (contextPercent >= 70) {
      setBaseState('alert')
      return
    }
    if (totalCost >= 10) {
      // 费用 alert 不覆盖 sleeping
      const inactive = now - lastActivityRef.current
      if (inactive < INACTIVE_THRESHOLD) {
        setBaseState('alert')
        return
      }
    }

    // sleeping 检测
    const inactive = now - lastActivityRef.current
    if (inactive >= INACTIVE_THRESHOLD) {
      setBaseState('sleeping')
      return
    }

    setBaseState('idle')
  }, [isStreaming, contextPercent, totalCost, showBubble])

  // ─── 活动追踪：messages 变化时更新 ───
  useEffect(() => {
    // 每次 options 变化视为"有活动"
    lastActivityRef.current = Date.now()
  }, [isStreaming])

  // ─── 帧动画 ───
  useEffect(() => {
    const effectiveState = bubble ? 'talking' : baseState
    const frames = SPIRIT_FRAMES[effectiveState]

    const timer = setInterval(() => {
      frameElapsedRef.current += FRAME_TICK
      const currentFrame = frames[frameIndex % frames.length]!
      if (frameElapsedRef.current >= currentFrame.duration) {
        frameElapsedRef.current = 0
        setFrameIndex(prev => (prev + 1) % frames.length)
      }
    }, FRAME_TICK)

    return () => clearInterval(timer)
  }, [baseState, bubble, frameIndex])

  // 状态切换时重置帧
  useEffect(() => {
    setFrameIndex(0)
    frameElapsedRef.current = 0
  }, [baseState, bubble])

  // ─── 定时闲聊 ───
  useEffect(() => {
    function scheduleChat() {
      chatTimerRef.current = setTimeout(() => {
        // 只在 idle 或 sleeping 时闲聊
        const now = Date.now()
        const inactive = now - lastActivityRef.current

        if (inactive >= INACTIVE_THRESHOLD) {
          // 快要睡了 / 已经睡了
          showBubble(pickRandom(INACTIVE_DIALOGUES))
        } else if (contextPercent >= 70) {
          showBubble(pickRandom(CONTEXT_DIALOGUES))
        } else if (totalCost >= 10) {
          showBubble(pickRandom(COST_DIALOGUES))
        } else {
          showBubble(pickRandom(IDLE_DIALOGUES))
        }

        scheduleChat()
      }, randomInterval())
    }

    scheduleChat()

    return () => {
      if (chatTimerRef.current) clearTimeout(chatTimerRef.current)
    }
  }, [contextPercent, totalCost, showBubble])

  // ─── 无操作检测定时器 ───
  useEffect(() => {
    const timer = setInterval(() => {
      const inactive = Date.now() - lastActivityRef.current
      if (inactive >= INACTIVE_THRESHOLD && baseState !== 'sleeping') {
        setBaseState('sleeping')
        showBubble(pickRandom(INACTIVE_DIALOGUES))
      }
    }, 30_000) // 每 30 秒检查一次

    return () => clearInterval(timer)
  }, [baseState, showBubble])

  // ─── 自进化 review 完成通知 ───
  useEffect(() => {
    const unsubscribe = onSpiritEvent((payload) => {
      if (payload.type === 'review_done') {
        showBubble(pickRandom(LEARNED_DIALOGUES))
      }
    })
    return unsubscribe
  }, [showBubble])

  // ─── 输出 ───
  const effectiveState = bubble ? 'talking' : baseState
  const frames = SPIRIT_FRAMES[effectiveState]
  const currentArt = frames[frameIndex % frames.length]?.art ?? '(•ᴗ•)'

  return {
    state: effectiveState,
    frame: currentArt,
    bubble,
  }
}
