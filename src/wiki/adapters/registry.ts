// Wiki 知识库 — 适配器注册表

import type { WikiSourceAdapter, RawContent } from './types.js'
import { localAdapter } from './local.js'
import { urlAdapter } from './url.js'

const adapters: WikiSourceAdapter[] = [
  urlAdapter, // URL 优先匹配
  localAdapter, // 兜底
]

export function getAdapter(source: string): WikiSourceAdapter {
  const adapter = adapters.find(a => a.canHandle(source))
  if (!adapter) {
    throw new Error(`没有适配器可以处理: ${source}`)
  }
  return adapter
}

export async function readSource(source: string): Promise<RawContent> {
  const adapter = getAdapter(source)
  return adapter.read(source)
}

export type { WikiSourceAdapter, RawContent }
