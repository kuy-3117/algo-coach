# 算法学习教练

一个本地优先的算法学习规划、刷题记录与 AI 复盘工具。

它会结合你的竞赛目标、目标日期、每周可用时间、历史通过率和复习间隔，给出当天最值得做的题；做完后记录结果、卡点和手写总结，再按需生成 AI 日报与批判式周报。

它不是题库、判题器或代码执行器。内置题目只保存平台链接，点击后跳转到洛谷或 Codeforces。

## 启动

需要 Node.js 18 或更高版本，不需要安装 npm 依赖：

```powershell
cd algo-coach
node server.js
```

终端会打印本机地址和内网地址。在本机打开：

```text
http://127.0.0.1:8787
```

手机连接同一 WiFi 后可以查看今天、计划、复盘和进度，但只有从本机回环地址访问时才能写入。

## 功能

- 目标画像：竞赛、组别、语言、目标日期、每周分钟数、偏好平台、重点标签和当前水平。
- 时间规划书：根据目标日期自动生成基础诊断、专项强化、冲刺复盘三个阶段。
- 稳定选题：同一天刷新不会因为随机抖动而整组换题。
- 精准换题：点击某道题的“换一题”时，只替换这一张卡片。
- 每日预算：预算变化后按真实分钟数重新装填题目。
- 完整记录：完成日期时间、结果、卡点、主观难度、用时和手写总结。
- AI 选题：规则先生成候选池，AI 只能从候选池选择，确认后才应用。
- AI 复盘：今日简报和最近 7 天周报。周报至少需要 3 个活跃练习日。
- 题库扩展：支持 JSON / CSV 导入、去重、校验和可选的 AI 元数据补全。
- 完整导出：写入项目 `exports/`，同时作为文件下载。

## DeepSeek AI 配置

默认使用 DeepSeek 的 OpenAI 兼容接口：

```text
Base URL: https://api.deepseek.com
模型：deepseek-flash
```

密钥只从环境变量读取，优先使用：

```powershell
[Environment]::SetEnvironmentVariable(
  "DEEPSEEK_API_KEY",
  "你的密钥",
  "User"
)
```

也兼容已有的 `OPENAI_API_KEY`。设置后需要重启服务。密钥不会写入配置、报告、日志或导出包。

AI 调用只由按钮触发，不会后台自动计费。日报会发送当天做题结果、卡点、用时、手写总结和当前规划阶段；周报发送最近 7 个自然日的同类数据。

## 数据位置

- `data/config.json`：预算、复习规则、目标画像和 AI 接口设置。
- `data/plan.json`：当前规划书和阶段。
- `data/problems.json`：题库。
- `data/data.json`：只追加事件日志，包含做题、预算、换题和当天题单快照。
- `data/reports.json`：AI 日报和周报历史。
- `data/problem-packs/`：专题题库包与导入格式说明。
- `data/backup/`：事件写入前自动备份，保留最近 5 份。
- `exports/`：完整数据导出包。

所有派生状态都从事件流重新计算。历史事件不会被修改或删除。

## 添加题库

在“计划 → AI 与数据设置 → 导入题库”中粘贴 JSON / CSV，先预览，再确认写入。

单道题目格式：

```json
{
  "id": "cf-4A",
  "title": "Watermelon",
  "url": "https://codeforces.com/problemset/problem/4/A",
  "platform": "Codeforces",
  "difficulty": 1,
  "estMinutes": 20,
  "tags": ["数论", "位运算"]
}
```

- `id` 全局唯一。
- `difficulty` 为 `1`、`2`、`3`。
- `tags` 应与 `config.scopeTags` 中的中文标签一致。
- URL 必须真实；不能确认具体题号时使用平台官方搜索页。
- 不抓取题面，不调用洛谷或 Codeforces 的隐藏接口。

专题包说明见 `data/problem-packs/README.md`。

## 角色素材

`public/assets/warm-ai-hero.png`、`warm-ai-sheet.png` 和裁切头像仅用于本地私人界面。相关文件已加入 `.gitignore`，不会被公开仓库提交。图片缺失时页面保留普通布局，不阻塞核心功能。

## 测试

```powershell
node test.js
```

测试覆盖日期、状态重算、复习间隔、目标加权、稳定排题、精准换题、规划书、周报门槛、AI 响应校验、题库导入、数据自愈、备份和完整导出。
