# ClaudeMe

> 基于 Claude Code 迭代开发的终端 AI 编程助手，解绑官方 SDK，支持任意 OpenAI Compatible API。

![Preview](preview.png)

## 为什么做 ClaudeMe

Claude Code 很强，但：

- 🔒 **绑死官方 API** —— 必须用 Anthropic 账号，国内直连不了
- 🌐 **需要代理** —— 网络不稳定时体验极差
- 🇺🇸 **全英文交互** —— 对中文用户不够友好

**ClaudeMe 的目标：拥有 Claude Code 全部编程能力，同时做到——**

- ✅ **不限制** —— 解绑 Anthropic SDK，接任意 OpenAI Compatible API
- ✅ **不代理** —— 直连国内大模型平台，零延迟
- ✅ **随时随地都能用** —— 不依赖科学上网，开箱即用
- ✅ **中文交互** —— 界面、提示、Tips 全中文化
- ✅ **易用、好用、能用** —— 一个配置文件搞定多模型切换

## 核心特性

| 特性 | 说明 |
|------|------|
| 🔌 OpenAI Compatible | 支持任何兼容 OpenAI 格式的 API（智汇云、阿里云、火山引擎、Moonshot、DeepSeek…） |
| 🔄 多模型切换 | `/model` 命令一键切换，claudeme.json 配置所有模型 |
| 🛠️ 完整工具链 | 文件读写、Bash 执行、代码搜索、Web 搜索、MCP 服务器… |
| 🧠 Agent 能力 | 多 Agent 并行、子任务编排、Plan 模式、自动化工作流 |
| 📦 Skills 生态 | 内置丰富 Skills，支持自定义扩展 |
| 🎨 中文 UI | Spinner、Tips、提示信息全面中文化 |
| ⚡ 极速体验 | Bun 运行时，启动快、响应快 |

## 快速开始

### 环境要求

- [Bun](https://bun.sh) 1.3.5+
- Node.js 24+

### 安装

```bash
git clone git@github.com:zrt-ai-lab/claudeme.git
cd claudeme
bun install
```

### 配置

```bash
# 复制示例配置
cp claudeme.example.json claudeme.json

# 编辑 claudeme.json，填入你的 API Key
# 支持直接写 key 或用 $ENV_VAR 引用环境变量
```

配置示例：

```json
{
  "default": "my-model",
  "models": {
    "my-model": {
      "name": "我的模型",
      "api_base": "https://your-api-provider.com/v1",
      "api_key": "$CLAUDEME_API_KEY",
      "model": "your-model-name",
      "max_tokens": 32000,
      "capabilities": {
        "vision": true,
        "tool_calling": true
      }
    }
  }
}
```

### 运行

```bash
bun run dev
```

### 切换模型

在 ClaudeMe 内输入 `/model`，选择你配置的任意模型。

## 项目状态

🚀 **v1.0.0** —— 持续更新中

目标是让每个开发者都能用上顶级的 AI 编程终端，不受网络限制、不受平台绑定。

## License

MIT
