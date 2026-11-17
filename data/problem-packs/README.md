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
