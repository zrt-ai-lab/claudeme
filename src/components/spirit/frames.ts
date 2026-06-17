/**
 * 镜像精灵 — ASCII 帧动画定义
 *
 * 每个状态对应一组帧，定时切换实现动画效果。
 * 帧数组按顺序循环播放。
 */

export type SpiritState =
  | 'idle'      // 待机呼吸
  | 'working'   // AI 生成中
  | 'talking'   // 说话中（显示气泡）
  | 'sleeping'  // 长时间无输入
  | 'alert'     // 费用高 / 上下文满

export interface SpiritFrame {
  readonly art: string
  readonly duration: number // 毫秒，该帧持续时长
}

// ─── 帧定义 ───

const idle: readonly SpiritFrame[] = [
  { art: '(•ᴗ•)', duration: 1200 },
  { art: '(•ᴗ•) ', duration: 800 },
  { art: '(•‿•)', duration: 1200 },
  { art: '(•ᴗ•) ', duration: 800 },
]

const working: readonly SpiritFrame[] = [
  { art: '(•̀ᴗ•́)⌨', duration: 300 },
  { art: '(•̀ᴗ•́) ⌨', duration: 300 },
  { art: '(•̀ᴗ•́)⌨ ', duration: 300 },
  { art: '(•̀ᴗ•́) ⌨', duration: 300 },
]

const talking: readonly SpiritFrame[] = [
  { art: '(•ᴗ•)ノ', duration: 600 },
  { art: '(•ᴗ•)/', duration: 600 },
]

const sleeping: readonly SpiritFrame[] = [
  { art: '(˘ᴗ˘ )z', duration: 1500 },
  { art: '(˘ᴗ˘ )zZ', duration: 1500 },
  { art: '(˘ᴗ˘ )zZZ', duration: 1500 },
  { art: '(˘ᴗ˘ )zZ', duration: 1500 },
]

const alert: readonly SpiritFrame[] = [
  { art: '(°△°)!', duration: 500 },
  { art: '(°△° )!', duration: 500 },
  { art: '(°△°)! ', duration: 500 },
  { art: '(°△° )!', duration: 500 },
]

export const SPIRIT_FRAMES: Record<SpiritState, readonly SpiritFrame[]> = {
  idle,
  working,
  talking,
  sleeping,
  alert,
}

/** 每个状态对应的精灵颜色 */
export const SPIRIT_COLORS: Record<SpiritState, string> = {
  idle: 'ansi:cyan',
  working: 'ansi:yellow',
  talking: 'ansi:green',
  sleeping: 'ansi:blue',
  alert: 'ansi:red',
}
