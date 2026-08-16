# Notebook Knowledge Studio

NotebookLM 式本地知识工作台,以双层 Cordis 插件形式运行于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh) Web UI:

**Notebook → Sources → Chat → Studio**

- **Sources**:本地文件 / URL(抓取并提取正文)/ 粘贴文本 / 网页搜索发现;内容 hash 去重(update / anyway 策略);Web 来源可 Refresh
- **Chat**:BM25 检索(中文二元分词)+ LLM 生成,回答带 `[n]` 引用,点引用打开来源抽屉并高亮引文;证据不足时明确说明,不杜撰
- **Studio**:思维导图 / 报告(BLUF·学习指南·FAQ·时间线等)/ 闪卡 / 测验 / 信息图 / 幻灯 / 数据表格(MD+CSV),按量化规范产出并带 provenance
- **知识存储**:OKF v0.2 Markdown,local-first、可整体迁移;检索索引只是可重建缓存
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

## 运行环境依赖

| 依赖 | 用途 | 缺失时的行为 |
|---|---|---|
| dsh web profile | 宿主:tools/webServer/llm/web 服务 | 无法运行 |
| LLM 路由(如 deepseek-official) | 问答与 Studio 生成质量 | 自动降级:抽取式回答/模板产物 |
| dsh web 服务(ctx.web) | URL 导入、网页搜索 | 相关操作报错,其余正常 |
| Qwen-MM-Plugins MCP | 多模态来源转写 | 停在待转写状态,不影响其他功能 |
| pnpm | 插件安装(`dsh plugin add` 转发) | 无法安装;已装插件不受影响 |

## 开发

```bash
npm test              # 23 个单元/集成测试(node --test)
node scripts/e2e.mjs  # API 端到端验收(需 dsh web 已启动)
```

- host 半(`lib/*.mjs` + `lib/index.js`):零外部包导入,tools + HTTP API
- client 半(`lib/client.js`):纯 DOM,`__ModuleLoader__` 工厂格式,无构建链

License: MIT
