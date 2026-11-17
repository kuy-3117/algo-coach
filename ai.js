'use strict';

const DEFAULT_AI_BASE_URL = 'https://api.deepseek.com';
const DEFAULT_AI_MODEL = 'deepseek-flash';
const AI_TIMEOUT_MS = 60000;

const REPORT_SCHEMAS = {
  daily: ['headline', 'facts', 'issues', 'tomorrowFocus', 'encouragement'],
  weekly: ['verdict', 'facts', 'criticalIssues', 'patterns', 'nextWeekPlan', 'risk'],
  plan: ['headline', 'phaseAdvice', 'risks'],
};

function normalizeAiConfig(config = {}, env = process.env) {
  const baseUrl = String(
    config.baseUrl || env.DEEPSEEK_BASE_URL || DEFAULT_AI_BASE_URL,
  ).replace(/\/+$/, '');
  const model = String(config.model || env.DEEPSEEK_MODEL || DEFAULT_AI_MODEL);
  const apiKey = String(
    env.DEEPSEEK_API_KEY || env.OPENAI_API_KEY || config.apiKey || '',
  );
  return {
    baseUrl,
    model,
    apiKey,
    configured: Boolean(apiKey),
  };
}

function stripJsonFence(content) {
  const text = String(content || '').trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text);
  return (fenced ? fenced[1] : text).trim();
}

function parseStructuredContent(content) {
  try {
    return JSON.parse(stripJsonFence(content));
  } catch {
    throw new Error('AI 返回内容不是有效 JSON，已保留原数据未修改');
  }
}

function validateReport(type, report) {
  const schema = REPORT_SCHEMAS[type];
  if (!schema || !report || typeof report !== 'object' || Array.isArray(report)) {
    throw new Error('AI 返回的报告结构无效');
  }
  for (const key of schema) {
    if (!(key in report)) {
      throw new Error(`AI 报告缺少字段：${key}`);
    }
  }
  if (typeof report[schema[0]] !== 'string') {
    throw new Error(`AI 报告字段 ${schema[0]} 必须是文字`);
  }
  return report;
}

function reportPrompt(type) {
  if (type === 'daily') {
    return [
      '你是严格但友善的算法学习复盘助手。',
      '只根据输入数据陈述事实，不编造题目、时间或通过率。',
      '输出一个 JSON 对象，必须包含：headline（字符串）、facts（字符串数组）、issues（字符串数组）、tomorrowFocus（字符串）、encouragement（字符串）。',
      'issues 要指出一个最值得警惕的问题，不要只写鼓励。',
    ].join('\n');
  }
  if (type === 'weekly') {
    return [
      '你是批判式算法训练复盘助手。',
      '只使用输入中的最近七天数据，不推测不存在的练习。',
      '输出一个 JSON 对象，必须包含：verdict（字符串）、facts（字符串数组）、criticalIssues（字符串数组）、patterns（字符串数组）、nextWeekPlan（对象数组，每项含 tag、action、target）、risk（字符串）。',
      'criticalIssues 必须点名具体问题；如果样本不足，直接在 risk 中说明。',
      'nextWeekPlan 只能提出建议，不得声称已经修改规划书。',
    ].join('\n');
  }
  return [
    '你是算法训练规划助手，只能补充规划建议。',
    '输出 JSON：headline（字符串）、phaseAdvice（对象数组，每项含 phase、advice）、risks（字符串数组）。',
    '不得修改日期、阶段数量或用户可用时间，只提供学习重点与风险提醒。',
  ].join('\n');
}

async function requestStructuredReport({
  config,
  type,
  input,
  fetchImpl = globalThis.fetch,
  timeoutMs = AI_TIMEOUT_MS,
}) {
  const normalized = normalizeAiConfig(config);
  if (!normalized.configured) {
    throw new Error('尚未配置 AI 密钥，请设置 DEEPSEEK_API_KEY 后重启服务');
  }
  if (!REPORT_SCHEMAS[type]) {
    throw new Error('不支持的 AI 报告类型');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetchImpl(`${normalized.baseUrl}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${normalized.apiKey}`,
      },
      body: JSON.stringify({
        model: normalized.model,
        temperature: 0.3,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: reportPrompt(type) },
          {
            role: 'user',
            content: `请分析以下 JSON 数据：\n${JSON.stringify(input)}`,
          },
        ],
      }),
    });
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('AI 请求超时，请稍后重试');
    }
    throw new Error(`AI 请求失败：${error.message}`);
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    let detail = '';
    try {
      const payload = await response.json();
      detail = payload?.error?.message || payload?.message || '';
    } catch {
      detail = '';
    }
    throw new Error(`AI 服务返回 ${response.status}${detail ? `：${detail}` : ''}`);
  }

  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content;
  return validateReport(type, parseStructuredContent(content));
}

function validateAiSelection(selection, candidateIds) {
  const ids = new Set(candidateIds);
  const seen = new Set();
  const selections = Array.isArray(selection?.selections) ? selection.selections : [];
  return selections
    .filter(
      (item) =>
        item &&
        typeof item.problemId === 'string' &&
        ids.has(item.problemId) &&
        !seen.has(item.problemId) &&
        (seen.add(item.problemId), true),
    )
    .slice(0, 3)
    .map((item) => ({
      problemId: item.problemId,
      reason: String(item.reason || '按目标画像优先安排').slice(0, 160),
    }));
}

async function requestAiSelection({
  config,
  profile,
  candidates,
  today,
  fetchImpl = globalThis.fetch,
}) {
  const normalized = normalizeAiConfig(config);
  if (!normalized.configured) {
    throw new Error('尚未配置 AI 密钥，请设置 DEEPSEEK_API_KEY 后重启服务');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  try {
    const response = await fetchImpl(`${normalized.baseUrl}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${normalized.apiKey}`,
      },
      body: JSON.stringify({
        model: normalized.model,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content:
              '你是算法学习选题助手。只能从 candidates 中选择最多 3 道，不得发明题号。输出 JSON：selections 数组，每项含 problemId 和 reason。优先目标竞赛、当前阶段和薄弱标签，同时尊重复习规则。',
          },
          {
            role: 'user',
            content: JSON.stringify({ today, profile, candidates }),
          },
        ],
      }),
    });
    if (!response.ok) {
      throw new Error(`AI 服务返回 ${response.status}`);
    }
    const payload = await response.json();
    const parsed = parseStructuredContent(payload?.choices?.[0]?.message?.content);
    return validateAiSelection(parsed, candidates.map((item) => item.id));
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('AI 选题请求超时');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function requestProblemMetadata({
  config,
  problems,
  scopeTags,
  fetchImpl = globalThis.fetch,
}) {
  const normalized = normalizeAiConfig(config);
  if (!normalized.configured) {
    throw new Error('尚未配置 AI 密钥，无法补全题目元数据');
  }
  if (!Array.isArray(problems) || !problems.length) {
    return [];
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  try {
    const response = await fetchImpl(`${normalized.baseUrl}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${normalized.apiKey}`,
      },
      body: JSON.stringify({
        model: normalized.model,
        temperature: 0.1,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content:
              '你是题库元数据整理助手。只能为输入中的题目标注难度、预计分钟和标签，不得改题名或链接。difficulty 只能是 1、2、3；estMinutes 为 10 到 240 的整数；tags 只能取 scopeTags 中的值。输出 JSON：problems 数组，每项含 id、difficulty、estMinutes、tags。',
          },
          {
            role: 'user',
            content: JSON.stringify({ problems, scopeTags }),
          },
        ],
      }),
    });
    if (!response.ok) {
      throw new Error(`AI 服务返回 ${response.status}`);
    }
    const payload = await response.json();
    const parsed = parseStructuredContent(payload?.choices?.[0]?.message?.content);
    const inputIds = new Set(problems.map((problem) => problem.id));
    const allowedTags = new Set(scopeTags);
    return (Array.isArray(parsed?.problems) ? parsed.problems : [])
      .filter((item) => item && inputIds.has(item.id))
      .map((item) => ({
        id: item.id,
        difficulty: [1, 2, 3].includes(Number(item.difficulty))
          ? Number(item.difficulty)
          : 2,
        estMinutes: Math.min(
          240,
          Math.max(10, Math.round(Number(item.estMinutes) || 40)),
        ),
        tags: Array.isArray(item.tags)
          ? item.tags.filter((tag) => allowedTags.has(tag)).slice(0, 6)
          : [],
      }));
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('AI 题库补全请求超时');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  DEFAULT_AI_BASE_URL,
  DEFAULT_AI_MODEL,
  normalizeAiConfig,
  parseStructuredContent,
  requestAiSelection,
  requestProblemMetadata,
  requestStructuredReport,
  validateAiSelection,
  validateReport,
};
