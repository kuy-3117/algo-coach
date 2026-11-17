'use strict';

const { hashString } = require('./algo');

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const source = String(text || '').replace(/^\uFEFF/, '');
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') {
        field += '"';
        index++;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  if (field || row.length) {
    row.push(field.replace(/\r$/, ''));
    rows.push(row);
  }
  if (!rows.length) {
    return [];
  }
  const headers = rows.shift().map((header) => header.trim());
  return rows
    .filter((cells) => cells.some((cell) => cell.trim()))
    .map((cells) =>
      Object.fromEntries(
        headers.map((header, index) => {
          const value = cells[index] ?? '';
          return [
            header,
            header.toLowerCase() === 'tags' || header === '标签'
              ? normalizeTags(value)
              : value,
          ];
        }),
      ),
    );
}

function normalizeTags(value) {
  if (Array.isArray(value)) {
    return value.map((tag) => String(tag).trim()).filter(Boolean);
  }
  return String(value || '')
    .split(/[;,，]/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function normalizeProblem(problem, index) {
  const title = String(problem.title || problem['标题'] || '').trim();
  const url = String(problem.url || problem['链接'] || '').trim();
  const platform = String(
    problem.platform || problem['平台'] || new URL(url).hostname,
  ).trim();
  if (!title) {
    throw new Error(`第 ${index + 1} 条缺少标题`);
  }
  if (!/^https?:\/\//i.test(url)) {
    throw new Error(`第 ${index + 1} 条链接必须是 http(s)`);
  }
  const difficultyValue = Number(problem.difficulty || problem['难度'] || 2);
  const difficulty = [1, 2, 3].includes(difficultyValue) ? difficultyValue : 2;
  const minutesValue = Number(problem.estMinutes || problem['预计用时'] || 0);
  const estMinutes = minutesValue > 0 ? Math.round(minutesValue) : { 1: 20, 2: 40, 3: 70 }[difficulty];
  return {
    id: String(
      problem.id ||
        `imported-${hashString(url.toLowerCase()).toString(36)}`,
    ).slice(0, 120),
    title: title.slice(0, 160),
    url,
    platform: platform.slice(0, 80),
    difficulty,
    estMinutes,
    tags: normalizeTags(problem.tags || problem['标签']),
    ...(Array.isArray(problem.competitions)
      ? {
          competitions: problem.competitions
            .filter((item) => typeof item === 'string')
            .slice(0, 10),
        }
      : {}),
    ...(problem.cspRole
      ? { cspRole: String(problem.cspRole).slice(0, 80) }
      : {}),
  };
}

function importProblems(text, existing = [], format = 'auto') {
  let rawItems;
  const trimmed = String(text || '').trim();
  const detectedFormat =
    format === 'auto' ? (trimmed.startsWith('[') || trimmed.startsWith('{') ? 'json' : 'csv') : format;
  try {
    if (detectedFormat === 'json') {
      const parsed = JSON.parse(trimmed);
      rawItems = Array.isArray(parsed) ? parsed : parsed.problems;
    } else {
      rawItems = parseCsv(trimmed);
    }
  } catch (error) {
    return { added: [], duplicates: 0, errors: [`导入内容解析失败：${error.message}`] };
  }
  if (!Array.isArray(rawItems)) {
    return { added: [], duplicates: 0, errors: ['导入内容必须是题目数组'] };
  }

  const knownIds = new Set(existing.map((item) => item.id));
  const knownUrls = new Set(existing.map((item) => item.url.toLowerCase().replace(/\/$/, '')));
  const added = [];
  const errors = [];
  let duplicates = 0;

  rawItems.forEach((rawItem, index) => {
    try {
      const normalized = normalizeProblem(rawItem, index);
      const urlKey = normalized.url.toLowerCase().replace(/\/$/, '');
      if (knownIds.has(normalized.id) || knownUrls.has(urlKey)) {
        duplicates++;
        return;
      }
      knownIds.add(normalized.id);
      knownUrls.add(urlKey);
      added.push(normalized);
    } catch (error) {
      errors.push(error.message);
    }
  });
  return { added, duplicates, errors };
}

module.exports = {
  importProblems,
  normalizeProblem,
  parseCsv,
};
