# Notebook Knowledge Studio

NotebookLM 式本地知识工作台,以双层 Cordis 插件形式运行于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh) Web UI:

**Notebook → Sources → Chat → Studio**

- **Sources**:本地文件 / URL(抓取并提取正文)/ 粘贴文本 / 网页搜索发现;内容 hash 去重(update / anyway 策略);Web 来源可 Refresh
- **Chat**:BM25 检索(中文二元分词)+ LLM 生成,回答带 `[n]` 引用,点引用打开来源抽屉并高亮引文;证据不足时明确说明,不杜撰
- **Studio**:思维导图 / 报告(BLUF·学习指南·FAQ·时间线等)/ 闪卡 / 测验 / 信息图 / 幻灯 / 数据表格(MD+CSV),按量化规范产出并带 provenance
- **知识存储**:OKF v0.2 Markdown,local-first、可整体迁移;检索索引只是可重建缓存
- **会话隔离**:每个 Harness 对话独立激活 Notebook,状态持久化于知识库 `.state/active-notebooks.json`;新建及 fork 对话默认不激活
- **多模态**:图片/音视频/PDF 来源自动标记待转写,由已挂载的 [Qwen-MM-Plugins](https://github.com/QwenLM/Qwen-MM-Plugins) MCP 处理后写回;未检测到时如实降级,不伪造
- **UI**:主界面 `conversation.view` 视图标签;三栏可拖宽(键盘 ←/→ 可调,宽度记忆);窄容器自动堆叠

## 安装

```bash
dsh plugin --profile web add <本仓库路径或 github:用户名/仓库名>
```

> 已知问题:Windows 下 `dsh plugin add` 对含空格的路径会拆断。绕过:在
> `~/.dsh/profiles/web` 目录直接 `pnpm add "<绝对路径>"`,再把包名
> `dsh-notebook-knowledge-studio` 追加进该目录 package.json 的
> `dsh.profile.bundles` 数组。

数据根目录由本仓库 `cordis.patch.yml` 的 `root` 配置指定,改为你的工作区路径即可。
Notebook 内部 source、Studio 产物、asset 和 cache 均限制在各自 Notebook 目录内；
路径穿越、绝对路径、符号链接和 Windows junction 跨库访问会以
`NOTEBOOK_PATH_BLOCKED` 拒绝。用户显式选择的外部本地文件导入不受此边界影响。

插件固定使用与当前 Harness 匹配的
`@deepseek-ai/dsh-web-fetch-http@0.1.0-rc.6`。从 npm/GitHub 安装插件时该依赖会自动安装；
使用本地 `link:` 开发安装时，请在 Web profile 目录显式安装依赖并重启 DSH：

```powershell
Set-Location "$env:USERPROFILE\.dsh\profiles\web"
pnpm add @deepseek-ai/dsh-web-fetch-http@0.1.0-rc.6
npx @deepseek-ai/dsh web
```

### 网页抓取边界

- 所有预览、URL 导入、批量导入和 Refresh 只允许无凭据的公网 `http:` / `https:` URL。
- `localhost`、本机/内网/链路本地/云元数据/保留地址，以及解析结果中混有非公网 IP 的域名，会在发起抓取前被拒绝。
- 官方 HTTP provider 只跟随同源重定向，并限制超时、响应大小与正文长度。
- provider 不执行浏览器 JavaScript；需要登录、付费墙、反爬验证或重度客户端渲染的页面可能无法提取，并会返回明确失败原因。
- 该 provider 仅服务 Notebook 来源抓取，不会启用面向模型的通用 `web_fetch` 工具。

## 运行环境依赖

| 依赖 | 用途 | 缺失时的行为 |
|---|---|---|
| dsh web profile | 宿主:tools/webServer/llm/web 服务 | 无法运行 |
| LLM 路由(如 deepseek-official) | 问答与 Studio 生成质量 | 自动降级:抽取式回答/模板产物 |
| dsh web 服务(ctx.web) | URL 导入、Refresh、网页搜索 | 相关操作返回明确错误,其余正常 |
| @deepseek-ai/dsh-web-fetch-http 0.1.0-rc.6 | 网页预览与正文抓取 | 抓取操作返回 503；搜索仍可独立使用 |
| Qwen-MM-Plugins MCP | 多模态来源转写 | 停在待转写状态,不影响其他功能 |
| pnpm | 插件安装(`dsh plugin add` 转发) | 无法安装;已装插件不受影响 |

## 开发

```bash
npm test              # 单元/集成测试(node --test)
node scripts/e2e.mjs  # API 端到端验收(需 dsh web 已启动)
```

- host 半(`lib/*.mjs` + `lib/index.js`):零外部包导入,tools + HTTP API
- client 半(`lib/client.js`):纯 DOM,`__ModuleLoader__` 工厂格式,无构建链

License: MIT
