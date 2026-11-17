# 题库包

这里用于存放可分发或私有的专题题库包。题库包不会抓取题面，只保存标题、平台链接、难度、预计用时和中文标签。

推荐格式：

```json
[
  {
    "id": "cf-4A",
    "title": "Watermelon",
    "url": "https://codeforces.com/problemset/problem/4/A",
    "platform": "Codeforces",
    "difficulty": 1,
    "estMinutes": 20,
    "tags": ["数论", "位运算"]
  }
]
```

在软件的“计划 → AI 与数据设置 → 导入题库”中粘贴内容或选择文件：

1. 点击“校验并预览”，先检查重复项和错误。
2. 可以选择 AI 补全难度、用时和标签。
3. 点击“确认导入”后才会写入 `data/problems.json`。

导入按 `id` 与规范化 URL 双重去重，不会修改已有做题记录。

## CCF CSP 300 题包

`ccf-csp-300.json` 按 CCF CSP 的常见结构整理：

- 洛谷 150 道，Codeforces 150 道
- 难度 1 / 2 / 3 分别为 120 / 145 / 35 道
- 覆盖当前 20 个目标标签中的 19 个
- 元数据来自两站官方公开题目列表；产品运行时不会调用平台 API
- 只保存题名和跳转链接，不保存题面或测试数据
