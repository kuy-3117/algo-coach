'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  addDays,
  daysBetween,
  deriveState,
  computeStats,
  buildToday,
  scoreProblem,
  applyPlanSnapshot,
  generatePlanSkeleton,
  scoreGoalMatch,
  weeklyEligibility,
} = require('./algo');
const {
  BUILTIN_PROBLEMS,
  createAppServer,
  atomicWriteJson,
  ensureDataFiles,
  appendEvent,
  isLoopbackAddress,
  writeExportBundle,
} = require('./server');
const {
  normalizeAiConfig,
  requestStructuredReport,
  requestProblemMetadata,
  validateAiSelection,
} = require('./ai');
const {
  importProblems,
  parseCsv,
} = require('./importer');

const baseConfig = {
  version: 1,
  dailyMinutes: 90,
  reviewRatio: 0.4,
  maxNewPerDay: 3,
  maxDailyProblems: 3,
  reviewIntervals: [1, 3, 7, 21, 45],
  tagColdDays: 14,
  recentDays: 7,
  scopeTags: ['数组', '哈希表', '双指针', '动态规划'],
  weights: { weak: 0.4, fresh: 0.25, level: 0.2, prereq: 0.15 },
};

function problem(id, overrides = {}) {
  return {
    id,
    title: `题目 ${id}`,
    url: `https://example.com/${id}`,
    platform: '测试平台',
    difficulty: 2,
    estMinutes: 30,
    tags: ['数组'],
    ...overrides,
  };
}

function attempt(id, date, result, overrides = {}) {
  return {
    type: 'attempt',
    id: `evt-${id}-${date}`,
    ts: `${date}T12:00:00+08:00`,
    date,
    problemId: id,
    result,
    stuckAt: null,
    perceived: null,
    minutes: 30,
    note: '测试总结',
    ...overrides,
  };
}

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

test('本地日期加减和跨月天数正确', () => {
  assert.equal(addDays('2026-11-17', 3), '2026-11-20');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(daysBetween('2026-11-14', '2026-11-17'), 3);
});

test('正解推进 Leitner 盒子并重算标签水平', () => {
  const problems = [problem('p1')];
  const { ps, ts } = deriveState(
    [
      attempt('p1', '2026-11-16', 'failed'),
      attempt('p1', '2026-11-17', 'solved'),
    ],
    problems,
    baseConfig,
    '2026-11-17',
  );

  assert.equal(ps.p1.box, 1);
  assert.equal(ps.p1.nextDue, '2026-11-20');
  assert.equal(ps.p1.attempts, 2);
  assert.equal(ps.p1.passes, 1);
  assert.equal(ts['数组'].attempts, 2);
  assert.equal(ts['数组'].passes, 1);
  assert.equal(ts['数组'].level, 2);
});

test('看题解会回到盒子 0，并在次日复习', () => {
  const { ps } = deriveState(
    [attempt('p1', '2026-11-17', 'saw_solution')],
    [problem('p1')],
    baseConfig,
    '2026-11-17',
  );

  assert.equal(ps.p1.box, 0);
  assert.equal(ps.p1.nextDue, '2026-11-18');
});

test('连续天数今天未打卡时从昨天计算', () => {
  const events = [
    attempt('p1', '2026-11-16', 'solved'),
    attempt('p1', '2026-11-15', 'failed'),
    attempt('p1', '2026-11-13', 'solved'),
  ];
  const stats = computeStats(events, [problem('p1')], baseConfig, '2026-11-17');

  assert.equal(stats.streak, 2);
  assert.equal(stats.totalAttempts, 3);
  assert.equal(stats.totalSolved, 2);
  assert.equal(stats.totalMinutes, 90);
});

test('临时题计入总量与最近记录但不形成复习状态', () => {
  const custom = attempt('custom-1', '2026-11-17', 'solved', {
    problemSnapshot: {
      title: '临时题',
      url: 'https://example.com/custom',
      difficulty: 2,
      estMinutes: 25,
      tags: ['数组'],
    },
  });
  const derived = deriveState([custom], [], baseConfig, '2026-11-17');
  const stats = computeStats([custom], [], baseConfig, '2026-11-17');

  assert.deepEqual(derived.ps, {});
  assert.equal(stats.totalAttempts, 1);
  assert.equal(stats.totalSolved, 1);
  assert.equal(stats.recent[0].title, '临时题');
});

test('到期盒子 0 题优先，且每日总数硬上限为三题', () => {
  const problems = [problem('p1'), problem('p2'), problem('p3'), problem('p4')];
  const { ps, ts } = deriveState(
    problems.map((p, index) => attempt(p.id, `2026-11-${10 + index}`, 'failed')),
    problems,
    baseConfig,
    '2026-11-17',
  );
  const plan = buildToday({
    problems,
    ps,
    ts,
    config: baseConfig,
    today: '2026-11-17',
    budget: 180,
    events: problems.map((p, index) => attempt(p.id, `2026-11-${10 + index}`, 'failed')),
    random: () => 0.5,
  });

  assert.equal(plan.items.length, 3);
  assert.ok(plan.items.every((item) => item.kind === 'review'));
  assert.match(plan.items[0].reason, /上次没做出来/);
});

test('同一道题失败后的打分高于独立做出后的打分', () => {
  const problems = [problem('fail'), problem('solved')];
  const events = [
    attempt('fail', '2026-11-10', 'failed'),
    attempt('solved', '2026-11-10', 'solved'),
  ];
  const { ps, ts } = deriveState(events, problems, baseConfig, '2026-11-17');
  const failedScore = scoreProblem(problems[0], ps, ts, baseConfig, events, '2026-11-17');
  const solvedScore = scoreProblem(problems[1], ps, ts, baseConfig, events, '2026-11-17');

  assert.ok(failedScore > solvedScore);
});

test('今日换掉的题不会再次进入今日推荐', () => {
  const problems = [problem('p1'), problem('p2')];
  const events = [
    {
      type: 'swap',
      id: 'swap-p1',
      ts: '2026-11-17T09:00:00+08:00',
      date: '2026-11-17',
      problemId: 'p1',
    },
  ];
  const { ps, ts } = deriveState(events, problems, baseConfig, '2026-11-17');
  const plan = buildToday({
    problems,
    ps,
    ts,
    config: baseConfig,
    today: '2026-11-17',
    budget: 180,
    events,
    random: () => 0.5,
  });

  assert.deepEqual(plan.items.map((item) => item.p.id), ['p2']);
});

test('换题会在三天内降低同一最弱标签题目的分数', () => {
  const sharedTagProblem = problem('p1', { tags: ['动态规划'] });
  const relatedProblem = problem('p2', { tags: ['动态规划'] });
  const unrelatedProblem = problem('p3', { tags: ['数组'] });
  const swap = {
    type: 'swap',
    id: 'swap-p1',
    ts: '2026-11-17T09:00:00+08:00',
    date: '2026-11-17',
    problemId: 'p1',
  };
  const { ps, ts } = deriveState([swap], [sharedTagProblem, relatedProblem], baseConfig, '2026-11-17');
  const affected = scoreProblem(
    relatedProblem,
    ps,
    ts,
    baseConfig,
    [swap],
    '2026-11-17',
    [sharedTagProblem, relatedProblem],
  );
  const unaffected = scoreProblem(
    unrelatedProblem,
    ps,
    ts,
    baseConfig,
    [swap],
    '2026-11-17',
    [sharedTagProblem, relatedProblem, unrelatedProblem],
  );

  assert.ok(affected < unaffected);
});

test('每日总上限可随配置提高，而不修改排题代码', () => {
  const problems = Array.from({ length: 8 }, (_, index) =>
    problem(`fill-${index}`, { estMinutes: 20 }),
  );
  const config = { ...baseConfig, maxDailyProblems: 4, maxNewPerDay: 4 };
  const plan = buildToday({
    problems,
    ps: {},
    ts: {},
    config,
    today: '2026-11-17',
    budget: 180,
    events: [],
    random: () => 0.5,
  });

  assert.equal(plan.items.length, 4);
});

test('相同日期和画像下每日前排题稳定', () => {
  const problems = Array.from({ length: 10 }, (_, index) =>
    problem(`stable-${index}`, {
      tags: [baseConfig.scopeTags[index % baseConfig.scopeTags.length]],
      estMinutes: 20,
    }),
  );
  const build = () =>
    buildToday({
      problems,
      ps: {},
      ts: {},
      config: baseConfig,
      today: '2026-11-17',
      budget: 90,
      events: [],
    }).items.map((item) => item.p.id);

  assert.deepEqual(build(), build());
});

test('计划快照只替换被换掉的一道题并保留其他卡片', () => {
  const problems = ['p1', 'p2', 'p3', 'p4'].map((id) => problem(id));
  const basePlan = {
    items: problems.slice(0, 3).map((item) => ({
      p: item,
      kind: 'new',
      reason: `推荐 ${item.id}`,
      estMinutes: 30,
    })),
    usedMinutes: 90,
    budget: 90,
  };
  const event = {
    type: 'plan',
    id: 'plan-1',
    date: '2026-11-17',
    ts: '2026-11-17T10:00:00+08:00',
    items: [
      { problemId: 'p1', kind: 'new', reason: '推荐 p1' },
      { problemId: 'p4', kind: 'new', reason: '替换 p2' },
      { problemId: 'p3', kind: 'new', reason: '推荐 p3' },
    ],
  };
  const applied = applyPlanSnapshot(basePlan, [event], problems, [], '2026-11-17');

  assert.deepEqual(applied.items.map((item) => item.p.id), ['p1', 'p4', 'p3']);
});

test('目标阶段标签提高候选匹配度，但仅从候选池应用', () => {
  const focused = problem('focused', { tags: ['动态规划'] });
  const generic = problem('generic', { tags: ['数组'] });
  const profile = {
    competition: '蓝桥杯',
    focusTags: ['动态规划'],
    preferredPlatforms: ['Codeforces'],
  };
  const phase = { focusTags: ['动态规划'] };

  assert.ok(
    scoreGoalMatch(focused, profile, phase) >
      scoreGoalMatch(generic, profile, phase),
  );
});

test('规划书根据目标日期生成连续且不越界的阶段', () => {
  const plan = generatePlanSkeleton({
    profile: {
      goalDate: '2027-01-16',
      weeklyMinutes: 300,
      focusTags: ['动态规划', '图论'],
    },
    today: '2026-11-17',
    scopeTags: baseConfig.scopeTags,
  });

  assert.equal(plan.startDate, '2026-11-17');
  assert.equal(plan.endDate, '2027-01-16');
  assert.equal(plan.phases.length, 3);
  assert.equal(plan.phases[0].startDate, plan.startDate);
  assert.equal(plan.phases.at(-1).endDate, plan.endDate);
  for (let index = 1; index < plan.phases.length; index++) {
    assert.equal(addDays(plan.phases[index - 1].endDate, 1), plan.phases[index].startDate);
  }
});

test('最近七天至少三个活跃日才能生成周报', () => {
  const twoDays = [
    attempt('p1', '2026-11-16', 'solved'),
    attempt('p2', '2026-11-17', 'failed'),
  ];
  const threeDays = [...twoDays, attempt('p3', '2026-11-15', 'solved')];

  assert.equal(weeklyEligibility(twoDays, '2026-11-17').eligible, false);
  assert.equal(weeklyEligibility(threeDays, '2026-11-17').eligible, true);
});

test('内置自愈题单完整包含在题库中且全库满足标签约束', () => {
  const fileProblems = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'data', 'problems.json'), 'utf8'),
  );
  const fileConfig = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'data', 'config.json'), 'utf8'),
  );
  const ids = new Set(fileProblems.map((item) => item.id));
  const coveredTags = new Set(fileProblems.flatMap((item) => item.tags));
  const difficulties = [1, 2, 3].map(
    (difficulty) => fileProblems.filter((item) => item.difficulty === difficulty).length,
  );

  const fileIds = new Set(fileProblems.map((item) => item.id));
  assert.ok(BUILTIN_PROBLEMS.every((item) => fileIds.has(item.id)));
  assert.ok(fileProblems.length >= 30);
  assert.equal(ids.size, fileProblems.length);
  assert.ok(coveredTags.size >= 15);
  assert.ok(difficulties.every((count) => count >= 10));
  assert.ok(
    fileProblems.every(
      (item) =>
        item.tags.every((tag) => fileConfig.scopeTags.includes(tag)) &&
        /^https:\/\//.test(item.url),
    ),
  );
});

test('只有回环地址拥有写入权限', () => {
  assert.equal(isLoopbackAddress('127.0.0.1'), true);
  assert.equal(isLoopbackAddress('::1'), true);
  assert.equal(isLoopbackAddress('::ffff:127.0.0.1'), true);
  assert.equal(isLoopbackAddress('192.168.1.8'), false);
  assert.equal(isLoopbackAddress('10.0.0.2'), false);
});

test('缺失数据目录会创建完整的空数据文件', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'algo-coach-init-'));
  try {
    ensureDataFiles(tempDir, {
      config: baseConfig,
      problems: [problem('p1')],
    });

    assert.equal(fs.existsSync(path.join(tempDir, 'config.json')), true);
    assert.equal(fs.existsSync(path.join(tempDir, 'problems.json')), true);
    assert.equal(fs.existsSync(path.join(tempDir, 'data.json')), true);
    assert.equal(fs.existsSync(path.join(tempDir, 'backup')), true);
    assert.equal(fs.existsSync(path.join(tempDir, 'plan.json')), true);
    assert.equal(fs.existsSync(path.join(tempDir, 'reports.json')), true);
    assert.equal(fs.existsSync(path.join(tempDir, 'problem-packs')), true);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(tempDir, 'data.json'), 'utf8')), {
      version: 1,
      events: [],
    });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('完整导出写入项目 exports 目录且不包含密钥字段', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'algo-coach-export-'));
  const dataDir = path.join(rootDir, 'data');
  try {
    ensureDataFiles(dataDir, { config: baseConfig, problems: [problem('p1')] });
    const result = writeExportBundle(rootDir, dataDir);
    const exported = JSON.parse(fs.readFileSync(result.filePath, 'utf8'));
    assert.equal(path.dirname(result.filePath), path.join(rootDir, 'exports'));
    assert.equal(exported.data.events.length, 0);
    assert.equal(exported.problems.length, 1);
    assert.equal(JSON.stringify(exported).includes('apiKey'), false);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('初始化不会覆盖用户已经手改的配置和题库', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'algo-coach-preserve-'));
  const customConfig = { ...baseConfig, dailyMinutes: 37 };
  fs.writeFileSync(path.join(tempDir, 'config.json'), JSON.stringify(customConfig));
  fs.writeFileSync(path.join(tempDir, 'problems.json'), JSON.stringify([]));
  try {
    ensureDataFiles(tempDir, { config: baseConfig, problems: [problem('p1')] });
    assert.equal(JSON.parse(fs.readFileSync(path.join(tempDir, 'config.json'), 'utf8')).dailyMinutes, 37);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(tempDir, 'problems.json'), 'utf8')), []);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('事件写入前备份，并且只保留最近五份', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'algo-coach-backup-'));
  try {
    ensureDataFiles(tempDir, {
      config: baseConfig,
      problems: [problem('p1')],
    });
    for (let index = 0; index < 7; index++) {
      appendEvent(
        tempDir,
        attempt('p1', '2026-11-17', 'solved', {
          id: `backup-event-${index}`,
          ts: `2026-11-17T12:00:0${index}+08:00`,
        }),
      );
    }

    const events = JSON.parse(fs.readFileSync(path.join(tempDir, 'data.json'), 'utf8')).events;
    const backups = fs.readdirSync(path.join(tempDir, 'backup')).filter((name) => name.endsWith('.json'));
    assert.equal(events.length, 7);
    assert.equal(backups.length, 5);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('原子写入遇到 Windows EXDEV 时回退为同目录复制', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'algo-coach-exdev-'));
  const target = path.join(tempDir, 'state.json');
  const fsOperations = {
    ...fs,
    renameSync() {
      const error = new Error('cross-device link not permitted');
      error.code = 'EXDEV';
      throw error;
    },
  };
  try {
    atomicWriteJson(target, { ok: true }, fsOperations);
    assert.deepEqual(JSON.parse(fs.readFileSync(target, 'utf8')), { ok: true });
    assert.equal(
      fs.readdirSync(tempDir).some((name) => name.endsWith('.tmp')),
      false,
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('AI 配置优先使用 DeepSeek 环境变量和默认模型', () => {
  const config = normalizeAiConfig(
    { baseUrl: '', model: '' },
    { DEEPSEEK_API_KEY: 'ds-key', OPENAI_API_KEY: 'other-key' },
  );

  assert.equal(config.baseUrl, 'https://api.deepseek.com');
  assert.equal(config.model, 'deepseek-flash');
  assert.equal(config.apiKey, 'ds-key');
  assert.equal(config.configured, true);
});

test('AI 结构化响应支持 JSON 代码围栏并校验日报字段', async () => {
  const fakeFetch = async () => ({
    ok: true,
    status: 200,
    async json() {
      return {
        choices: [
          {
            message: {
              content:
                '```json\n{"headline":"今天完成了复盘","facts":["完成 1 题"],"issues":["边界检查不足"],"tomorrowFocus":"先复习边界","encouragement":"继续保持记录"}\n```',
            },
          },
        ],
      };
    },
  });
  const report = await requestStructuredReport({
    config: {
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-flash',
      apiKey: 'test-key',
    },
    type: 'daily',
    input: { today: '2026-11-17', attempts: [] },
    fetchImpl: fakeFetch,
  });

  assert.equal(report.headline, '今天完成了复盘');
  assert.deepEqual(report.facts, ['完成 1 题']);
});

test('AI 选题结果只能包含候选池中的唯一题目', () => {
  const selected = validateAiSelection(
    {
      selections: [
        { problemId: 'p1', reason: '补强动态规划' },
        { problemId: 'unknown', reason: '不存在' },
        { problemId: 'p1', reason: '重复' },
      ],
    },
    ['p1', 'p2', 'p3'],
  );

  assert.deepEqual(selected.map((item) => item.problemId), ['p1']);
});

test('AI 题库元数据只能修改既有导入项和范围内标签', async () => {
  const fakeFetch = async () => ({
    ok: true,
    status: 200,
    async json() {
      return {
        choices: [{
          message: {
            content: JSON.stringify({
              problems: [
                { id: 'import-1', difficulty: 2, estMinutes: 45, tags: ['动态规划', '不存在的标签'] },
              ],
            }),
          },
        }],
      };
    },
  });
  const result = await requestProblemMetadata({
    config: { baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', apiKey: 'test-key' },
    problems: [{ id: 'import-1', title: '新题', url: 'https://example.com/p' }],
    scopeTags: ['动态规划', '图论'],
    fetchImpl: fakeFetch,
  });

  assert.deepEqual(result[0].tags, ['动态规划']);
  assert.equal(result[0].estMinutes, 45);
});

test('JSON 题库导入会拒绝非法链接并按 URL 去重', () => {
  const existing = [
    {
      id: 'old',
      title: '已有题',
      url: 'https://codeforces.com/problemset/problem/4/A',
      platform: 'Codeforces',
      difficulty: 1,
      estMinutes: 20,
      tags: ['数组'],
    },
  ];
  const result = importProblems(
    JSON.stringify([
      {
        title: '重复题',
        url: 'https://codeforces.com/problemset/problem/4/A',
        platform: 'Codeforces',
        difficulty: 1,
        tags: ['数组'],
      },
      {
        title: '新题',
        url: 'https://www.luogu.com.cn/problem/P1048',
        platform: '洛谷',
        difficulty: 2,
        tags: ['动态规划'],
        competitions: ['CCF CSP'],
        cspRole: '核心算法',
      },
      {
        title: '非法题',
        url: 'javascript:alert(1)',
        difficulty: 1,
        tags: ['数组'],
      },
    ]),
    existing,
    'json',
  );

  assert.equal(result.added.length, 1);
  assert.equal(result.added[0].title, '新题');
  assert.deepEqual(result.added[0].competitions, ['CCF CSP']);
  assert.equal(result.added[0].cspRole, '核心算法');
  assert.equal(result.duplicates, 1);
  assert.ok(result.errors.length >= 1);
});

test('CSV 题库支持带逗号的引用字段', () => {
  const rows = parseCsv(
    'title,url,platform,difficulty,estMinutes,tags\n"题目,带逗号",https://example.com/p,Codeforces,2,40,"数组;动态规划"\n',
  );

  assert.equal(rows[0].title, '题目,带逗号');
  assert.deepEqual(rows[0].tags, ['数组', '动态规划']);
});

test('换题接口只替换目标题并保持其他题不变', async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'algo-coach-swap-'));
  const dataDir = path.join(rootDir, 'data');
  const publicDir = path.join(rootDir, 'public');
  fs.mkdirSync(publicDir, { recursive: true });
  try {
    ensureDataFiles(dataDir, {
      config: { ...baseConfig, maxDailyProblems: 3, maxNewPerDay: 3 },
      problems: ['p1', 'p2', 'p3', 'p4', 'p5'].map((id) => problem(id)),
    });
    const server = createAppServer({ rootDir, dataDir, publicDir });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;
    try {
      const before = await (await fetch(`${baseUrl}/api/state`)).json();
      const beforeIds = before.plan.items.map((item) => item.p.id);
      const response = await fetch(`${baseUrl}/api/swap`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: '2026-11-17', problemId: beforeIds[0] }),
      });
      const after = await response.json();
      const afterIds = after.state.plan.items.map((item) => item.p.id);
      assert.notEqual(afterIds[0], beforeIds[0]);
      assert.deepEqual(afterIds.slice(1), beforeIds.slice(1));
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('画像接口保存目标并生成三段规划书', async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'algo-coach-profile-'));
  const dataDir = path.join(rootDir, 'data');
  const publicDir = path.join(rootDir, 'public');
  fs.mkdirSync(publicDir, { recursive: true });
  try {
    ensureDataFiles(dataDir, {
      config: baseConfig,
      problems: [problem('p1')],
    });
    const server = createAppServer({ rootDir, dataDir, publicDir });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    try {
      const response = await fetch(`${baseUrl}/api/profile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profile: {
            competition: '蓝桥杯',
            group: '大学 B 组',
            language: 'C++',
            goalDate: '2027-01-16',
            weeklyMinutes: 300,
            preferredPlatforms: ['洛谷', 'Codeforces'],
            focusTags: ['动态规划', '图论'],
            currentLevel: '普及组基础',
            notes: '',
          },
        }),
      });
      const payload = await response.json();
      assert.equal(response.status, 200);
      assert.equal(payload.state.config.profile.competition, '蓝桥杯');
      assert.equal(payload.state.practicePlan.phases.length, 3);
      assert.equal(payload.state.practicePlan.endDate, '2027-01-16');
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('记录接口保存用户选择的完成日期和时间', async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'algo-coach-time-'));
  const dataDir = path.join(rootDir, 'data');
  const publicDir = path.join(rootDir, 'public');
  fs.mkdirSync(publicDir, { recursive: true });
  try {
    ensureDataFiles(dataDir, {
      config: baseConfig,
      problems: [problem('p1')],
    });
    const server = createAppServer({ rootDir, dataDir, publicDir });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    try {
      const response = await fetch(`${baseUrl}/api/record`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          problemId: 'p1',
          completedAt: '2026-11-16T21:35',
          result: 'solved',
          minutes: 25,
          note: '用户补录的完成时间',
        }),
      });
      const payload = await response.json();
      assert.equal(response.status, 200);
      assert.equal(payload.event.date, '2026-11-16');
      assert.match(payload.event.ts, /^2026-11-16T21:35:00/);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

(async () => {
  let failures = 0;
  for (const { name, fn } of tests) {
    try {
      await fn();
      process.stdout.write(`PASS ${name}\n`);
    } catch (error) {
      failures++;
      process.stderr.write(`FAIL ${name}\n${error.stack}\n`);
    }
  }

  process.stdout.write(`\n${tests.length - failures} passed, ${failures} failed\n`);
  process.exitCode = failures ? 1 : 0;
})();
