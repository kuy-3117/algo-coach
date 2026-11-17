# 算法学习教练 MVP 设计

**日期：** 2026-11-17

**目标：** 交付一个本地优先、零 npm 依赖、可直接用 `node server.js` 启动的算法学习规划与记录工具。

## 产品边界

- 产品是调度器、记录本和统计面板，不是题库、判题器或在线平台代理。
- 所有学习状态从只追加事件流重算，不落盘派生状态。
- 数据保存在本地明文 JSON；事件写入采用临时文件加原子重命名，并在写入前轮转备份。
- P0 不接入任何大模型、账号、云同步、数据库或构建工具。

## 已确认决策

1. 项目位于 `algo-coach/`，顶层增加 `algo.js` 以隔离纯算法。
2. 服务端承担 HTTP、持久化与静态文件职责；算法不直接读写文件。
3. 只有来自回环地址的本机浏览器可以写入，局域网其他设备只读。
4. 每日推荐总数由 `config.maxDailyProblems` 控制，MVP 默认硬上限为 3，后续可改配置放宽。
5. 临时加题不写入 `problems.json`；其记录保留 `problemSnapshot`，计入总量和最近记录，不进入复习调度。
6. GitHub 发布暂不在 MVP 验收范围内；本地目录仍保持可提交为公开仓库的结构。

## 文件结构

```text
algo-coach/
├── algo.js
├── server.js
├── test.js
├── README.md
├── .gitignore
├── public/
│   ├── index.html
│   ├── app.js
│   └── style.css
└── data/
    ├── config.json
    ├── problems.json
    ├── data.json
    └── backup/
```

`docs/superpowers/` 仅保存开发过程文档，不参与运行时。

## 核心接口

- `deriveState(events, problems, config, today) -> { ps, ts }`
- `buildToday({ problems, ps, ts, config, today, budget, events }) -> { items, usedMinutes, budget, maxProblems }`
- `computeStats(events, problems, config, today) -> stats`
- `GET /api/state`
- `POST /api/record`
- `POST /api/budget`
- `POST /api/swap`
- `POST /api/config`
- `GET /api/export`

所有 JSON 响应统一包含 `ok`；业务错误使用 400，意外错误使用 500，并返回中文说明。

## 验收

- `node test.js` 覆盖状态重算、Leitner 盒子、复习到期、推荐理由、三题上限、连续天数、临时题统计和预算约束。
- 启动服务后验证五个业务接口、本机写入限制、原子写入、备份轮转和缺失数据自愈。
- 浏览器验收今天页、记录弹窗、预算、换题、临时题、进度页、热力图、知识点表和手机只读。
- 全部视觉与交互检查完成后，记录结果到 README。
