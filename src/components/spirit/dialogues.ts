/**
 * 镜像精灵 — 对话库
 *
 * 按触发条件分类的对话内容。
 * 实用 + 卖萌风格。
 */

export interface SpiritDialogue {
  readonly text: string
  readonly duration: number // 气泡显示时长（毫秒）
}

// ─── 随机闲聊（idle 状态触发） ───

export const IDLE_DIALOGUES: readonly SpiritDialogue[] = [
  { text: '写代码累了吧～歇歇?', duration: 4000 },
  { text: '我在呢，有啥吩咐?', duration: 3500 },
  { text: '今天状态不错哦', duration: 3000 },
  { text: '需要我帮你想想?', duration: 3500 },
  { text: '安静写码的时光最好了', duration: 4000 },
  { text: '摸鱼5分钟不过分吧', duration: 3500 },
  { text: '你是我见过最帅的程序员', duration: 4000 },
  { text: '代码如诗，bug如梦', duration: 3500 },
  { text: '又在创造世界了?', duration: 3000 },
  { text: '我帮你盯着终端呢', duration: 3500 },
  { text: '来杯咖啡续命?', duration: 3000 },
  { text: '键盘敲得真好听', duration: 3000 },
]

// ─── 费用提醒（cost 阈值触发） ───

export const COST_DIALOGUES: readonly SpiritDialogue[] = [
  { text: '钱包在哭泣...省着点?', duration: 4500 },
  { text: '烧钱速度有点快哦', duration: 4000 },
  { text: '要不换个便宜模型?', duration: 4000 },
  { text: '今日消费有点猛', duration: 3500 },
]

// ─── 上下文满提醒（context 阈值触发） ───

export const CONTEXT_DIALOGUES: readonly SpiritDialogue[] = [
  { text: '上下文快满了，compact?', duration: 4500 },
  { text: '脑子快装不下了!', duration: 4000 },
  { text: '记忆快溢出了...', duration: 4000 },
  { text: '该 /compact 清理下了', duration: 4500 },
]

// ─── 长时间无操作（sleeping 前触发） ───

export const INACTIVE_DIALOGUES: readonly SpiritDialogue[] = [
  { text: '还在吗? 我要睡了哦', duration: 4000 },
  { text: '好安静...去吃饭了?', duration: 4000 },
  { text: '等你回来~', duration: 3500 },
  { text: '我先打个盹...', duration: 3500 },
]

// ─── 工作完成（working → idle 切换时） ───

export const DONE_DIALOGUES: readonly SpiritDialogue[] = [
  { text: '搞定!', duration: 2500 },
  { text: '完事儿了~', duration: 2500 },
  { text: '下一个任务是啥?', duration: 3000 },
  { text: '漂亮，一把过!', duration: 3000 },
  { text: '又解决一个!', duration: 2500 },
]

/** 从数组中随机选一个 */
export function pickRandom<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!
}
