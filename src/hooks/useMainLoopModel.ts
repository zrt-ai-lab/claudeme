import { useEffect, useReducer } from 'react'
import { onGrowthBookRefresh } from '../services/analytics/growthbook.js'
import { useAppState } from '../state/AppState.js'
import * as claudemeConfig from '../utils/claudemeConfig.js'
import {
  getDefaultMainLoopModelSetting,
  type ModelName,
  parseUserSpecifiedModel,
} from '../utils/model/model.js'

// The value of the selector is a full model name that can be used directly in
// API calls. Use this over getMainLoopModel() when the component needs to
// update upon a model config change.
export function useMainLoopModel(): ModelName {
  const mainLoopModel = useAppState(s => s.mainLoopModel)
  const mainLoopModelForSession = useAppState(s => s.mainLoopModelForSession)

  const [, forceRerender] = useReducer(x => x + 1, 0)
  useEffect(() => onGrowthBookRefresh(forceRerender), [])

  // ─── ClaudeMe: 直接用 claudeme key，不走 Anthropic alias 解析 ───
  if (claudemeConfig.hasClaudemeConfig()) {
    return mainLoopModelForSession ?? mainLoopModel ?? claudemeConfig.getCurrentModelKey()
  }
  // ─── End ClaudeMe ───

  const model = parseUserSpecifiedModel(
    mainLoopModelForSession ??
      mainLoopModel ??
      getDefaultMainLoopModelSetting(),
  )
  return model
}
