/**
 * 镜像精灵 — Session Recall
 *
 * 每次会话启动时，将 spirit 知识库的精华注入系统提示。
 * 使用冻结快照模式（写入在会话中立即生效到磁盘，
 * 但系统提示只在下次会话才更新 — 保护 prefix cache）。
 */

import { readSnapshot, readUsage, recordSession } from './spiritStore.js'

/** 注入到系统提示的 spirit 知识快照 */
export function getSpiritSystemPromptSection(): string {
  const snapshot = readSnapshot(2000)

  // 如果知识库是空的（只有标题没有内容），不注入
  const hasContent = snapshot.split('\n').some(line =>
    line.startsWith('- ') || line.startsWith('## '),
  )
  if (!hasContent) return ''

  return `
<spirit-knowledge>
以下是镜像精灵从历史对话中学到的知识。请参考这些信息来更好地服务用户：

${snapshot}
</spirit-knowledge>`
}

/** 会话启动时调用 — 记录会话并返回注入内容 */
export function onSessionStart(): string {
  recordSession()
  return getSpiritSystemPromptSection()
}

/** 获取精灵启动时的欢迎气泡内容 */
export function getStartupBubble(): string | null {
  const usage = readUsage()

  // 第一次使用
  if (usage.sessionCount <= 1) {
    return '初次见面！我会学习你的习惯~'
  }

  // 有学到东西
  const totalKnowledge = usage.insightCount + usage.skillCount + usage.pitfallCount
  if (totalKnowledge > 0 && usage.lastReviewAt) {
    const phrases = [
      `已积累 ${totalKnowledge} 条经验`,
      `学了 ${usage.insightCount} 个偏好、${usage.skillCount} 个技巧`,
      '上次学到的还记得~',
      `已经陪你 ${usage.sessionCount} 次了`,
    ]
    return phrases[Math.floor(Math.random() * phrases.length)]!
  }

  // 还没学到东西
  if (usage.sessionCount > 3) {
    return '多聊聊，我能学会你的习惯'
  }

  return null
}
