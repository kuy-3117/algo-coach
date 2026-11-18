'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { URL } = require('node:url');
const {
  addDays,
  applyPlanSnapshot,
  buildToday,
  computeStats,
  deriveState,
  generatePlanSkeleton,
  getActivePhase,
  getBudgetForDate,
  hashString,
  localDate,
  weeklyEligibility,
} = require('./algo');
const {
  normalizeAiConfig,
  requestAiSelection,
  requestProblemMetadata,
  requestStructuredReport,
  validateAiSelection,
} = require('./ai');
const { importProblems } = require('./importer');

const PORT = 8787;
const HOST = '0.0.0.0';
const MAX_BODY_BYTES = 1024 * 1024;
const BACKUP_LIMIT = 5;

const DEFAULT_CONFIG = {
  version: 1,
  dailyMinutes: 90,
  reviewRatio: 0.4,
  maxNewPerDay: 3,
  maxDailyProblems: 3,
  reviewIntervals: [1, 3, 7, 21, 45],
  tagColdDays: 14,
  recentDays: 7,
  theme: 'warm',
  scopeTags: [
    '数组',
    '模拟',
    '哈希表',
    '双指针',
    '滑动窗口',
    '前缀和',
    '栈',
    '队列',
    '链表',
    '二叉树',
    '堆',
    '图论',
    '并查集',
    '二分',
    '贪心',
    '动态规划',
    '回溯',
    '字符串',
    '数论',
    '位运算',
    '排序',
  ],
  weights: { weak: 0.4, fresh: 0.25, level: 0.2, prereq: 0.15 },
  profile: {
    competition: '',
    group: '',
    language: 'C++',
    goalDate: '',
    weeklyMinutes: 300,
    preferredPlatforms: ['洛谷', 'Codeforces'],
    focusTags: [],
    currentLevel: '',
    notes: '',
  },
  ai: {
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-flash',
  },
};

const DEFAULT_REPORTS = { version: 1, reports: [] };
const DEFAULT_PLAN = {
  version: 1,
  startDate: null,
  endDate: null,
  weeklyMinutes: 300,
  phases: [],
  source: 'unconfigured',
};

const BUILTIN_PROBLEMS = [
  ['cf-4A', 'Watermelon', 'Codeforces', 'https://codeforces.com/problemset/problem/4/A', 1, 20, ['数论', '位运算']],
  ['cf-158A', 'Next Round', 'Codeforces', 'https://codeforces.com/problemset/problem/158/A', 1, 20, ['数组', '排序']],
  ['cf-71A', 'Way Too Long Words', 'Codeforces', 'https://codeforces.com/problemset/problem/71/A', 1, 20, ['字符串']],
  ['cf-231A', 'Team', 'Codeforces', 'https://codeforces.com/problemset/problem/231/A', 1, 20, ['数组', '贪心']],
  ['cf-1A', 'Theatre Square', 'Codeforces', 'https://codeforces.com/problemset/problem/1/A', 1, 20, ['数论']],
  ['cf-50A', 'Domino piling', 'Codeforces', 'https://codeforces.com/problemset/problem/50/A', 1, 20, ['数论', '贪心']],
  ['cf-282A', 'Bit++', 'Codeforces', 'https://codeforces.com/problemset/problem/282/A', 1, 20, ['字符串', '位运算']],
  ['cf-263A', 'Beautiful Matrix', 'Codeforces', 'https://codeforces.com/problemset/problem/263/A', 1, 20, ['数组']],
  ['cf-112A', 'Petya and Strings', 'Codeforces', 'https://codeforces.com/problemset/problem/112/A', 1, 20, ['字符串', '排序']],
  ['cf-339A', 'Helpful Maths', 'Codeforces', 'https://codeforces.com/problemset/problem/339/A', 1, 20, ['字符串', '排序']],
  ['cf-236A', 'Boy or Girl', 'Codeforces', 'https://codeforces.com/problemset/problem/236/A', 2, 30, ['哈希表', '字符串']],
  ['cf-318A', 'Even Odds', 'Codeforces', 'https://codeforces.com/problemset/problem/318/A', 2, 30, ['数论']],
  ['cf-469A', 'I Wanna Be the Guy', 'Codeforces', 'https://codeforces.com/problemset/problem/469/A', 2, 30, ['哈希表', '数组']],
  ['cf-489B', 'BerSU Ball', 'Codeforces', 'https://codeforces.com/problemset/problem/489/B', 2, 40, ['双指针', '排序', '贪心']],
  ['cf-474B', 'Worms', 'Codeforces', 'https://codeforces.com/problemset/problem/474/B', 2, 40, ['二分', '前缀和']],
  ['cf-706B', 'Interesting drink', 'Codeforces', 'https://codeforces.com/problemset/problem/706/B', 2, 40, ['二分', '排序']],
  ['cf-580A', 'Kefa and First Steps', 'Codeforces', 'https://codeforces.com/problemset/problem/580/A', 3, 60, ['数组', '动态规划']],
  ['cf-455A', 'Boredom', 'Codeforces', 'https://codeforces.com/problemset/problem/455/A', 3, 70, ['动态规划', '数组']],
  ['cf-230B', 'T-primes', 'Codeforces', 'https://codeforces.com/problemset/problem/230/B', 3, 70, ['数论', '二分']],
  ['cf-813C', 'The Tag Game', 'Codeforces', 'https://codeforces.com/problemset/problem/813/C', 3, 90, ['二叉树', '图论']],
  ['luogu-P1048', '采药', '洛谷', 'https://www.luogu.com.cn/problem/P1048', 2, 40, ['动态规划']],
  ['luogu-P2249', '查找', '洛谷', 'https://www.luogu.com.cn/problem/P2249', 2, 35, ['二分', '数组']],
  ['luogu-P1739', '表达式括号匹配', '洛谷', 'https://www.luogu.com.cn/problem/P1739', 2, 30, ['栈', '字符串']],
  ['luogu-P1305', '新二叉树', '洛谷', 'https://www.luogu.com.cn/problem/P1305', 2, 40, ['二叉树']],
  ['luogu-P1216', '数字三角形 Number Triangles', '洛谷', 'https://www.luogu.com.cn/problem/P1216', 3, 50, ['动态规划', '数组']],
  ['luogu-P1605', '迷宫', '洛谷', 'https://www.luogu.com.cn/problem/P1605', 3, 60, ['回溯', '图论']],
  ['luogu-P3378', '【模板】堆', '洛谷', 'https://www.luogu.com.cn/problem/P3378', 3, 70, ['堆']],
  ['luogu-P3367', '【模板】并查集', '洛谷', 'https://www.luogu.com.cn/problem/P3367', 3, 70, ['并查集', '图论']],
  ['luogu-P4779', '【模板】单源最短路径（标准版）', '洛谷', 'https://www.luogu.com.cn/problem/P4779', 3, 90, ['图论', '堆']],
  ['luogu-P1886', '滑动窗口 /【模板】单调队列', '洛谷', 'https://www.luogu.com.cn/problem/P1886', 3, 80, ['滑动窗口', '队列']],
].map(([id, title, platform, url, difficulty, estMinutes, tags]) => ({
  id,
  title,
  url,
  platform,
  difficulty,
  estMinutes,
  tags,
}));

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

let atomicCounter = 0;

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`数据文件不存在：${path.basename(filePath)}`);
    }
    if (error instanceof SyntaxError) {
      throw new Error(`数据文件不是有效 JSON：${path.basename(filePath)}`);
    }
    throw new Error(`读取 ${path.basename(filePath)} 失败：${error.message}`);
  }
}

function atomicWriteJson(filePath, value, fsOperations = fs) {
  fsOperations.mkdirSync(path.dirname(filePath), { recursive: true });
  atomicCounter++;
  const tempPath = `${filePath}.${process.pid}.${atomicCounter}.tmp`;
  try {
    fsOperations.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    try {
      fsOperations.renameSync(tempPath, filePath);
    } catch (error) {
      if (!['EXDEV', 'EPERM'].includes(error.code)) {
        throw error;
      }
      fsOperations.copyFileSync(tempPath, filePath);
      fsOperations.rmSync(tempPath, { force: true });
    }
  } catch (error) {
    try {
      fsOperations.rmSync(tempPath, { force: true });
    } catch {
      // 清理失败不覆盖原始错误。
    }
    throw new Error(`写入 ${path.basename(filePath)} 失败：${error.message}`);
  }
}

function backupTimestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    'T',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
    pad(date.getMilliseconds()),
  ].join('');
}

function backupFile(filePath, backupDir) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  fs.mkdirSync(backupDir, { recursive: true });
  const suffix = crypto.randomBytes(3).toString('hex');
  const target = path.join(backupDir, `data-${backupTimestamp()}-${suffix}.json`);
  fs.copyFileSync(filePath, target);

  const backups = fs
    .readdirSync(backupDir)
    .filter((name) => /^data-.*\.json$/.test(name))
    .sort();
  for (const stale of backups.slice(0, Math.max(0, backups.length - BACKUP_LIMIT))) {
    fs.rmSync(path.join(backupDir, stale), { force: true });
  }
  return target;
}

function ensureDataFiles(dataDir, defaults = {}) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(path.join(dataDir, 'backup'), { recursive: true });
  fs.mkdirSync(path.join(dataDir, 'problem-packs'), { recursive: true });

  const files = [
    ['config.json', defaults.config || DEFAULT_CONFIG],
    ['problems.json', defaults.problems || BUILTIN_PROBLEMS],
    ['data.json', { version: 1, events: [] }],
    ['plan.json', defaults.plan || DEFAULT_PLAN],
    ['reports.json', defaults.reports || DEFAULT_REPORTS],
  ];

  for (const [name, fallback] of files) {
    const filePath = path.join(dataDir, name);
    if (!fs.existsSync(filePath)) {
      atomicWriteJson(filePath, fallback);
    }
  }
}

function appendEvent(dataDir, event) {
  return appendEvents(dataDir, [event])[0];
}

function appendEvents(dataDir, events) {
  const dataPath = path.join(dataDir, 'data.json');
  const data = readJson(dataPath);
  if (!data || !Array.isArray(data.events)) {
    throw new Error('data.json 必须包含 events 数组');
  }
  backupFile(dataPath, path.join(dataDir, 'backup'));
  data.events.push(...events);
  atomicWriteJson(dataPath, data);
  return events;
}

function readConfig(dataDir) {
  const raw = readJson(path.join(dataDir, 'config.json'));
  return {
    ...DEFAULT_CONFIG,
    ...raw,
    profile: { ...DEFAULT_CONFIG.profile, ...(raw.profile || {}) },
    ai: { ...DEFAULT_CONFIG.ai, ...(raw.ai || {}) },
    weights: { ...DEFAULT_CONFIG.weights, ...(raw.weights || {}) },
  };
}

function sanitizeConfigForExport(config) {
  return {
    ...config,
    ai: {
      baseUrl: config.ai?.baseUrl || DEFAULT_CONFIG.ai.baseUrl,
      model: config.ai?.model || DEFAULT_CONFIG.ai.model,
    },
  };
}

function writeExportBundle(rootDir, dataDir, customExportDir) {
  const exportsDir = customExportDir || path.join(rootDir, 'exports');
  fs.mkdirSync(exportsDir, { recursive: true });
  const bundle = {
    version: 2,
    exportedAt: localIsoTimestamp(),
    config: sanitizeConfigForExport(readConfig(dataDir)),
    practicePlan: readJson(path.join(dataDir, 'plan.json')),
    problems: readJson(path.join(dataDir, 'problems.json')),
    data: readJson(path.join(dataDir, 'data.json')),
    reports: readJson(path.join(dataDir, 'reports.json')),
  };
  const fileName = `algo-coach-export-${backupTimestamp()}.json`;
  const filePath = path.join(exportsDir, fileName);
  atomicWriteJson(filePath, bundle);
  return { filePath, fileName, bundle };
}

function isLoopbackAddress(address) {
  if (!address) {
    return false;
  }
  const normalized = address.toLowerCase();
  return (
    normalized === '::1' ||
    normalized === 'localhost' ||
    normalized.startsWith('127.') ||
    normalized.startsWith('::ffff:127.')
  );
}

function localIsoTimestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absoluteOffset = Math.abs(offsetMinutes);
  return (
    `${localDate(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}:` +
    `${pad(date.getSeconds())}${sign}${pad(Math.floor(absoluteOffset / 60))}:` +
    `${pad(absoluteOffset % 60)}`
  );
}

function normalizeCompletedAt(value) {
  if (!value) {
    const now = new Date();
    return { date: localDate(now), ts: localIsoTimestamp(now) };
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(
    String(value),
  );
  if (!match) {
    throw new Error('完成时间格式无效');
  }
  const date = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6] || 0),
  );
  if (
    date.getFullYear() !== Number(match[1]) ||
    date.getMonth() !== Number(match[2]) - 1 ||
    date.getDate() !== Number(match[3]) ||
    date.getHours() !== Number(match[4]) ||
    date.getMinutes() !== Number(match[5])
  ) {
    throw new Error('完成时间无效');
  }
  return { date: localDate(date), ts: localIsoTimestamp(date) };
}

function eventId(now = new Date()) {
  const compactTime = localIsoTimestamp(now)
    .replace(/[-:+]/g, '')
    .replace('T', 'T')
    .slice(0, 15);
  return `evt_${compactTime}_${crypto.randomBytes(2).toString('hex')}`;
}

function isValidDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  try {
    return addDays(value, 0) === value;
  } catch {
    return false;
  }
}

function sendJson(response, statusCode, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  response.end(body);
}

function sendError(response, statusCode, message) {
  sendJson(response, statusCode, { ok: false, error: message });
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('请求内容过大'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(text));
      } catch {
        reject(new Error('请求内容不是有效 JSON'));
      }
    });
    request.on('error', reject);
  });
}

function validateConfigPatch(current, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new Error('配置必须是 JSON 对象');
  }
  const allowed = new Set([
    'dailyMinutes',
    'reviewRatio',
    'maxNewPerDay',
    'maxDailyProblems',
    'reviewIntervals',
    'tagColdDays',
    'recentDays',
    'scopeTags',
    'weights',
    'profile',
    'ai',
    'theme',
  ]);
  for (const key of Object.keys(patch)) {
    if (!allowed.has(key)) {
      throw new Error(`不支持的配置字段：${key}`);
    }
  }

  const next = { ...current, ...patch };
  if (!Number.isInteger(next.dailyMinutes) || next.dailyMinutes < 0 || next.dailyMinutes > 720) {
    throw new Error('dailyMinutes 必须是 0 到 720 的整数');
  }
  if (
    typeof next.reviewRatio !== 'number' ||
    next.reviewRatio < 0 ||
    next.reviewRatio > 1
  ) {
    throw new Error('reviewRatio 必须是 0 到 1 之间的数字');
  }
  if (!Number.isInteger(next.maxNewPerDay) || next.maxNewPerDay < 0 || next.maxNewPerDay > 20) {
    throw new Error('maxNewPerDay 必须是 0 到 20 的整数');
  }
  if (
    !Number.isInteger(next.maxDailyProblems) ||
    next.maxDailyProblems < 1 ||
    next.maxDailyProblems > 20
  ) {
    throw new Error('maxDailyProblems 必须是 1 到 20 的整数');
  }
  if (
    !Array.isArray(next.reviewIntervals) ||
    next.reviewIntervals.length === 0 ||
    next.reviewIntervals.some((value) => !Number.isInteger(value) || value < 1)
  ) {
    throw new Error('reviewIntervals 必须是非空的正整数数组');
  }
  if (!Number.isInteger(next.tagColdDays) || next.tagColdDays < 1) {
    throw new Error('tagColdDays 必须是正整数');
  }
  if (!Number.isInteger(next.recentDays) || next.recentDays < 0) {
    throw new Error('recentDays 必须是非负整数');
  }
  if (!Array.isArray(next.scopeTags) || next.scopeTags.some((tag) => typeof tag !== 'string')) {
    throw new Error('scopeTags 必须是字符串数组');
  }
  if (
    !next.weights ||
    typeof next.weights !== 'object' ||
    ['weak', 'fresh', 'level', 'prereq'].some(
      (key) => typeof next.weights[key] !== 'number' || next.weights[key] < 0,
    )
  ) {
    throw new Error('weights 必须包含非负数字 weak、fresh、level、prereq');
  }
  next.profile = validateProfilePatch(current.profile || {}, patch.profile || {});
  const ai = { ...DEFAULT_CONFIG.ai, ...(current.ai || {}), ...(patch.ai || {}) };
  if (!/^https?:\/\//.test(String(ai.baseUrl || ''))) {
    throw new Error('AI Base URL 必须是有效的 http(s) 地址');
  }
  if (!String(ai.model || '').trim()) {
    throw new Error('AI 模型名不能为空');
  }
  next.ai = {
    baseUrl: String(ai.baseUrl).replace(/\/+$/, ''),
    model: String(ai.model).trim(),
  };
  next.theme = 'warm';
  return next;
}

function normalizeSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') {
    return null;
  }
  const title = String(snapshot.title || '').trim();
  const url = String(snapshot.url || '').trim();
  if (!title || !/^https?:\/\//.test(url)) {
    throw new Error('临时题需要标题和有效的 http(s) 链接');
  }
  return {
    title: title.slice(0, 120),
    url: url.slice(0, 1000),
    platform: '临时题',
    difficulty: [1, 2, 3].includes(Number(snapshot.difficulty))
      ? Number(snapshot.difficulty)
      : 2,
    estMinutes: Math.min(600, Math.max(1, Math.round(Number(snapshot.estMinutes) || 30))),
    tags: Array.isArray(snapshot.tags)
      ? snapshot.tags.filter((tag) => typeof tag === 'string').slice(0, 10)
      : [],
  };
}

function validateProfilePatch(current, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new Error('目标画像必须是 JSON 对象');
  }
  const allowed = new Set([
    'competition',
    'group',
    'language',
    'goalDate',
    'weeklyMinutes',
    'preferredPlatforms',
    'focusTags',
    'currentLevel',
    'notes',
  ]);
  for (const key of Object.keys(patch)) {
    if (!allowed.has(key)) {
      throw new Error(`不支持的目标画像字段：${key}`);
    }
  }
  const next = { ...DEFAULT_CONFIG.profile, ...current, ...patch };
  if (next.goalDate && !isValidDate(next.goalDate)) {
    throw new Error('目标日期格式必须是 YYYY-MM-DD');
  }
  if (
    !Number.isInteger(Number(next.weeklyMinutes)) ||
    Number(next.weeklyMinutes) < 60 ||
    Number(next.weeklyMinutes) > 10080
  ) {
    throw new Error('每周可用时间必须是 60 到 10080 分钟的整数');
  }
  if (
    !Array.isArray(next.preferredPlatforms) ||
    next.preferredPlatforms.some((platform) => typeof platform !== 'string')
  ) {
    throw new Error('preferredPlatforms 必须是字符串数组');
  }
  if (
    !Array.isArray(next.focusTags) ||
    next.focusTags.some((tag) => typeof tag !== 'string')
  ) {
    throw new Error('focusTags 必须是字符串数组');
  }
  return {
    ...next,
    weeklyMinutes: Number(next.weeklyMinutes),
    competition: String(next.competition || '').slice(0, 80),
    group: String(next.group || '').slice(0, 80),
    language: String(next.language || '').slice(0, 40),
    currentLevel: String(next.currentLevel || '').slice(0, 80),
    notes: String(next.notes || '').slice(0, 2000),
  };
}

function appendReport(dataDir, report) {
  const reportsPath = path.join(dataDir, 'reports.json');
  const file = readJson(reportsPath);
  if (!Array.isArray(file.reports)) {
    throw new Error('reports.json 必须包含 reports 数组');
  }
  file.reports.push(report);
  atomicWriteJson(reportsPath, file);
  return report;
}

function buildCandidatePool(dataDir, today) {
  const config = readConfig(dataDir);
  const problems = readJson(path.join(dataDir, 'problems.json'));
  const data = readJson(path.join(dataDir, 'data.json'));
  const practicePlan = readJson(path.join(dataDir, 'plan.json'));
  const scoringConfig = {
    ...config,
    maxDailyProblems: Math.max(8, Math.min(12, problems.length)),
    maxNewPerDay: Math.max(8, Math.min(12, problems.length)),
    _activePlan: practicePlan,
  };
  const { ps, ts } = deriveState(data.events, problems, scoringConfig);
  const budget = getBudgetForDate(data.events, config, today);
  const plan = buildToday({
    problems,
    ps,
    ts,
    config: scoringConfig,
    today,
    budget: Math.max(budget, 300),
    events: data.events,
  });
  return { config, problems, data, practicePlan, ps, ts, candidates: plan.items };
}

function planEventFromItems(items, today) {
  return {
    type: 'plan',
    id: eventId(),
    ts: localIsoTimestamp(),
    date: today,
    items: items.map((item) => ({
      problemId: item.p.id,
      kind: item.kind || 'new',
      reason: item.reason,
    })),
  };
}

function createState(dataDir, remoteAddress, today = localDate()) {
  const config = readConfig(dataDir);
  const problems = readJson(path.join(dataDir, 'problems.json'));
  const data = readJson(path.join(dataDir, 'data.json'));
  const practicePlan = readJson(path.join(dataDir, 'plan.json'));
  const reportsFile = readJson(path.join(dataDir, 'reports.json'));
  if (!Array.isArray(problems)) {
    throw new Error('problems.json 必须是题目数组');
  }
  if (!data || !Array.isArray(data.events)) {
    throw new Error('data.json 必须包含 events 数组');
  }
  const scoringConfig = { ...config, _activePlan: practicePlan };
  const { ps, ts } = deriveState(data.events, problems, scoringConfig);
  const budget = getBudgetForDate(data.events, config, today);
  const basePlan = buildToday({
    problems,
    ps,
    ts,
    config: scoringConfig,
    today,
    budget,
    events: data.events,
  });
  const plan = applyPlanSnapshot(basePlan, data.events, problems, data.events, today);
  const stats = computeStats(data.events, problems, config, today);
  const weekly = weeklyEligibility(data.events, today);
  const activePhase = getActivePhase(practicePlan, today);
  const ai = normalizeAiConfig(config.ai, process.env);
  const recentReports = Array.isArray(reportsFile.reports)
    ? reportsFile.reports.slice().sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt))).slice(0, 12)
    : [];
  return {
    ok: true,
    config,
    today,
    budget,
    plan,
    practicePlan,
    activePhase,
    dailySummaryAvailable: stats.totalAttempts > 0,
    weeklyEligibility: weekly,
    recentReports,
    ai: {
      configured: ai.configured,
      baseUrl: ai.baseUrl,
      model: ai.model,
    },
    stats,
    recent: stats.recent,
    readOnly: !isLoopbackAddress(remoteAddress),
  };
}

function serveStatic(publicDir, pathname, request, response) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    sendError(response, 400, '静态资源路径无效');
    return;
  }
  const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  const target = path.resolve(publicDir, relative);
  if (!target.startsWith(`${path.resolve(publicDir)}${path.sep}`) && target !== path.resolve(publicDir, 'index.html')) {
    sendError(response, 403, '禁止访问该路径');
    return;
  }
  let filePath = target;
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html');
  }
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    sendError(response, 404, '页面不存在');
    return;
  }
  const body = fs.readFileSync(filePath);
  response.writeHead(200, {
    'Content-Type': MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
    'Content-Length': body.length,
    'Cache-Control': 'no-cache',
  });
  if (request.method === 'HEAD') {
    response.end();
  } else {
    response.end(body);
  }
}

function createAppServer({ rootDir = __dirname, dataDir, publicDir, exportDir } = {}) {
  const resolvedDataDir = dataDir || path.join(rootDir, 'data');
  const resolvedPublicDir = publicDir || path.join(rootDir, 'public');
  ensureDataFiles(resolvedDataDir);

  return http.createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
      const { pathname } = requestUrl;
      const remoteAddress = request.socket.remoteAddress;
      const isWrite = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method);

      if (isWrite && !isLoopbackAddress(remoteAddress)) {
        sendError(response, 403, '该设备只有查看权限，请在本机浏览器中操作');
        return;
      }

      if (request.method === 'GET' && pathname === '/api/state') {
        const requestedDate = requestUrl.searchParams.get('date');
        const stateDate =
          requestedDate && isValidDate(requestedDate) ? requestedDate : localDate();
        sendJson(response, 200, createState(resolvedDataDir, remoteAddress, stateDate));
        return;
      }

      if (request.method === 'GET' && pathname === '/api/export') {
        const result = writeExportBundle(rootDir, resolvedDataDir, exportDir);
        const body = Buffer.from(`${JSON.stringify(result.bundle, null, 2)}\n`, 'utf8');
        response.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Disposition': `attachment; filename="${result.fileName}"`,
          'X-Export-File': result.fileName,
          'Content-Length': body.length,
          'Cache-Control': 'no-store',
        });
        response.end(body);
        return;
      }

      if (request.method === 'POST' && pathname === '/api/profile') {
        const body = await readBody(request);
        const configPath = path.join(resolvedDataDir, 'config.json');
        const current = readConfig(resolvedDataDir);
        const profile = validateProfilePatch(current.profile, body.profile || body);
        const next = { ...current, profile };
        atomicWriteJson(configPath, next);
        let practicePlan = readJson(path.join(resolvedDataDir, 'plan.json'));
        if (profile.goalDate && body.generatePlan !== false) {
          practicePlan = {
            ...generatePlanSkeleton({
              profile,
              today: localDate(),
              scopeTags: next.scopeTags,
            }),
            updatedAt: localIsoTimestamp(),
          };
          atomicWriteJson(path.join(resolvedDataDir, 'plan.json'), practicePlan);
        }
        sendJson(response, 200, {
          ok: true,
          profile,
          practicePlan,
          state: createState(resolvedDataDir, remoteAddress),
        });
        return;
      }

      if (request.method === 'POST' && pathname === '/api/plan/generate') {
        const config = readConfig(resolvedDataDir);
        const practicePlan = {
          ...generatePlanSkeleton({
            profile: config.profile,
            today: localDate(),
            scopeTags: config.scopeTags,
          }),
          updatedAt: localIsoTimestamp(),
        };
        atomicWriteJson(path.join(resolvedDataDir, 'plan.json'), practicePlan);
        sendJson(response, 200, {
          ok: true,
          practicePlan,
          state: createState(resolvedDataDir, remoteAddress),
        });
        return;
      }

      if (request.method === 'POST' && pathname === '/api/ai/report') {
        const body = await readBody(request);
        const type = body.type === 'weekly' ? 'weekly' : 'daily';
        const today = body.date && isValidDate(body.date) ? body.date : localDate();
        const config = readConfig(resolvedDataDir);
        const data = readJson(path.join(resolvedDataDir, 'data.json'));
        const problems = readJson(path.join(resolvedDataDir, 'problems.json'));
        const practicePlan = readJson(path.join(resolvedDataDir, 'plan.json'));
        const stats = computeStats(data.events, problems, config, today);
        const weekly = weeklyEligibility(data.events, today);
        if (type === 'weekly' && !weekly.eligible) {
          throw new Error(`最近 7 天只有 ${weekly.activeDays} 个活跃日，至少需要 3 天`);
        }
        const periodStart = type === 'weekly' ? weekly.startDate : today;
        const attempts = data.events.filter(
          (event) =>
            event.type === 'attempt' &&
            event.date >= periodStart &&
            event.date <= today,
        );
        if (!attempts.length) {
          throw new Error('当前周期还没有做题记录，无法生成复盘');
        }
        const input = {
          period: { start: periodStart, end: today, type },
          profile: config.profile,
          activePhase: getActivePhase(practicePlan, today),
          stats: {
            streak: stats.streak,
            totalAttempts: stats.totalAttempts,
            totalSolved: stats.totalSolved,
            totalMinutes: stats.totalMinutes,
            weekSolved: stats.weekSolved,
            tagStats: stats.tagStats,
          },
          attempts,
          dailyPlan: createState(resolvedDataDir, remoteAddress, today).plan.items.map(
            (item) => ({ problemId: item.p.id, title: item.p.title, reason: item.reason }),
          ),
        };
        const content = await requestStructuredReport({
          config: config.ai,
          type,
          input,
        });
        const aiConfig = normalizeAiConfig(config.ai, process.env);
        const report = {
          id: `report_${type}_${backupTimestamp()}_${crypto.randomBytes(2).toString('hex')}`,
          type,
          periodStart,
          periodEnd: today,
          createdAt: localIsoTimestamp(),
          model: aiConfig.model,
          inputHash: hashString(JSON.stringify(input)),
          content,
        };
        appendReport(resolvedDataDir, report);
        sendJson(response, 200, {
          ok: true,
          report,
          state: createState(resolvedDataDir, remoteAddress),
        });
        return;
      }

      if (request.method === 'POST' && pathname === '/api/ai/select') {
        const body = await readBody(request);
        const today = body.date && isValidDate(body.date) ? body.date : localDate();
        const pool = buildCandidatePool(resolvedDataDir, today);
        if (!pool.candidates.length) {
          throw new Error('当前没有可供 AI 选择的候选题');
        }
        const selections = await requestAiSelection({
          config: pool.config.ai,
          profile: pool.config.profile,
          today,
          candidates: pool.candidates.map((item) => ({
            id: item.p.id,
            title: item.p.title,
            platform: item.p.platform,
            difficulty: item.p.difficulty,
            tags: item.p.tags,
            reason: item.reason,
          })),
        });
        if (!selections.length) {
          throw new Error('AI 没有返回候选池中的有效题目');
        }
        sendJson(response, 200, {
          ok: true,
          selections: selections.map((selection) => {
            const candidate = pool.candidates.find(
              (item) => item.p.id === selection.problemId,
            );
            return {
              ...selection,
              problem: candidate.p,
              estMinutes: candidate.estMinutes,
              sourceReason: candidate.reason,
            };
          }),
        });
        return;
      }

      if (request.method === 'POST' && pathname === '/api/plan/apply') {
        const body = await readBody(request);
        const today = body.date && isValidDate(body.date) ? body.date : localDate();
        const pool = buildCandidatePool(resolvedDataDir, today);
        const selections = validateAiSelection(
          { selections: body.selections || [] },
          pool.candidates.map((item) => item.p.id),
        );
        if (!selections.length) {
          throw new Error('没有可应用的 AI 选题');
        }
        const items = selections.map((selection) => {
          const candidate = pool.candidates.find(
            (item) => item.p.id === selection.problemId,
          );
          return {
            ...candidate,
            kind: 'ai',
            reason: selection.reason,
          };
        });
        const event = planEventFromItems(items, today);
        appendEvent(resolvedDataDir, event);
        sendJson(response, 200, {
          ok: true,
          event,
          state: createState(resolvedDataDir, remoteAddress, today),
        });
        return;
      }

      if (request.method === 'POST' && pathname === '/api/problems/import') {
        const body = await readBody(request);
        const problems = readJson(path.join(resolvedDataDir, 'problems.json'));
        const result = importProblems(body.text, problems, body.format || 'auto');
        if (body.confirm === false) {
          sendJson(response, 200, { ok: true, preview: true, ...result });
          return;
        }
        if (!result.added.length) {
          throw new Error(result.errors[0] || '没有可导入的新题目');
        }
        if (body.enrichAi) {
          const config = readConfig(resolvedDataDir);
          const metadata = await requestProblemMetadata({
            config: config.ai,
            problems: result.added,
            scopeTags: config.scopeTags,
          });
          const metadataMap = new Map(metadata.map((item) => [item.id, item]));
          result.added = result.added.map((item) => ({
            ...item,
            ...(metadataMap.get(item.id) || {}),
            id: item.id,
          }));
        }
        atomicWriteJson(
          path.join(resolvedDataDir, 'problems.json'),
          [...problems, ...result.added],
        );
        sendJson(response, 200, {
          ok: true,
          ...result,
          total: problems.length + result.added.length,
          state: createState(resolvedDataDir, remoteAddress),
        });
        return;
      }

      if (request.method === 'POST' && pathname === '/api/record') {
        const body = await readBody(request);
        const config = readJson(path.join(resolvedDataDir, 'config.json'));
        const problems = readJson(path.join(resolvedDataDir, 'problems.json'));
        const problemExists = problems.some((problem) => problem.id === body.problemId);
        const snapshot = problemExists ? null : normalizeSnapshot(body.problemSnapshot);
        if (!problemExists && !snapshot) {
          throw new Error('题目不在题库中，且没有提供临时题信息');
        }
        const allowedResults = ['solved', 'hinted', 'saw_solution', 'failed'];
        if (!allowedResults.includes(body.result)) {
          throw new Error('请选择有效的完成结果');
        }
        const note = String(body.note || '').trim();
        if (!note) {
          throw new Error('手写总结不能为空');
        }
        const minutes = Math.round(Number(body.minutes));
        if (!Number.isFinite(minutes) || minutes < 1 || minutes > 1440) {
          throw new Error('用时必须是 1 到 1440 分钟的整数');
        }
        const completed = normalizeCompletedAt(body.completedAt);
        const date = body.completedAt ? completed.date : body.date || localDate();
        if (!isValidDate(date)) {
          throw new Error('记录日期无效');
        }
        const allowedStuckAt = ['idea', 'impl', 'complexity', 'edge'];
        const stuckAt = Array.isArray(body.stuckAt)
          ? body.stuckAt.filter((value) => allowedStuckAt.includes(value))
          : [];
        const allowedPerceived = ['easier', 'normal', 'harder'];
        const perceived = allowedPerceived.includes(body.perceived) ? body.perceived : null;
        const now = new Date();
        const event = {
          type: 'attempt',
          id: eventId(now),
          ts: body.completedAt ? completed.ts : localIsoTimestamp(now),
          date,
          problemId: String(body.problemId).slice(0, 120),
          result: body.result,
          stuckAt: stuckAt.length ? stuckAt : null,
          perceived,
          minutes,
          note,
          ...(snapshot ? { problemSnapshot: snapshot } : {}),
        };
        appendEvent(resolvedDataDir, event);
        sendJson(response, 200, {
          ok: true,
          event,
          state: createState(resolvedDataDir, remoteAddress, date === localDate() ? date : localDate()),
          configMaxNewPerDay: config.maxNewPerDay,
        });
        return;
      }

      if (request.method === 'POST' && pathname === '/api/budget') {
        const body = await readBody(request);
        const date = body.date || localDate();
        const minutes = Math.round(Number(body.minutes));
        if (!isValidDate(date)) {
          throw new Error('预算日期无效');
        }
        if (!Number.isFinite(minutes) || minutes < 0 || minutes > 1440) {
          throw new Error('预算必须是 0 到 1440 分钟的整数');
        }
        const now = new Date();
        const event = {
          type: 'budget',
          id: eventId(now),
          ts: localIsoTimestamp(now),
          date,
          minutes,
        };
        appendEvent(resolvedDataDir, event);
        sendJson(response, 200, {
          ok: true,
          event,
          state: createState(resolvedDataDir, remoteAddress),
        });
        return;
      }

      if (request.method === 'POST' && pathname === '/api/swap') {
        const body = await readBody(request);
        const date = body.date || localDate();
        if (!isValidDate(date)) {
          throw new Error('换题日期无效');
        }
        const problems = readJson(path.join(resolvedDataDir, 'problems.json'));
        if (!problems.some((problem) => problem.id === body.problemId)) {
          throw new Error('只能换掉题库中的题目');
        }
        const currentState = createState(resolvedDataDir, remoteAddress, date);
        const currentItems = currentState.plan.items;
        const targetIndex = currentItems.findIndex(
          (item) => item.p.id === body.problemId,
        );
        if (targetIndex < 0) {
          throw new Error('这道题已经不在今天的计划中');
        }
        const pool = buildCandidatePool(resolvedDataDir, date);
        const currentIds = new Set(currentItems.map((item) => item.p.id));
        const replacement = pool.candidates.find(
          (candidate) => !currentIds.has(candidate.p.id),
        );
        if (!replacement) {
          throw new Error('暂无可替换的备选题');
        }
        const now = new Date();
        const swapEvent = {
          type: 'swap',
          id: eventId(now),
          ts: localIsoTimestamp(now),
          date,
          problemId: String(body.problemId).slice(0, 120),
        };
        const nextItems = currentItems.slice();
        nextItems[targetIndex] = {
          ...replacement,
          kind: 'swap_fill',
          reason: `换题补入：${replacement.reason}`,
        };
        const planEvent = planEventFromItems(nextItems, date);
        appendEvents(resolvedDataDir, [swapEvent, planEvent]);
        sendJson(response, 200, {
          ok: true,
          event: swapEvent,
          replacement: replacement.p,
          state: createState(resolvedDataDir, remoteAddress, date),
        });
        return;
      }

      if (request.method === 'POST' && pathname === '/api/config') {
        const body = await readBody(request);
        const configPath = path.join(resolvedDataDir, 'config.json');
        const current = readConfig(resolvedDataDir);
        const next = validateConfigPatch(current, body);
        atomicWriteJson(configPath, next);
        sendJson(response, 200, {
          ok: true,
          config: next,
          state: createState(resolvedDataDir, remoteAddress),
        });
        return;
      }

      if (request.method === 'GET' || request.method === 'HEAD') {
        serveStatic(resolvedPublicDir, pathname, request, response);
        return;
      }

      sendError(response, 405, '不支持该请求方法');
    } catch (error) {
      const knownError =
        error.message.startsWith('数据文件') ||
        error.message.startsWith('读取 ') ||
        error.message.startsWith('写入 ') ||
        error.message.includes('必须') ||
        error.message.includes('不能') ||
        error.message.includes('无效') ||
        error.message.includes('请选择') ||
        error.message.includes('只能') ||
        error.message.includes('不支持') ||
        error.message.includes('需要') ||
        error.message.includes('过大') ||
        error.message.includes('有效') ||
        error.message.includes('尚未配置') ||
        error.message.includes('AI 返回');
      sendError(response, knownError ? 400 : 500, error.message || '服务器发生未知错误');
    }
  });
}

function networkUrls(port = PORT) {
  const urls = [`http://127.0.0.1:${port}`];
  const interfaces = os.networkInterfaces();
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries || []) {
      if (entry.family === 'IPv4' && !entry.internal) {
        urls.push(`http://${entry.address}:${port}`);
      }
    }
  }
  return urls;
}

function startServer() {
  const dataDir = path.join(__dirname, 'data');
  ensureDataFiles(dataDir);
  fs.mkdirSync(path.join(__dirname, 'exports'), { recursive: true });
  backupFile(path.join(dataDir, 'data.json'), path.join(dataDir, 'backup'));
  const server = createAppServer({ rootDir: __dirname });
  server.listen(PORT, HOST, () => {
    process.stdout.write('算法学习教练已启动\n');
    for (const url of networkUrls(PORT)) {
      process.stdout.write(`${url}\n`);
    }
    process.stdout.write('局域网设备为只读模式；写入请使用本机地址。\n');
  });
  return server;
}

if (require.main === module) {
  startServer();
}

module.exports = {
  BUILTIN_PROBLEMS,
  DEFAULT_PLAN,
  DEFAULT_REPORTS,
  DEFAULT_CONFIG,
  appendEvent,
  appendEvents,
  atomicWriteJson,
  backupFile,
  buildCandidatePool,
  createAppServer,
  createState,
  ensureDataFiles,
  eventId,
  isLoopbackAddress,
  localIsoTimestamp,
  networkUrls,
  readJson,
  readConfig,
  startServer,
  writeExportBundle,
};
