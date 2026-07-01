// Wiki Lab — 读取 claudeme.json 提取 LLM 配置

import { readFileSync } from 'fs'
import { join, resolve } from 'path'
import type { LLMConfig } from './types.js'

interface ProviderModelEntry {
  readonly name: string
  readonly model: string
  readonly max_tokens: number
  readonly api_base?: string
  readonly api_key?: string
}

interface ProviderConfig {
  readonly name: string
  readonly api_base: string
  readonly api_key: string
  readonly models: Record<string, ProviderModelEntry>
}

interface ClaudemeConfigFile {
  readonly default: string
  readonly providers: Record<string, ProviderConfig>
}

function resolveEnvVar(value: string): string {
  if (value.startsWith('$')) {
    const envKey = value.slice(1)
    const envVal = process.env[envKey]
    if (!envVal) {
      throw new Error(`环境变量 ${envKey} 未设置（claudeme.json 引用了 $${envKey}）`)
    }
    return envVal
  }
  return value
}

function findClaudemeJson(): string {
  // 从当前目录往上找 claudeme.json
  let dir = process.cwd()
  for (let i = 0; i < 10; i++) {
    const candidate = join(dir, 'claudeme.json')
    try {
      readFileSync(candidate, 'utf-8')
      return candidate
    } catch {
      // 继续往上
    }
    const parent = resolve(dir, '..')
    if (parent === dir) break
    dir = parent
  }
  // 兜底：相对于 wiki-lab 目录的位置
  return join(process.cwd(), '..', '..', 'claudeme.json')
}

export function loadLLMConfig(): LLMConfig {
  const configPath = findClaudemeJson()

  let raw: string
  try {
    raw = readFileSync(configPath, 'utf-8')
  } catch {
    throw new Error(`找不到 claudeme.json: ${configPath}`)
  }

  const config: ClaudemeConfigFile = JSON.parse(raw)

  if (!config.providers || !config.default) {
    throw new Error('claudeme.json 格式错误：需要 providers 和 default 字段')
  }

  // 解析 default 的 provider/model 复合 key
  const slashIdx = config.default.indexOf('/')
  if (slashIdx === -1) {
    throw new Error(`default "${config.default}" 格式错误，应为 "provider/model"`)
  }

  const providerKey = config.default.slice(0, slashIdx)
  const modelKey = config.default.slice(slashIdx + 1)

  const provider = config.providers[providerKey]
  if (!provider) {
    throw new Error(`provider "${providerKey}" 不存在`)
  }

  const model = provider.models[modelKey]
  if (!model) {
    throw new Error(`model "${modelKey}" 在 provider "${providerKey}" 中不存在`)
  }

  const apiBase = model.api_base ?? provider.api_base
  const apiKey = resolveEnvVar(model.api_key ?? provider.api_key)

  return {
    apiBase: apiBase.replace(/\/$/, ''),
    apiKey,
    model: model.model,
    maxTokens: model.max_tokens,
  }
}
