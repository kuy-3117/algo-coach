# 目标画像与 AI 复盘 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有算法学习教练 MVP 上交付可编辑目标画像、时间规划书、DeepSeek 日报/周报、确认式选题、稳定换题、题库导入和本地导出。

**Architecture:** 算法继续集中在 `algo.js`；新增 `ai.js` 负责文本模型协议与输出校验，新增 `importer.js` 负责题库解析。服务端追加规划、报告、AI 和导入接口，前端扩展为四个 tab。

**Tech Stack:** Node.js 18+ 内置模块、原生 HTML/CSS/JavaScript、JSON 文件、DeepSeek OpenAI 兼容 Chat Completions。

**Spec:** `docs/superpowers/specs/2026-11-17-goal-ai-planner-design.md`

## Global Constraints

- 零 npm 依赖、无构建步骤、无数据库。
- 保留用户现有事件，不修改历史事件。
- API Key 只从环境变量读取，绝不落盘或导出。
- AI 只可从规则候选池选择，应用前必须确认。
- 周报最近 7 个自然日，至少 3 个活跃日。
- 题库只保存平台链接，不抓取题面、不执行题目。

### Task 1: 稳定排题与目标规划

**Files:**
- Modify: `algo.js`
- Modify: `test.js`

- [ ] 写确定性种子、今日计划事件、目标标签加权、时间规划书和周报门槛测试。
- [ ] 运行 `node test.js` 确认新增功能失败。
- [ ] 实现稳定排序、计划覆盖、画像评分、规划书和周期统计。
- [ ] 运行测试并保持全绿。

### Task 2: AI 与导入模块

**Files:**
- Create: `ai.js`
- Create: `importer.js`
- Modify: `test.js`

- [ ] 写 AI JSON 校验、超时/错误映射、CSV/JSON 导入和去重测试。
- [ ] 运行测试确认失败。
- [ ] 实现 DeepSeek Chat Completions、日报/周报/选题提示词与输出校验。
- [ ] 实现题库解析、规范化和去重。
- [ ] 运行测试并保持全绿。

### Task 3: 服务端 API 与持久化

**Files:**
- Modify: `server.js`
- Modify: `test.js`

- [ ] 写画像保存、规划书生成、报告追加、AI 选题应用、题库导入和本地导出测试。
- [ ] 实现 `plan.json`、`reports.json`、`problem-packs/`、`exports/` 的初始化与原子写入。
- [ ] 实现 AI、profile、plan、report、import、export 接口及本机写权限。
- [ ] 运行 HTTP 测试并保持全绿。

### Task 4: 暖色角色界面与四页交互

**Files:**
- Modify: `public/index.html`
- Modify: `public/style.css`
- Modify: `public/app.js`
- Create: `public/assets/` 本地素材

- [ ] 接入本地欢迎横幅和裁切头像，保留 CSS 兜底。
- [ ] 实现今天、计划、复盘、进度四个标签。
- [ ] 实现画像表单、规划书、日报、周报、确认式 AI 选题。
- [ ] 实现完成日期时间、题库导入和完整导出。
- [ ] 验证桌面、手机、本地写入和 AI 未配置错误提示。

### Task 5: 文档与最终验收

**Files:**
- Modify: `README.md`
- Modify: `.gitignore`

- [ ] 更新 DeepSeek 配置、画像、规划书、周报、导入导出说明。
- [ ] 运行全部测试、语法检查和真实服务联调。
- [ ] 使用浏览器截图检查暖色界面和移动端布局。
- [ ] 确认本地角色图不会进入公开提交，现有用户数据完整保留。
