import { getInitialSettings } from '../utils/settings/settings.js'

export function getSpinnerVerbs(): string[] {
  const settings = getInitialSettings()
  const config = settings.spinnerVerbs
  if (!config) {
    return SPINNER_VERBS
  }
  if (config.mode === 'replace') {
    return config.verbs.length > 0 ? config.verbs : SPINNER_VERBS
  }
  return [...SPINNER_VERBS, ...config.verbs]
}

// ClaudeMe spinner 动词 —— 互联网系
export const SPINNER_VERBS = [
  '摸鱼中',
  '摆烂中',
  '躺平中',
  '内卷中',
  '社死中',
  '破防中',
  '上头中',
  '搬砖中',
  '加班中',
  '划水中',
  '摸鱼摸到大鲨鱼',
  '疯狂输出',
  'CPU 过热',
  '脑洞大开',
  '头秃中',
  '烧脑中',
  '上强度了',
  '原地起飞',
  '弹射起步',
  '极速狂飙',
  '满血复活',
  '涡轮增压',
  '超频中',
  '开大中',
  '放技能中',
  '暴走中',
  'YYDS',
  '绝绝子',
  '拿捏了',
  '稳了稳了',
  '安排上了',
  '冲冲冲',
  '盘它',
  '整活中',
  '搞事情中',
  '格局打开',
  '遥遥领先',
  '马上就好',
  '别催了别催',
  '快了快了',
  '别急嘛',
  '稍等亿下',
  '加载中请稍候',
  '正在憋大招',
  '蓄力中',
]
