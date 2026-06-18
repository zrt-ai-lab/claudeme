/**
 * 镜像精灵 — 自进化模块入口
 *
 * 初始化 + 导出。
 * 在 backgroundHousekeeping 中调用 initSpiritEvolution()。
 */

export { initSpiritStore, readSnapshot, readUsage } from './spiritStore.js'
export { executePostTurnReview } from './postTurnReview.js'
export { shouldRunReview, markReviewDone } from './gating.js'
export { getSpiritSystemPromptSection, onSessionStart, getStartupBubble } from './sessionRecall.js'
export { onSpiritEvent, emitSpiritEvent } from './events.js'

import { initSpiritStore } from './spiritStore.js'
import { logError } from '../../utils/log.js'

/** 初始化自进化系统（在 backgroundHousekeeping 中调用） */
export function initSpiritEvolution(): void {
  try {
    initSpiritStore()
  } catch (error) {
    logError(error)
  }
}
