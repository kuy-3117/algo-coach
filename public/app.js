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
let pendingAiSelections = [];
let importTextValue = '';
let toastTimer = null;
const desktopApi = window.algoCoachDesktop || null;

const $ = (selector) => document.querySelector(selector);
const elements = {
  tabs: [...document.querySelectorAll('.tab')],
  panels: {
    today: $('#today-panel'),
    plan: $('#plan-panel'),
    review: $('#review-panel'),
    progress: $('#progress-panel'),
  },
  readonlyBanner: $('#readonly-banner'),
  exportButton: $('#export-button'),
  todayDate: $('#today-date'),
  phaseLabel: $('#phase-label'),
  budgetButton: $('#budget-button'),
  budgetText: $('#budget-text'),
  usedText: $('#used-text'),
  streakText: $('#streak-text'),
  planTotal: $('#plan-total'),
  todayList: $('#today-list'),
  todayEmpty: $('#today-empty'),
  customButton: $('#custom-button'),
  aiSelectButton: $('#ai-select-button'),
  profileForm: $('#profile-form'),
  planBookContent: $('#plan-book-content'),
  regeneratePlanButton: $('#regenerate-plan-button'),
  aiStatus: $('#ai-status'),
  desktopSecurity: $('#desktop-security'),
  desktopApiKey: $('#desktop-api-key'),
  desktopKeyStatus: $('#desktop-key-status'),
  saveDesktopKeyButton: $('#save-desktop-key-button'),
  clearDesktopKeyButton: $('#clear-desktop-key-button'),
  openDataFolderButton: $('#open-data-folder-button'),
  openExportsFolderButton: $('#open-exports-folder-button'),
  aiBaseUrl: $('#ai-base-url'),
  aiModel: $('#ai-model'),
  saveAiSettingsButton: $('#save-ai-settings-button'),
  importText: $('#import-text'),
  importFile: $('#import-file'),
  importEnrichAi: $('#import-enrich-ai'),
  previewImportButton: $('#preview-import-button'),
  confirmImportButton: $('#confirm-import-button'),
  importResult: $('#import-result'),
  reviewIntro: $('#review-intro'),
  dailyReportButton: $('#daily-report-button'),
  weeklyReportButton: $('#weekly-report-button'),
  weeklyEligibility: $('#weekly-eligibility'),
  reportList: $('#report-list'),
  statAttempts: $('#stat-attempts'),
  statMinutes: $('#stat-minutes'),
  statStreak: $('#stat-streak'),
  statWeek: $('#stat-week'),
  heatmapGrid: $('#heatmap-grid'),
  tagTableBody: $('#tag-table-body'),
  recentList: $('#recent-list'),
  recordDialog: $('#record-dialog'),
  recordForm: $('#record-form'),
  recordTitle: $('#record-title'),
  recordCompletedAt: $('#record-completed-at'),
  recordMinutes: $('#record-minutes'),
  recordNote: $('#record-note'),
  saveRecordButton: $('#save-record-button'),
  budgetDialog: $('#budget-dialog'),
  budgetForm: $('#budget-form'),
  budgetMinutes: $('#budget-minutes'),
  customDialog: $('#custom-dialog'),
  customForm: $('#custom-form'),
  customTitle: $('#custom-title'),
  customUrl: $('#custom-url'),
  customMinutes: $('#custom-minutes'),
  aiSelectionDialog: $('#ai-selection-dialog'),
  aiSelectionList: $('#ai-selection-list'),
  applyAiSelectionButton: $('#apply-ai-selection-button'),
  toast: $('#toast'),
};

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function localDateTimeInput(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatToday(value) {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return `今天 ${month}月${day}日 ${WEEKDAY_LABELS[date.getDay()]}`;
}

function formatDate(value) {
  if (!value) return '—';
  const [, month, day] = value.split('-');
  return `${Number(month)}月${Number(day)}日`;
}

function formatRecordTime(value) {
  if (!value) return '';
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!match) return value;
  return `${Number(match[2])}月${Number(match[3])}日 ${match[4]}:${match[5]}`;
}

function percent(value) {
  return `${Math.round(Number(value) * 100)}%`;
}

function splitTags(value) {
  return String(value || '')
    .split(/[,，]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function showToast(message, isError = false) {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.toggle('is-error', isError);
  elements.toast.hidden = false;
  toastTimer = setTimeout(() => {
    elements.toast.hidden = true;
  }, isError ? 6000 : 3000);
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
    throw new Error(payload.error || `请求失败（${response.status}）`);
  }
  return payload;
}

function allTodayItems() {
  return [...(state?.plan?.items || []), ...sessionCustomItems];
}

function switchTab(name) {
  for (const tab of elements.tabs) {
    const active = tab.dataset.tab === name;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', String(active));
  }
  for (const [panelName, panel] of Object.entries(elements.panels)) {
    panel.hidden = panelName !== name;
  }
}

function renderToday() {
  const readOnly = state.readOnly;
  elements.readonlyBanner.hidden = !readOnly;
  elements.todayDate.textContent = formatToday(state.today);
  elements.phaseLabel.textContent = state.activePhase
    ? `当前阶段：${state.activePhase.name} · 重点 ${state.activePhase.focusTags.join('、') || '综合练习'}`
    : '先到“计划”页确定目标和可用时间。';
  elements.budgetText.textContent = `预算 ${state.budget} 分钟`;
  elements.usedText.textContent = `已用 ${state.stats.todayMinutes}`;
  elements.streakText.textContent = `🔥 连续 ${state.stats.streak} 天`;
  elements.budgetButton.disabled = readOnly;
  elements.customButton.disabled = readOnly;
  elements.aiSelectButton.disabled = readOnly || !state.ai.configured;
  if (!state.ai.configured) {
    elements.aiSelectButton.title = '请先配置 DeepSeek 密钥';
  }

  const items = allTodayItems();
  elements.planTotal.textContent = items.length
    ? `${items.length} 道 · 预计 ${items.reduce((sum, item) => sum + item.estMinutes, 0)} 分钟`
    : '';
  elements.todayList.replaceChildren();

  items.forEach((item, index) => {
    const article = document.createElement('article');
    const tags = Array.isArray(item.p.tags) ? item.p.tags : [];
    article.className = `problem-card kind-${item.kind || 'new'}`;
    article.dataset.problemId = item.p.id;
    article.innerHTML = `
      <div class="card-number">${String(index + 1).padStart(2, '0')}</div>
      <div class="card-top">
        <div>
          <h3 class="problem-title">${escapeHtml(item.p.title)}</h3>
          <p class="problem-platform">${escapeHtml(item.p.platform || '临时题')} · <span class="time-label">预计 ${item.estMinutes} 分钟</span></p>
        </div>
        <span class="difficulty difficulty-${item.p.difficulty || 2}">
          ${DIFFICULTY_LABELS[item.p.difficulty] || '中等'}
        </span>
      </div>
      <div class="tag-list">${tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}</div>
      <p class="reason">${escapeHtml(item.reason)}</p>
      <div class="card-actions">
        <button class="button button-primary" type="button" data-action="open">打开题目</button>
        <button class="button button-secondary" type="button" data-action="record" ${readOnly ? 'disabled' : ''}>记录</button>
      </div>
      <div class="card-actions">
        <button class="text-button" type="button" data-action="swap" ${item.kind === 'custom' || readOnly ? 'disabled' : ''}>换一题</button>
      </div>
    `;
    article.querySelector('[data-action="open"]').addEventListener('click', () => openProblem(item.p.url));
    article.querySelector('[data-action="record"]').addEventListener('click', () => openRecordDialog(item));
    article.querySelector('[data-action="swap"]').addEventListener('click', () => swapProblem(item));
    elements.todayList.append(article);
  });

  elements.todayEmpty.hidden = items.length > 0;
  if (!items.length) {
    elements.todayEmpty.innerHTML = `
      <strong>今天的计划已经清空</strong>
      记录已经保存。可以到“复盘”页生成一次 AI 简报，或者继续临时加一道题。
    `;
  }
}

function renderPlan() {
  const profile = state.config.profile || {};
  if (!elements.profileForm.contains(document.activeElement)) {
    for (const [key, value] of Object.entries(profile)) {
      const field = elements.profileForm.elements.namedItem(key);
      if (!field) continue;
      if (key === 'preferredPlatforms' || key === 'focusTags') {
        field.value = Array.isArray(value) ? value.join(', ') : value || '';
      } else {
        field.value = value ?? '';
      }
    }
  }

  elements.aiBaseUrl.value = state.ai.baseUrl;
  elements.aiModel.value = state.ai.model;
  elements.desktopSecurity.hidden = !desktopApi;
  if (desktopApi) refreshDesktopKeyStatus();
  elements.aiStatus.textContent = state.ai.configured
    ? `DeepSeek 兼容接口已连接配置：${state.ai.model}`
    : '尚未检测到 DeepSeek 密钥。请在 Windows 用户环境变量中设置 DEEPSEEK_API_KEY 后重启服务。';
  elements.aiStatus.classList.toggle('is-ready', state.ai.configured);

  const plan = state.practicePlan;
  if (!plan || !plan.phases.length) {
    elements.planBookContent.innerHTML = `
      <div class="empty-state">
        <strong>还没有规划书</strong>
        填写目标日期和每周可用时间后保存画像，系统会先按时间生成可执行骨架。
      </div>
    `;
    return;
  }
  elements.planBookContent.innerHTML = `
    <p class="muted mono">${plan.startDate} → ${plan.endDate} · 每周 ${plan.weeklyMinutes} 分钟</p>
    <div class="phase-list">
      ${plan.phases.map((phase) => `
        <article class="phase-card ${state.activePhase?.id === phase.id ? 'is-current' : ''}">
          <div class="phase-date">${phase.startDate} → ${phase.endDate}</div>
          <h4>${escapeHtml(phase.name)} ${state.activePhase?.id === phase.id ? '· 进行中' : ''}</h4>
          <div class="phase-meta">重点：${escapeHtml(phase.focusTags.join('、') || '综合巩固')}</div>
          <ul class="milestone-list">
            ${phase.milestones.map((milestone) => `<li>${escapeHtml(milestone)}</li>`).join('')}
          </ul>
        </article>
      `).join('')}
    </div>
  `;
}

async function refreshDesktopKeyStatus() {
  if (!desktopApi) return;
  try {
    const status = await desktopApi.getApiKeyStatus();
    elements.desktopKeyStatus.textContent = status.configured
      ? `密钥已保存${status.encryptedAtRest ? '（Windows 加密存储）' : ''}`
      : '尚未保存 API Key；本地功能仍可正常使用。';
    elements.clearDesktopKeyButton.disabled = !status.configured;
  } catch (error) {
    elements.desktopKeyStatus.textContent = `无法读取密钥状态：${error.message}`;
  }
}

async function saveDesktopKey() {
  if (!desktopApi) return;
  const key = elements.desktopApiKey.value.trim();
  if (!key) return showToast('请输入 API Key', true);
  elements.saveDesktopKeyButton.disabled = true;
  try {
    await desktopApi.saveApiKey(key);
    elements.desktopApiKey.value = '';
    await refreshDesktopKeyStatus();
    await loadState();
    showToast('API Key 已安全保存');
  } catch (error) {
    showToast(error.message, true);
  } finally {
    elements.saveDesktopKeyButton.disabled = false;
  }
}

async function clearDesktopKey() {
  if (!desktopApi) return;
  try {
    await desktopApi.clearApiKey();
    await refreshDesktopKeyStatus();
    await loadState();
    showToast('API Key 已从本机清除');
  } catch (error) {
    showToast(error.message, true);
  }
}

function reportList(items) {
  if (!Array.isArray(items) || !items.length) return '';
  return `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
}

function reportCard(report) {
  const content = report.content || {};
  if (report.type === 'weekly') {
    return `
      <article class="report-card weekly">
        <header>
          <div><h3>${escapeHtml(content.verdict)}</h3><div class="report-meta">${report.periodStart} → ${report.periodEnd} · ${escapeHtml(report.model)}</div></div>
          <span class="tag">近 7 天周报</span>
        </header>
        <div class="report-section"><h4>数据事实</h4>${reportList(content.facts)}</div>
        <div class="report-section"><h4>关键问题</h4>${reportList(content.criticalIssues)}</div>
        <div class="report-section"><h4>行为模式</h4>${reportList(content.patterns)}</div>
        <div class="report-section"><h4>下周行动</h4>${reportList((content.nextWeekPlan || []).map((item) => `${item.tag}：${item.action}（${item.target}）`))}</div>
        <div class="report-risk"><strong>风险提示：</strong>${escapeHtml(content.risk)}</div>
      </article>
    `;
  }
  return `
    <article class="report-card">
      <header>
        <div><h3>${escapeHtml(content.headline)}</h3><div class="report-meta">${report.periodStart} · ${escapeHtml(report.model)}</div></div>
        <span class="tag">今日简报</span>
      </header>
      <div class="report-section"><h4>数据事实</h4>${reportList(content.facts)}</div>
      <div class="report-section"><h4>需要警惕</h4>${reportList(content.issues)}</div>
      <div class="report-section"><h4>明天重点</h4><p>${escapeHtml(content.tomorrowFocus)}</p></div>
      <p class="muted">${escapeHtml(content.encouragement)}</p>
    </article>
  `;
}

function renderReview() {
  const eligible = state.weeklyEligibility;
  elements.reviewIntro.textContent = state.ai.configured
    ? `将使用 ${state.ai.model} 分析结果、卡点、用时和手写总结。生成前不会发送数据。`
    : '尚未配置 AI 密钥，复盘按钮暂不可用。';
  elements.dailyReportButton.disabled =
    state.readOnly || !state.ai.configured || state.stats.totalAttempts === 0;
  elements.weeklyReportButton.disabled =
    state.readOnly || !state.ai.configured || !eligible.eligible;
  elements.weeklyEligibility.textContent =
    `最近 7 天有 ${eligible.activeDays} 个活跃日，${eligible.eligible ? '可以生成周报。' : '至少需要 3 个活跃日。'}`;
  elements.reportList.replaceChildren();
  if (!state.recentReports.length) {
    elements.reportList.innerHTML = `
      <div class="empty-state"><strong>还没有 AI 复盘</strong>完成练习后点击上方按钮生成第一份报告。</div>
    `;
    return;
  }
  for (const report of state.recentReports) {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = reportCard(report);
    elements.reportList.append(wrapper.firstElementChild);
  }
}

function renderProgress() {
  elements.statAttempts.textContent = state.stats.totalAttempts;
  elements.statMinutes.textContent = state.stats.totalMinutes;
  elements.statStreak.textContent = state.stats.streak;
  elements.statWeek.textContent = state.stats.weekSolved;

  elements.heatmapGrid.replaceChildren();
  for (const day of state.stats.heatmap) {
    const cell = document.createElement('i');
    cell.className = `heat-cell level-${Math.min(day.count, 4)}`;
    cell.title = `${day.date} · ${day.count} 道`;
    elements.heatmapGrid.append(cell);
  }

  elements.tagTableBody.replaceChildren();
  if (!state.stats.tagStats.length) {
    elements.tagTableBody.innerHTML = '<tr><td colspan="5" class="muted">还没有知识点记录。</td></tr>';
  } else {
    for (const tag of state.stats.tagStats) {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td>${escapeHtml(tag.tag)}</td><td class="mono">${tag.attempts}</td>
        <td class="mono">${percent(tag.passRate)}</td><td>${formatDate(tag.lastDate)}</td>
        <td class="level-badge">${tag.level.toFixed(2)} / 3</td>
      `;
      elements.tagTableBody.append(row);
    }
  }

  elements.recentList.replaceChildren();
  if (!state.recent.length) {
    elements.recentList.innerHTML = '<div class="empty-state"><strong>还没有记录</strong>完成第一道题后会在这里留下复盘。</div>';
  } else {
    for (const recent of state.recent) {
      const article = document.createElement('article');
      article.className = 'recent-item';
      article.innerHTML = `
        <button class="recent-toggle" type="button" aria-expanded="false">
          <strong>${escapeHtml(recent.title)}</strong>
          <span>${RESULT_LABELS[recent.result] || recent.result}</span>
          <span>${recent.minutes} 分钟</span>
          <span>${formatRecordTime(recent.ts)}</span>
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
  if (!state) return;
  renderToday();
  renderPlan();
  renderReview();
  renderProgress();
}

function openProblem(url) {
  if (!url) {
    showToast('这道题没有可打开的链接', true);
    return;
  }
  window.open(url, '_blank', 'noopener');
}

function openRecordDialog(item) {
  if (state.readOnly) return showToast('当前设备只有查看权限', true);
  pendingItem = item;
  elements.recordForm.reset();
  elements.recordTitle.textContent = item.p.title;
  elements.recordMinutes.value = item.estMinutes || 30;
  elements.recordCompletedAt.value = localDateTimeInput();
  elements.recordDialog.showModal();
  setTimeout(() => elements.recordNote.focus(), 50);
}

async function submitRecord(event) {
  event.preventDefault();
  if (!pendingItem) return;
  const data = new FormData(elements.recordForm);
  const note = String(data.get('note') || '').trim();
  if (!note) return showToast('手写总结不能为空', true);
  const payload = {
    problemId: pendingItem.p.id,
    completedAt: data.get('completedAt'),
    result: data.get('result'),
    stuckAt: data.getAll('stuckAt'),
    perceived: data.get('perceived') || null,
    minutes: Number(data.get('minutes')),
    note,
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
    const response = await api('/api/record', { method: 'POST', body: JSON.stringify(payload) });
    state = response.state;
    sessionCustomItems = sessionCustomItems.filter((item) => item.p.id !== pendingItem.p.id);
    elements.recordDialog.close();
    render();
    showToast('记录已保存。可以去“复盘”生成 AI 今日简报。');
  } catch (error) {
    showToast(error.message, true);
  } finally {
    elements.saveRecordButton.disabled = false;
    elements.saveRecordButton.textContent = '保存记录';
  }
}

async function swapProblem(item) {
  if (state.readOnly) return showToast('当前设备只有查看权限', true);
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
    showToast('只替换了这道题，其他计划保持不变');
  } catch (error) {
    showToast(error.message, true);
    render();
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
  if (!title || !/^https?:\/\//.test(url)) return showToast('请填写标题和有效链接', true);
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
    reason: '你自己加入的临时题，不进入后续自动复习',
    estMinutes: minutes,
  });
  elements.customForm.reset();
  elements.customMinutes.value = 40;
  elements.customDialog.close();
  renderToday();
  showToast('临时题已加入今天');
}

async function submitProfile(event) {
  event.preventDefault();
  const data = new FormData(elements.profileForm);
  const profile = Object.fromEntries(data.entries());
  profile.weeklyMinutes = Number(profile.weeklyMinutes);
  profile.preferredPlatforms = splitTags(profile.preferredPlatforms);
  profile.focusTags = splitTags(profile.focusTags);
  try {
    const response = await api('/api/profile', {
      method: 'POST',
      body: JSON.stringify({ profile, generatePlan: true }),
    });
    state = response.state;
    render();
    showToast(profile.goalDate ? '画像已保存，规划书已生成' : '画像已保存，请补充目标日期');
  } catch (error) {
    showToast(error.message, true);
  }
}

async function regeneratePlan() {
  try {
    const response = await api('/api/plan/generate', { method: 'POST', body: '{}' });
    state = response.state;
    render();
    showToast('规划书已按最新画像重新生成');
  } catch (error) {
    showToast(error.message, true);
  }
}

async function saveAiSettings() {
  try {
    const response = await api('/api/config', {
      method: 'POST',
      body: JSON.stringify({
        ai: {
          baseUrl: elements.aiBaseUrl.value.trim(),
          model: elements.aiModel.value.trim(),
        },
      }),
    });
    state = response.state;
    render();
    showToast('AI 接口设置已保存');
  } catch (error) {
    showToast(error.message, true);
  }
}

async function generateReport(type) {
  if (state.readOnly) return;
  const button = type === 'weekly' ? elements.weeklyReportButton : elements.dailyReportButton;
  const original = button.textContent;
  button.disabled = true;
  button.textContent = 'AI 分析中…';
  try {
    const response = await api('/api/ai/report', {
      method: 'POST',
      body: JSON.stringify({ type, date: state.today }),
    });
    state = response.state;
    render();
    switchTab('review');
    showToast(type === 'weekly' ? '近 7 天周报已生成' : '今日简报已生成');
  } catch (error) {
    showToast(error.message, true);
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

async function requestAiSelections() {
  if (!state.ai.configured) return showToast('请先配置 DeepSeek API 密钥', true);
  elements.aiSelectButton.disabled = true;
  elements.aiSelectButton.textContent = 'AI 挑选中…';
  try {
    const response = await api('/api/ai/select', {
      method: 'POST',
      body: JSON.stringify({ date: state.today }),
    });
    pendingAiSelections = response.selections;
    elements.aiSelectionList.innerHTML = pendingAiSelections.map((selection) => `
      <article class="selection-card">
        <strong>${escapeHtml(selection.problem.title)}</strong>
        <p class="muted">${escapeHtml(selection.problem.platform)} · ${selection.estMinutes} 分钟</p>
        <p>${escapeHtml(selection.reason)}</p>
      </article>
    `).join('');
    elements.aiSelectionDialog.showModal();
  } catch (error) {
    showToast(error.message, true);
  } finally {
    elements.aiSelectButton.disabled = state.readOnly || !state.ai.configured;
    elements.aiSelectButton.textContent = '让 AI 按目标重排';
  }
}

async function applyAiSelections() {
  elements.applyAiSelectionButton.disabled = true;
  try {
    const response = await api('/api/plan/apply', {
      method: 'POST',
      body: JSON.stringify({
        date: state.today,
        selections: pendingAiSelections.map((item) => ({
          problemId: item.problemId,
          reason: item.reason,
        })),
      }),
    });
    state = response.state;
    elements.aiSelectionDialog.close();
    render();
    showToast('AI 题单已应用');
  } catch (error) {
    showToast(error.message, true);
  } finally {
    elements.applyAiSelectionButton.disabled = false;
  }
}

async function previewImport() {
  const text = elements.importText.value.trim();
  if (!text) return showToast('请先粘贴或选择题库内容', true);
  importTextValue = text;
  elements.previewImportButton.disabled = true;
  try {
    const response = await api('/api/problems/import', {
      method: 'POST',
      body: JSON.stringify({ text, format: 'auto', confirm: false }),
    });
    elements.confirmImportButton.disabled = response.added.length === 0;
    elements.importResult.textContent =
      `可导入 ${response.added.length} 道，重复 ${response.duplicates} 道` +
      (response.errors.length ? `\n问题：${response.errors.join('；')}` : '');
  } catch (error) {
    elements.confirmImportButton.disabled = true;
    elements.importResult.textContent = error.message;
  } finally {
    elements.previewImportButton.disabled = false;
  }
}

async function confirmImport() {
  if (!importTextValue) return;
  elements.confirmImportButton.disabled = true;
  try {
    const response = await api('/api/problems/import', {
      method: 'POST',
      body: JSON.stringify({
        text: importTextValue,
        format: 'auto',
        confirm: true,
        enrichAi: elements.importEnrichAi.checked,
      }),
    });
    state = response.state;
    render();
    showToast(`已导入 ${response.added.length} 道题`);
    elements.importResult.textContent = `导入完成，当前题库共 ${response.total} 道题。`;
  } catch (error) {
    showToast(error.message, true);
  }
}

async function loadState() {
  try {
    state = await api('/api/state');
    render();
  } catch (error) {
    showToast(`加载失败：${error.message}`, true);
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
elements.exportButton.addEventListener('click', () => window.location.assign('/api/export'));
elements.recordForm.addEventListener('submit', submitRecord);
elements.budgetForm.addEventListener('submit', submitBudget);
elements.customForm.addEventListener('submit', submitCustom);
elements.profileForm.addEventListener('submit', submitProfile);
elements.regeneratePlanButton.addEventListener('click', regeneratePlan);
elements.saveAiSettingsButton.addEventListener('click', saveAiSettings);
elements.saveDesktopKeyButton?.addEventListener('click', saveDesktopKey);
elements.clearDesktopKeyButton?.addEventListener('click', clearDesktopKey);
elements.openDataFolderButton?.addEventListener('click', () => desktopApi?.openDataDirectory());
elements.openExportsFolderButton?.addEventListener('click', () => desktopApi?.openExportsDirectory());
elements.dailyReportButton.addEventListener('click', () => generateReport('daily'));
elements.weeklyReportButton.addEventListener('click', () => generateReport('weekly'));
elements.aiSelectButton.addEventListener('click', requestAiSelections);
elements.applyAiSelectionButton.addEventListener('click', applyAiSelections);
elements.previewImportButton.addEventListener('click', previewImport);
elements.confirmImportButton.addEventListener('click', confirmImport);
elements.importFile.addEventListener('change', async () => {
  const file = elements.importFile.files[0];
  if (file) elements.importText.value = await file.text();
});

loadState();
