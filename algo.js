'use strict';

const DIFFICULTY_MINUTES = { 1: 20, 2: 40, 3: 70 };
const DIFFICULTY_LABELS = { 1: '简单', 2: '中等', 3: '困难' };

function pad(value) {
  return String(value).padStart(2, '0');
}

function localDate(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function parseLocalDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    throw new Error(`无效日期：${value}`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(year, month - 1, day);
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    throw new Error(`无效日期：${value}`);
  }
  return parsed;
}

function addDays(value, amount) {
  const date = parseLocalDate(value);
  date.setDate(date.getDate() + Number(amount));
  return localDate(date);
}

function daysBetween(from, to) {
  const start = parseLocalDate(from);
  const end = parseLocalDate(to);
  return Math.round((end.getTime() - start.getTime()) / 86400000);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function estMinutes(problem) {
  const value = Number(problem?.estMinutes);
  if (Number.isFinite(value) && value > 0) {
    return Math.round(value);
  }
  return DIFFICULTY_MINUTES[problem?.difficulty] || 40;
}

function weakestTag(problem, tagState = {}) {
  if (!Array.isArray(problem?.tags) || problem.tags.length === 0) {
    return null;
  }
  return problem.tags.reduce((weakest, tag) => {
    const level = tagState[tag]?.level ?? 2;
    const weakestLevel = tagState[weakest]?.level ?? 2;
    return level < weakestLevel ? tag : weakest;
  }, problem.tags[0]);
}

function deriveState(events, problems, config) {
  const ps = {};
  const ts = {};
  const problemMap = new Map(problems.map((problem) => [problem.id, problem]));

  for (const event of events) {
    if (event.type !== 'attempt') {
      continue;
    }
    const problem = problemMap.get(event.problemId);
    if (!problem) {
      continue;
    }

    const problemState = (ps[event.problemId] ??= {
      box: 0,
      attempts: 0,
      passes: 0,
      lastDate: null,
      lastResult: null,
    });
    problemState.attempts++;
    problemState.lastDate = event.date;
    problemState.lastResult = event.result;
    if (event.result === 'solved') {
      problemState.passes++;
      problemState.box = Math.min(problemState.box + 1, 4);
    } else {
      problemState.box = 0;
    }
    const interval = config.reviewIntervals[problemState.box] ?? config.reviewIntervals.at(-1) ?? 1;
    problemState.nextDue = addDays(event.date, interval);

    for (const tag of problem.tags || []) {
      const tagState = (ts[tag] ??= {
        attempts: 0,
        passes: 0,
        lastDate: null,
        level: 2,
      });
      tagState.attempts++;
      if (event.result === 'solved') {
        tagState.passes++;
      }
      tagState.lastDate = event.date;
      tagState.level = clamp(
        1 + (2 * (tagState.passes + 1)) / (tagState.attempts + 2),
        1,
        3,
      );
    }
  }

  return { ps, ts };
}

function eventDateSet(events) {
  return new Set(
    events
      .filter((event) => event.type === 'attempt' && typeof event.date === 'string')
      .map((event) => event.date),
  );
}

function computeStreak(events, today) {
  const dates = eventDateSet(events);
  let cursor = dates.has(today) ? today : addDays(today, -1);
  let streak = 0;
  while (dates.has(cursor)) {
    streak++;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

function startOfWeek(today) {
  const date = parseLocalDate(today);
  const weekday = date.getDay();
  const offset = weekday === 0 ? -6 : 1 - weekday;
  date.setDate(date.getDate() + offset);
  return localDate(date);
}

function buildHeatmap(events, today, days = 84) {
  const counts = new Map();
  for (const event of events) {
    if (event.type === 'attempt') {
      counts.set(event.date, (counts.get(event.date) || 0) + 1);
    }
  }

  const result = [];
  for (let offset = days - 1; offset >= 0; offset--) {
    const date = addDays(today, -offset);
    result.push({ date, count: counts.get(date) || 0 });
  }
  return result;
}

function getBudgetForDate(events, config, date) {
  let budget = Number(config.dailyMinutes) || 90;
  for (const event of events) {
    if (event.type === 'budget' && event.date === date && Number.isFinite(event.minutes)) {
      budget = event.minutes;
    }
  }
  return budget;
}

function enrichRecent(events, problems) {
  const problemMap = new Map(problems.map((problem) => [problem.id, problem]));
  return events
    .filter((event) => event.type === 'attempt')
    .slice()
    .sort((a, b) => String(b.ts).localeCompare(String(a.ts)))
    .slice(0, 20)
    .map((event) => {
      const problem = problemMap.get(event.problemId);
      const snapshot = event.problemSnapshot || {};
      return {
        ...event,
        title: problem?.title || snapshot.title || event.problemId,
        url: problem?.url || snapshot.url || '',
        platform: problem?.platform || snapshot.platform || (event.problemSnapshot ? '临时题' : '未知来源'),
        tags: problem?.tags || snapshot.tags || [],
        isCustom: !problem && Boolean(event.problemSnapshot),
      };
    });
}

function computeStats(events, problems, config, today) {
  const { ts } = deriveState(events, problems, config);
  const attempts = events.filter((event) => event.type === 'attempt');
  const solved = attempts.filter((event) => event.result === 'solved');
  const weekStart = startOfWeek(today);
  const weekSolved = solved.filter(
    (event) => event.date >= weekStart && event.date <= today,
  ).length;

  const tagStats = Object.entries(ts)
    .map(([tag, state]) => ({
      tag,
      attempts: state.attempts,
      passes: state.passes,
      passRate: state.attempts ? state.passes / state.attempts : 0,
      lastDate: state.lastDate,
      level: state.level,
    }))
    .sort((a, b) => a.level - b.level || b.attempts - a.attempts);

  return {
    streak: computeStreak(events, today),
    totalAttempts: attempts.length,
    totalSolved: solved.length,
    totalMinutes: attempts.reduce(
      (total, event) => total + (Number.isFinite(Number(event.minutes)) ? Number(event.minutes) : 0),
      0,
    ),
    weekSolved,
    todayMinutes: attempts
      .filter((event) => event.date === today)
      .reduce((total, event) => total + (Number(event.minutes) || 0), 0),
    todaySolved: solved.filter((event) => event.date === today).length,
    heatmap: buildHeatmap(events, today),
    tagStats,
    recent: enrichRecent(events, problems),
  };
}

function problemPassRate(problem, ps, ts) {
  const own = ps[problem.id];
  if (own?.attempts) {
    return own.passes / own.attempts;
  }
  const tag = weakestTag(problem, ts);
  const tagState = tag ? ts[tag] : null;
  if (tagState?.attempts) {
    return tagState.passes / tagState.attempts;
  }
  return 0.5;
}

function recentSwapPenalty(problem, events, today, problems = [], ts = {}) {
  const weakTag = weakestTag(problem, ts);
  return events.some((event) => {
    if (event.type !== 'swap' || !event.date) {
      return false;
    }
    const days = daysBetween(event.date, today);
    if (days < 0 || days > 2) {
      return false;
    }
    if (event.problemId === problem.id) {
      return true;
    }
    const swappedProblem = problems.find((candidate) => candidate.id === event.problemId);
    return Boolean(
      weakTag &&
      swappedProblem &&
      weakestTag(swappedProblem, ts) === weakTag,
    );
  });
}

function isSwappedForToday(problemId, events, today) {
  return events.some(
    (event) => event.type === 'swap' && event.date === today && event.problemId === problemId,
  );
}

function scoreProblem(problem, ps, ts, config, events = [], today, problems = []) {
  const weights = config.weights;
  const passRate = problemPassRate(problem, ps, ts);
  const own = ps[problem.id];
  const fresh = own?.lastDate && today
    ? Math.min(Math.max(daysBetween(own.lastDate, today), 0), 14) / 14
    : 1;
  const weakTag = weakestTag(problem, ts);
  const level = ts[weakTag]?.level ?? 2;
  const levelFit = 1 - Math.abs(problem.difficulty - level) / 3;
  const prerequisite = 1 - (level - 1) / 2;
  let score =
    weights.weak * (1 - passRate) +
    weights.fresh * fresh +
    weights.level * levelFit +
    weights.prereq * prerequisite;

  if (today && recentSwapPenalty(problem, events, today, problems, ts)) {
    score *= 0.5;
  }
  return clamp(score, 0, 1);
}

function reviewReason(problem, state, today) {
  const overdue = Math.max(daysBetween(state.nextDue, today), 0);
  let reason = '继续复习';
  if (state.box === 0) {
    if (state.lastResult === 'saw_solution') {
      reason = '上次看了题解，今天重新复习';
    } else if (state.lastResult === 'hinted') {
      reason = '上次需要提示，今天再独立做一遍';
    } else {
      reason = '上次没做出来，今天必须再过一遍';
    }
  } else {
    reason = `上次独立做出，按期复习（第 ${state.attempts + 1} 次）`;
  }
  return overdue ? `${reason}，已逾期 ${overdue} 天` : reason;
}

function newReason(problem, ps, ts) {
  const tag = weakestTag(problem, ts) || problem.tags?.[0] || '目标范围';
  const state = ts[tag];
  const difficulty = DIFFICULTY_LABELS[problem.difficulty] || '合适';
  if (!state?.attempts) {
    return `新知识点「${tag}」还没练过，从这个${difficulty}难度切入`;
  }
  const passRate = state.passes / state.attempts;
  if (passRate < 0.6) {
    return `「${tag}」通过率 ${Math.round(passRate * 100)}%，最近没练，推一道${difficulty}题`;
  }
  return `「${tag}」需要继续巩固，推一道${difficulty}题`;
}

function buildToday({
  problems,
  ps,
  ts,
  config,
  today,
  budget,
  events = [],
  random = Math.random,
}) {
  const picked = [];
  const pickedIds = new Set();
  const maxProblems = Math.max(1, Number(config.maxDailyProblems) || 3);
  let used = 0;
  const canFit = (problem, multiplier = 1.2) =>
    used + estMinutes(problem) <= Number(budget) * multiplier;

  const due = problems
    .filter(
      (problem) =>
        ps[problem.id]?.nextDue &&
        ps[problem.id].nextDue <= today &&
        !isSwappedForToday(problem.id, events, today),
    )
    .sort((left, right) => {
      const a = ps[left.id];
      const b = ps[right.id];
      if (a.box !== b.box) {
        return a.box - b.box;
      }
      return daysBetween(b.nextDue, today) - daysBetween(a.nextDue, today);
    });

  for (const problem of due) {
    if (picked.length >= maxProblems) {
      break;
    }
    const state = ps[problem.id];
    const reviewLimit = Number(budget) * Number(config.reviewRatio);
    if (state.box === 0 || used + estMinutes(problem) <= reviewLimit) {
      picked.push({ p: problem, kind: 'review', reason: reviewReason(problem, state, today) });
      pickedIds.add(problem.id);
      used += estMinutes(problem);
    }
  }

  const coldTags = Object.entries(ts)
    .filter(
      ([tag, state]) =>
        config.scopeTags.includes(tag) &&
        state.lastDate &&
        daysBetween(state.lastDate, today) > config.tagColdDays &&
        state.level < 2.5,
    )
    .sort(
      (left, right) =>
        daysBetween(right[1].lastDate, today) - daysBetween(left[1].lastDate, today),
    )
    .slice(0, 2);

  for (const [tag, state] of coldTags) {
    if (picked.length >= maxProblems) {
      break;
    }
    const candidate = problems
      .filter(
        (problem) =>
          problem.tags.includes(tag) &&
          !pickedIds.has(problem.id) &&
          !ps[problem.id]?.nextDue &&
          !isSwappedForToday(problem.id, events, today),
      )
      .sort((a, b) => b.difficulty - a.difficulty)[0];
    if (candidate && canFit(candidate)) {
      picked.push({
        p: candidate,
        kind: 'cold_tag',
        reason: `「${tag}」已经 ${daysBetween(state.lastDate, today)} 天没碰了，加一道`,
      });
      pickedIds.add(candidate.id);
      used += estMinutes(candidate);
    }
  }

  const pool = problems.filter((problem) => {
    const state = ps[problem.id];
    const inScope = problem.tags.some((tag) => config.scopeTags.includes(tag));
    const recentlyDone =
      state?.lastDate &&
      daysBetween(state.lastDate, today) >= 0 &&
      daysBetween(state.lastDate, today) <= config.recentDays;
    return (
      inScope &&
      !pickedIds.has(problem.id) &&
      !state?.nextDue &&
      !recentlyDone &&
      (state?.box ?? 0) < 4 &&
      !isSwappedForToday(problem.id, events, today)
    );
  });

  const scored = pool
    .map((problem) => ({
      p: problem,
      score:
        scoreProblem(problem, ps, ts, config, events, today, problems) *
        (0.9 + random() * 0.2),
    }))
    .sort((left, right) => right.score - left.score);

  let newCount = 0;
  for (const candidate of scored) {
    if (picked.length >= maxProblems || newCount >= config.maxNewPerDay) {
      break;
    }
    if (!canFit(candidate.p)) {
      continue;
    }
    picked.push({
      p: candidate.p,
      kind: 'new',
      score: candidate.score,
      reason: newReason(candidate.p, ps, ts),
    });
    pickedIds.add(candidate.p.id);
    used += estMinutes(candidate.p);
    newCount++;
  }

  return {
    items: picked.map((item) => ({ ...item, estMinutes: estMinutes(item.p) })),
    usedMinutes: used,
    budget,
    maxProblems,
  };
}

module.exports = {
  DIFFICULTY_MINUTES,
  addDays,
  buildHeatmap,
  buildToday,
  clamp,
  computeStats,
  daysBetween,
  deriveState,
  estMinutes,
  getBudgetForDate,
  isSwappedForToday,
  localDate,
  problemPassRate,
  scoreProblem,
  startOfWeek,
  weakestTag,
};
