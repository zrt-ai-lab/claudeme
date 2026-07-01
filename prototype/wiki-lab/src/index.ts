#!/usr/bin/env bun
// Wiki Lab — CLI 入口

import { existsSync, readdirSync } from 'fs'
import { ingest } from './ingest.js'
import { query } from './query.js'
import { lint } from './lint.js'
import { readIndex } from './index-manager.js'
import { ensureWikiDirs, getWikiDir, setWikiDir } from './paths.js'

const HELP = `
Wiki Lab — LLM 知识库原型

用法:
  bun run src/index.ts ingest <url|path>   导入素材到知识库
  bun run src/index.ts query "问题"         从知识库查询
  bun run src/index.ts lint                 知识库健康检查
  bun run src/index.ts status              查看知识库状态

选项:
  --wiki-dir <path>   指定 wiki 目录（默认 ./test-wiki/）

示例:
  bun run src/index.ts ingest https://example.com/article
  bun run src/index.ts ingest ~/notes/my-note.md
  bun run src/index.ts query "什么是 LLM Wiki？"
  bun run src/index.ts lint
`.trim()

async function main() {
  const args = process.argv.slice(2)

  // 解析 --wiki-dir
  const wikiDirIdx = args.indexOf('--wiki-dir')
  if (wikiDirIdx !== -1 && args[wikiDirIdx + 1]) {
    setWikiDir(args[wikiDirIdx + 1])
    args.splice(wikiDirIdx, 2)
  }

  const command = args[0]
  const arg = args.slice(1).join(' ')

  if (!command || command === '--help' || command === '-h') {
    console.log(HELP)
    process.exit(0)
  }

  switch (command) {
    case 'ingest': {
      if (!arg) {
        console.error('❌ 请指定素材来源（URL 或文件路径）')
        process.exit(1)
      }

      console.log(`\n🚀 Wiki Ingest`)
      console.log(`─────────────────────`)

      try {
        const result = await ingest(arg)

        console.log(`\n─────────────────────`)
        if (result.status === 'duplicate') {
          console.log(`⏭️  素材已存在，跳过`)
        } else if (result.status === 'ok') {
          console.log(`✅ 完成：新建 ${result.pagesCreated} 页，更新 ${result.pagesUpdated} 页`)
        } else {
          console.error(`❌ 失败: ${result.error}`)
        }
      } catch (err) {
        console.error(`\n❌ Ingest 失败:`, err instanceof Error ? err.message : err)
        process.exit(1)
      }
      break
    }

    case 'query': {
      if (!arg) {
        console.error('❌ 请输入问题')
        process.exit(1)
      }

      console.log(`\n🔍 Wiki Query`)
      console.log(`─────────────────────`)

      try {
        const result = await query(arg)

        console.log(`\n─────────────────────`)
        console.log(`\n${result.answer}`)

        if (result.pagesUsed.length > 0) {
          console.log(`\n📎 引用页面:`)
          for (const page of result.pagesUsed) {
            console.log(`   - ${page}`)
          }
        }
      } catch (err) {
        console.error(`\n❌ Query 失败:`, err instanceof Error ? err.message : err)
        process.exit(1)
      }
      break
    }

    case 'lint': {
      console.log(`\n🏥 Wiki Lint`)
      console.log(`─────────────────────`)

      try {
        const result = await lint()
        console.log(`\n${result.summary}`)
      } catch (err) {
        console.error(`\n❌ Lint 失败:`, err instanceof Error ? err.message : err)
        process.exit(1)
      }
      break
    }

    case 'status': {
      ensureWikiDirs()
      const wikiDir = getWikiDir()
      const index = readIndex()

      console.log(`\n📊 Wiki Status`)
      console.log(`─────────────────────`)
      console.log(`📁 目录: ${wikiDir}`)
      console.log(`📄 索引条目: ${index.length}`)

      // 统计各类型页面
      const entityCount = index.filter(e => e.type === 'entity').length
      const topicCount = index.filter(e => e.type === 'topic').length
      const sourceCount = index.filter(e => e.type === 'source').length
      const synthesisCount = index.filter(e => e.type === 'synthesis').length

      console.log(`   实体: ${entityCount}`)
      console.log(`   主题: ${topicCount}`)
      console.log(`   素材摘要: ${sourceCount}`)
      console.log(`   综合分析: ${synthesisCount}`)

      // raw 素材数
      const rawDir = `${wikiDir}/raw/articles`
      if (existsSync(rawDir)) {
        const rawCount = readdirSync(rawDir).filter(f => f.endsWith('.md')).length
        console.log(`📦 原始素材: ${rawCount}`)
      }

      if (index.length > 0) {
        console.log(`\n最近的条目:`)
        for (const entry of index.slice(0, 5)) {
          console.log(`   [${entry.type}] ${entry.title} — ${entry.summary.slice(0, 50)}`)
        }
      }

      break
    }

    default:
      console.error(`❌ 未知命令: ${command}`)
      console.log(HELP)
      process.exit(1)
  }
}

main()
