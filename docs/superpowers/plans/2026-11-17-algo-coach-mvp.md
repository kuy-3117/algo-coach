# 算法学习教练 MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个可本地运行、能自动排题、记录手写总结并展示进度的零依赖 MVP。

**Architecture:** `algo.js` 提供可独立测试的纯函数；`server.js` 负责 HTTP、写权限、JSON 原子持久化和备份；`public/` 使用原生 JavaScript 渲染两个 tab。所有学习状态从只追加事件流重算。

**Tech Stack:** Node.js 18+ 内置模块、原生 HTML/CSS/JavaScript、JSON 文件、`node:test`/`node:assert` 测试方式。

**Spec:** `docs/superpowers/specs/2026-11-17-algo-coach-mvp-design.md`

## Global Constraints

- 禁止任何 npm 依赖、构建步骤、数据库、爬虫、判题器、账号和 LLM 调用。
- 端口固定为 `8787`，监听 `0.0.0.0`，启动时打印本机与所有内网 IPv4 URL。
- 日期一律使用本地时区 `YYYY-MM-DD`。
- 写接口只允许回环地址；其他局域网客户端只读。
- `data.json` 只追加事件，派生状态永不落盘。
- 手写总结必填并原样保存。
- 每条推荐必须返回中文理由。
- 写入顺序必须是旧文件备份、临时文件、原子重命名。
- UI 全中文，颜色、宽度和移动端规则遵循需求。

### Task 1: 算法纯函数与测试

**Files:**
- Create: `test.js`
- Create: `algo.js`
- Create: `data/config.json`

**Interfaces:**
- Produces: `addDays(date, days)`, `daysBetween(from, to)`, `deriveState(events, problems, config, today)`, `computeStats(events, problems, config, today)`, `buildToday(input)`, `scoreProblem(problem, ps, ts, config, events, today)`.

- [ ] 写状态重算测试，断言失败、正解、通过率和知识点水平。
- [ ] 运行 `node test.js`，确认因 `algo.js` 不存在而失败。
- [ ] 实现日期、状态重算和统计纯函数，测试通过。
- [ ] 写排题测试，覆盖复习优先、`box0` 必做、三题上限、理由和预算。
- [ ] 实现打分与排题，测试通过。
- [ ] 写连续天数、临时题和换题降权测试，补齐实现并保持全绿。

### Task 2: 服务端与持久化

**Files:**
- Create: `server.js`
- Test: `test.js`

**Interfaces:**
- Consumes: `algo.js` 导出的纯函数。
- Produces: `createAppServer(options)`, `ensureDataFiles(rootDir)`, `appendEvent(rootDir, event)`, `readJson(path)`, `atomicWriteJson(path, value)`.

- [ ] 写缺失数据自愈、原子写入、备份轮转和本机写入限制测试。
- [ ] 运行测试确认失败。
- [ ] 实现数据初始化、安全 JSON 校验、原子写入和五份轮转备份。
- [ ] 实现五个 POST API、状态聚合和导出 API，测试通过。
- [ ] 启动服务，用 HTTP 自测静态文件、状态、记录、预算、换题和配置。

### Task 3: 今日页与记录闭环

**Files:**
- Create: `public/index.html`
- Create: `public/app.js`
- Create: `public/style.css`

**Interfaces:**
- Consumes: `/api/state` 的 `{ ok, config, today, stats, recent, plan, readOnly }`。
- Produces: 今天页、预算编辑、题目卡、记录弹窗、换题和临时题交互。

- [ ] 建立可访问的深色单页骨架和两个 tab。
- [ ] 渲染预算、连续天数、推荐卡与中文理由。
- [ ] 实现强制总结的记录弹窗并提交 `/api/record`。
- [ ] 实现预算、换题和临时题交互。
- [ ] 手动验证保存后事件追加和页面刷新不丢数据。

### Task 4: 进度视图与响应式

**Files:**
- Modify: `public/app.js`
- Modify: `public/style.css`

**Interfaces:**
- Consumes: `stats.heatmap`, `stats.tagStats`, `recent`。

- [ ] 渲染四张统计卡和最近 12 周热力图。
- [ ] 渲染知识点表与最近记录展开。
- [ ] 实现 `< 600px` 单列和全宽按钮，检查无横向滚动。
- [ ] 验证局域网访问时页面显示只读提示且写按钮禁用。

### Task 5: 内置题单与交付文档

**Files:**
- Create: `data/problems.json`
- Create: `data/data.json`
- Create: `README.md`
- Create: `.gitignore`

**Interfaces:**
- Consumes: 中文标签必须与 `config.scopeTags` 完全一致。
- Produces: 30 道可核验题目、零事件初始数据、运行与验收文档。

- [ ] 编写 30 道题，覆盖至少 15 个标签，难度约 1/2/3 各 10 道。
- [ ] 核验具体题号链接；不确定时使用官方搜索页。
- [ ] 写明启动、数据位置、备份、加题、配置和局域网风险。
- [ ] 执行 `node test.js` 和完整 HTTP/浏览器验收。
- [ ] 清点文件树，确认无依赖、无构建产物、无临时测试数据。
