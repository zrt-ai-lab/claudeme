// Wiki 知识库 — 本地文件适配器

import { readFileSync, existsSync } from 'fs'
import { basename } from 'path'
import type { WikiSourceAdapter, RawContent } from './types.js'

export const localAdapter: WikiSourceAdapter = {
  type: 'local',

  canHandle(source: string): boolean {
    return !source.startsWith('http://') && !source.startsWith('https://')
  },

  async read(source: string): Promise<RawContent> {
    if (!existsSync(source)) {
      throw new Error(`文件不存在: ${source}`)
    }

    const content = readFileSync(source, 'utf-8')
    const title = basename(source, '.md').replace(/[-_]/g, ' ')

    return { content, title, sourceUrl: source }
  },
}
