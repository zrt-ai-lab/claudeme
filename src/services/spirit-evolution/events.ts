/**
 * 镜像精灵 — 自进化事件总线
 *
 * 用于 postTurnReview 完成后通知精灵组件显示气泡。
 * 简单的 EventEmitter 模式。
 */

type SpiritEventType = 'review_done' | 'review_skipped'

interface ReviewDonePayload {
  readonly type: 'review_done'
  readonly insightCount: number
  readonly skillCount: number
  readonly pitfallCount: number
}

interface ReviewSkippedPayload {
  readonly type: 'review_skipped'
  readonly reason: string
}

type SpiritEventPayload = ReviewDonePayload | ReviewSkippedPayload

type SpiritEventListener = (payload: SpiritEventPayload) => void

const listeners: SpiritEventListener[] = []

export function onSpiritEvent(listener: SpiritEventListener): () => void {
  listeners.push(listener)
  return () => {
    const idx = listeners.indexOf(listener)
    if (idx >= 0) listeners.splice(idx, 1)
  }
}

export function emitSpiritEvent(payload: SpiritEventPayload): void {
  for (const listener of listeners) {
    try {
      listener(payload)
    } catch {
      // 静默
    }
  }
}
