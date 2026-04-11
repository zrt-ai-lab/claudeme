# ClaudeMe 开发指南

## 项目结构

```
src/
├── bootstrap-entry.ts    # 启动入口
├── main.tsx              # 主应用
├── commands/             # 命令（/model, /init, /cost 等）
├── components/           # UI 组件
├── services/             # 核心服务（API client, MCP, analytics）
│   └── api/
│       ├── client.ts           # API 客户端（自动路由 Anthropic/OpenAI）
│       ├── openaiAdapter.ts    # OpenAI Compatible 适配器
│       └── openaiStreamAdapter.ts  # OpenAI 流式适配器
├── tools/                # 工具（FileRead, Bash, WebFetch 等）
├── utils/
│   ├── claudemeConfig.ts # claudeme.json 配置管理
│   └── model/            # 模型相关
├── skills/               # 内置 Skills
├── hooks/                # React Hooks
└── screens/              # 页面
shims/                    # 本地包 shim（替代原生私有包）
vendor/                   # 第三方 vendor 源码
```

## 核心配置

`claudeme.json`（项目根目录，已 gitignore）：
- 定义所有可用模型
- 支持任意 OpenAI Compatible API
- api_key 支持 `$ENV_VAR` 环境变量引用
- 参考 `claudeme.example.json` 创建

## 开发命令

```bash
bun install          # 安装依赖
bun run dev          # 启动开发
bun run start        # 同上
bun run version      # 打印版本号
```

## 代码风格

- TypeScript + ESM + react-jsx
- 不加分号，单引号
- 变量/函数：camelCase
- React 组件/类：PascalCase
- 命令目录：kebab-case（如 `src/commands/install-slack-app/`）
- 保持小模块，避免大文件

## Commit 规范

简短祈使句，例如：
- `ClaudeMe v1.0.1 修复模型切换问题`
- `新增 DeepSeek 模型支持`

## 测试

启动后手动验证：
- `bun run dev` 能正常启动
- `bun run version` 输出版本号
- 验证修改涉及的功能路径
