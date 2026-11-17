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
} = require('./algo');
const {
  BUILTIN_PROBLEMS,
  ensureDataFiles,
  appendEvent,
  isLoopbackAddress,
} = require('./server');

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

test('内置自愈题单与题库文件一致且满足题单约束', () => {
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

  assert.deepEqual(BUILTIN_PROBLEMS, fileProblems);
  assert.equal(fileProblems.length, 30);
  assert.equal(ids.size, 30);
  assert.ok(coveredTags.size >= 15);
  assert.deepEqual(difficulties, [10, 10, 10]);
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
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(tempDir, 'data.json'), 'utf8')), {
      version: 1,
      events: [],
    });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
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

let failures = 0;
for (const { name, fn } of tests) {
  try {
    fn();
    process.stdout.write(`PASS ${name}\n`);
  } catch (error) {
    failures++;
    process.stderr.write(`FAIL ${name}\n${error.stack}\n`);
  }
}

process.stdout.write(`\n${tests.length - failures} passed, ${failures} failed\n`);
process.exitCode = failures ? 1 : 0;
