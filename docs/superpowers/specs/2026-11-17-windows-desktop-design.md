# Windows 桌面版设计

**日期：** 2026-11-17

## 目标

将现有本地 Web 应用封装为 Windows 10/11 x64 桌面程序，通过 GitHub Releases 分发 `.exe` 安装包。

## 运行架构

- Electron 主进程启动只监听 `127.0.0.1` 随机端口的现有 Node HTTP 服务。
- BrowserWindow 使用 `contextIsolation: true`、`nodeIntegration: false` 和沙箱。
- 桌面数据位于 Windows Documents 目录下的 `AlgoCoach/data`。
- 导出位于 `AlgoCoach/exports`。
- 应用通过单实例锁避免并发写同一数据目录。

## 安全

- API Key 使用 Electron `safeStorage`（Windows DPAPI）加密保存。
- 密钥不经过网页存储，不进入配置文件、报告、安装包或导出包。
- 外部题目链接通过系统默认浏览器打开，不在应用内执行网页脚本。
- 公开安装包不包含个人记录、报告、配置或 API Key。

## 发布

- 使用 electron-builder 生成用户级 NSIS 安装包。
- 安装器为 Chromium 沙箱目录补充 Windows 受限应用包读取权限。
- 推送 `v*` 标签触发 GitHub Actions 构建、测试、生成 SHA-256 并发布 Release。
- 首版无代码签名，文档明确说明 SmartScreen 提示和校验方法。

## 验证

- 原有 `node test.js` 全部通过。
- 安装包可静默安装到当前用户目录并显示主窗口。
- 桌面 API、密钥保存/清除、330 道题库、角色素材和个人数据迁移完成验证。
