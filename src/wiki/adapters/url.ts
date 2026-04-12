// Wiki 知识库 — URL 适配器

import TurndownService from 'turndown'
import type { WikiSourceAdapter, RawContent } from './types.js'

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
})

export const urlAdapter: WikiSourceAdapter = {
  type: 'url',

  canHandle(source: string): boolean {
    return source.startsWith('http://') || source.startsWith('https://')
  },

  async read(source: string): Promise<RawContent> {
    const response = await fetch(source, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(30_000),
    })

    if (!response.ok) {
      throw new Error(`抓取失败: ${response.status} ${response.statusText} (${source})`)
    }

    const html = await response.text()

    // 提取 <title>
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i)
    const title = titleMatch?.[1]?.trim() ?? new URL(source).hostname

    // HTML → Markdown
    const markdown = turndown.turndown(html)

    // 清理过短的内容（可能是反爬页面）
    if (markdown.length < 100) {
      throw new Error(`抓取内容过短（${markdown.length} 字符），可能被反爬拦截: ${source}`)
    }

    return { content: markdown, title, sourceUrl: source }
  },
}
