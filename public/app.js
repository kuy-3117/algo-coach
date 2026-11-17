'use strict';

const RESULT_LABELS = {
  solved: '独立做出',
  hinted: '提示后做出',
  saw_solution: '看了题解',
  failed: '没做出来',
};

const DIFFICULTY_LABELS = { 1: '简单', 2: '中等', 3: '困难' };
const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

let state = null;
let pendingItem = null;
let sessionCustomItems = [];
let toastTimer = null;

const elements = {
  tabs: [...document.querySelectorAll('.tab')],
  todayPanel: document.querySelector('#today-panel'),
  progressPanel: document.querySelector('#progress-panel'),
  readonlyBanner: document.querySelector('#readonly-banner'),
  exportButton: document.querySelector('#export-button'),
  todayDate: document.querySelector('#today-date'),
  budgetButton: document.querySelector('#budget-button'),
  budgetText: document.querySelector('#budget-text'),
  usedText: document.querySelector('#used-text'),
  streakText: document.querySelector('#streak-text'),
  planTotal: document.querySelector('#plan-total'),
  todayList: document.querySelector('#today-list'),
  todayEmpty: document.querySelector('#today-empty'),
  customButton: document.querySelector('#custom-button'),
  statAttempts: document.querySelector('#stat-attempts'),
  statMinutes: document.querySelector('#stat-minutes'),
  statStreak: document.querySelector('#stat-streak'),
  statWeek: document.querySelector('#stat-week'),
  heatmapGrid: document.querySelector('#heatmap-grid'),
  tagTableBody: document.querySelector('#tag-table-body'),
  recentList: document.querySelector('#recent-list'),
  recordDialog: document.querySelector('#record-dialog'),
  recordForm: document.querySelector('#record-form'),
  recordTitle: document.querySelector('#record-title'),
  recordMinutes: document.querySelector('#record-minutes'),
  recordNote: document.querySelector('#record-note'),
  saveRecordButton: document.querySelector('#save-record-button'),
  budgetDialog: document.querySelector('#budget-dialog'),
  budgetForm: document.querySelector('#budget-form'),
  budgetMinutes: document.querySelector('#budget-minutes'),
  customDialog: document.querySelector('#custom-dialog'),
  customForm: document.querySelector('#custom-form'),
  customTitle: document.querySelector('#custom-title'),
  customUrl: document.querySelector('#custom-url'),
  customMinutes: document.querySelector('#custom-minutes'),
  toast: document.querySelector('#toast'),
};

function formatToday(value) {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return `今天 ${month}月${day}日 ${WEEKDAY_LABELS[date.getDay()]}`;
}

function formatDate(value) {
  if (!value) {
    return '—';
  }
  const [, month, day] = value.split('-');
  return `${Number(month)}月${Number(day)}日`;
}

function percent(value) {
  return `${Math.round(value * 100)}%`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function showToast(message, isError = false) {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.toggle('is-error', isError);
  elements.toast.hidden = false;
  toastTimer = setTimeout(() => {
    elements.toast.hidden = true;
  }, isError ? 5000 : 2800);
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error('服务器返回了无法解析的响应');
  }
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || '请求失败');
  }
  return payload;
}

function allTodayItems() {
  return [...(state?.plan?.items || []), ...sessionCustomItems];
}

function difficultyBadge(problem) {
  const difficulty = DIFFICULTY_LABELS[problem.difficulty] || '适中';
  return `<span class="difficulty difficulty-${Number(problem.difficulty) || 2}">${difficulty}</span>`;
}

function renderToday() {
  const readOnly = state.readOnly;
  elements.readonlyBanner.hidden = !readOnly;
  elements.todayDate.textContent = formatToday(state.today);
  elements.budgetText.textContent = `预算 ${state.budget} 分钟`;
  elements.usedText.textContent = `已用 ${state.stats.todayMinutes}`;
  elements.streakText.textContent = `🔥 连续 ${state.stats.streak} 天`;
  elements.budgetButton.disabled = readOnly;
  elements.customButton.disabled = readOnly;

  const items = allTodayItems();
  elements.planTotal.textContent = items.length
    ? `${items.length} 道 · 预计 ${items.reduce((sum, item) => sum + item.estMinutes, 0)} 分钟`
    : '';

  elements.todayList.replaceChildren();
  for (const item of items) {
    const article = document.createElement('article');
    const difficulty = item.p.difficulty || 2;
    const tags = Array.isArray(item.p.tags) ? item.p.tags : [];
    article.className = `problem-card kind-${item.kind || 'new'}`;
    article.dataset.problemId = item.p.id;
    article.innerHTML = `
      <div class="card-top">
        <div>
          <h3 class="problem-title">${escapeHtml(item.p.title)}</h3>
          <p class="problem-platform">${escapeHtml(item.p.platform || '临时题')} · <span class="time-label">预计 ${item.estMinutes} 分钟</span></p>
        </div>
        ${difficultyBadge({ difficulty })}
      </div>
      <div class="tag-list">
        ${tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}
      </div>
      <p class="reason">${escapeHtml(item.reason)}</p>
      <div class="card-actions">
        <button class="button button-primary" type="button" data-action="open">打开题目</button>
        <button class="button button-secondary" type="button" data-action="record">记录</button>
      </div>
      <div class="card-actions">
        <button class="text-button" type="button" data-action="swap" ${item.kind === 'custom' ? 'hidden' : ''} ${readOnly ? 'disabled' : ''}>换一题</button>
      </div>
    `;
    article.querySelector('[data-action="open"]').addEventListener('click', () => {
      openProblem(item.p.url);
    });
    article.querySelector('[data-action="record"]').addEventListener('click', () => {
      openRecordDialog(item);
    });
    article.querySelector('[data-action="swap"]').addEventListener('click', () => {
      swapProblem(item);
    });
    elements.todayList.append(article);
  }

  elements.todayEmpty.hidden = items.length > 0;
  if (!items.length) {
    elements.todayEmpty.innerHTML = `
      <strong>今天的计划已经清空</strong>
      做得很好。继续保持这个节奏，明天再来处理新的复习和练习。
    `;
  }
}

function openProblem(url) {
  if (!url) {
    showToast('这道题没有可打开的链接', true);
    return;
  }
  window.open(url, '_blank', 'noopener');
}

function renderProgress() {
  elements.statAttempts.textContent = state.stats.totalAttempts;
  elements.statMinutes.textContent = state.stats.totalMinutes;
  elements.statStreak.textContent = state.stats.streak;
  elements.statWeek.textContent = state.stats.weekSolved;

  elements.heatmapGrid.replaceChildren();
  for (const day of state.stats.heatmap) {
    const cell = document.createElement('i');
    const level = Math.min(day.count, 4);
    cell.className = `heat-cell level-${level}`;
    cell.title = `${day.date} · ${day.count} 道`;
    elements.heatmapGrid.append(cell);
  }

  elements.tagTableBody.replaceChildren();
  if (!state.stats.tagStats.length) {
    elements.tagTableBody.innerHTML = `
      <tr><td colspan="5" class="muted">还没有知识点记录，完成第一道题后这里会开始积累。</td></tr>
    `;
  } else {
    for (const tag of state.stats.tagStats) {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td>${escapeHtml(tag.tag)}</td>
        <td class="mono">${tag.attempts}</td>
        <td class="mono">${percent(tag.passRate)}</td>
        <td>${formatDate(tag.lastDate)}</td>
        <td class="level-badge">${tag.level.toFixed(2)} / 3</td>
      `;
      elements.tagTableBody.append(row);
    }
  }

  elements.recentList.replaceChildren();
  if (!state.recent.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.innerHTML = '<strong>还没有记录</strong>完成今天的题并写下总结后，这里会留下真实的复盘。';
    elements.recentList.append(empty);
  } else {
    for (const recent of state.recent) {
      const article = document.createElement('article');
      article.className = 'recent-item';
      article.innerHTML = `
        <button class="recent-toggle" type="button" aria-expanded="false">
          <strong>${escapeHtml(recent.title)}</strong>
          <span>${RESULT_LABELS[recent.result] || recent.result}</span>
          <span>${recent.minutes} 分钟</span>
          <span>${formatDate(recent.date)}</span>
        </button>
        <p class="recent-note">${escapeHtml(recent.note)}</p>
      `;
      const toggle = article.querySelector('.recent-toggle');
      toggle.addEventListener('click', () => {
        const expanded = article.classList.toggle('is-expanded');
        toggle.setAttribute('aria-expanded', String(expanded));
      });
      elements.recentList.append(article);
    }
  }
}

function render() {
  if (!state) {
    return;
  }
  renderToday();
  renderProgress();
}

function switchTab(name) {
  for (const tab of elements.tabs) {
    const active = tab.dataset.tab === name;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', String(active));
  }
  elements.todayPanel.hidden = name !== 'today';
  elements.progressPanel.hidden = name !== 'progress';
}

function openRecordDialog(item) {
  if (state.readOnly) {
    showToast('当前设备只有查看权限', true);
    return;
  }
  pendingItem = item;
  elements.recordForm.reset();
  elements.recordTitle.textContent = item.p.title;
  elements.recordMinutes.value = item.estMinutes || 30;
  elements.recordDialog.showModal();
  setTimeout(() => elements.recordNote.focus(), 50);
}

async function submitRecord(event) {
  event.preventDefault();
  if (!pendingItem) {
    return;
  }
  const data = new FormData(elements.recordForm);
  const note = String(data.get('note') || '').trim();
  if (!note) {
    showToast('手写总结不能为空', true);
    elements.recordNote.focus();
    return;
  }
  const payload = {
    problemId: pendingItem.p.id,
    result: data.get('result'),
    stuckAt: data.getAll('stuckAt'),
    perceived: data.get('perceived') || null,
    minutes: Number(data.get('minutes')),
    note,
    date: state.today,
  };
  if (pendingItem.kind === 'custom') {
    payload.problemSnapshot = {
      title: pendingItem.p.title,
      url: pendingItem.p.url,
      platform: '临时题',
      difficulty: pendingItem.p.difficulty,
      estMinutes: pendingItem.estMinutes,
      tags: pendingItem.p.tags,
    };
  }

  elements.saveRecordButton.disabled = true;
  elements.saveRecordButton.textContent = '保存中…';
  try {
    const response = await api('/api/record', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    state = response.state;
    sessionCustomItems = sessionCustomItems.filter((item) => item.p.id !== pendingItem.p.id);
    elements.recordDialog.close();
    render();
    showToast('记录已保存，推荐已经重新计算');
  } catch (error) {
    showToast(error.message, true);
  } finally {
    elements.saveRecordButton.disabled = false;
    elements.saveRecordButton.textContent = '保存记录';
  }
}

async function swapProblem(item) {
  if (state.readOnly) {
    showToast('当前设备只有查看权限', true);
    return;
  }
  const button = elements.todayList.querySelector(
    `[data-problem-id="${CSS.escape(item.p.id)}"] [data-action="swap"]`,
  );
  if (button) {
    button.disabled = true;
    button.textContent = '正在换题…';
  }
  try {
    const response = await api('/api/swap', {
      method: 'POST',
      body: JSON.stringify({ problemId: item.p.id, date: state.today }),
    });
    state = response.state;
    render();
    showToast('已换一道，原题今天不再出现');
  } catch (error) {
    showToast(error.message, true);
    if (button) {
      button.disabled = false;
      button.textContent = '换一题';
    }
  }
}

async function submitBudget(event) {
  event.preventDefault();
  const minutes = Number(elements.budgetMinutes.value);
  try {
    const response = await api('/api/budget', {
      method: 'POST',
      body: JSON.stringify({ date: state.today, minutes }),
    });
    state = response.state;
    elements.budgetDialog.close();
    render();
    showToast(`今日预算已调整为 ${minutes} 分钟`);
  } catch (error) {
    showToast(error.message, true);
  }
}

function submitCustom(event) {
  event.preventDefault();
  const title = elements.customTitle.value.trim();
  const url = elements.customUrl.value.trim();
  const minutes = Math.max(1, Math.round(Number(elements.customMinutes.value)));
  if (!title || !/^https?:\/\//.test(url)) {
    showToast('请填写标题和有效的 http(s) 链接', true);
    return;
  }
  sessionCustomItems.push({
    p: {
      id: `custom-${Date.now()}`,
      title,
      url,
      platform: '临时题',
      difficulty: 2,
      tags: [],
    },
    kind: 'custom',
    reason: '你自己加入的临时题，只记录本次练习，不进入后续复习',
    estMinutes: minutes,
  });
  elements.customForm.reset();
  elements.customMinutes.value = 40;
  elements.customDialog.close();
  renderToday();
  showToast('临时题已加入今天');
}

async function loadState() {
  try {
    state = await api('/api/state');
    render();
  } catch (error) {
    showToast(`加载失败：${error.message}`, true);
    elements.todayList.innerHTML = `
      <div class="empty-state"><strong>无法加载数据</strong>${escapeHtml(error.message)}</div>
    `;
  }
}

for (const tab of elements.tabs) {
  tab.addEventListener('click', () => switchTab(tab.dataset.tab));
}

for (const closeButton of document.querySelectorAll('[data-close-dialog]')) {
  closeButton.addEventListener('click', () => {
    document.querySelector(`#${closeButton.dataset.closeDialog}`)?.close();
  });
}

elements.budgetButton.addEventListener('click', () => {
  elements.budgetMinutes.value = state.budget;
  elements.budgetDialog.showModal();
});
elements.customButton.addEventListener('click', () => elements.customDialog.showModal());
elements.exportButton.addEventListener('click', () => {
  window.location.assign('/api/export');
});
elements.recordForm.addEventListener('submit', submitRecord);
elements.budgetForm.addEventListener('submit', submitBudget);
elements.customForm.addEventListener('submit', submitCustom);

loadState();
