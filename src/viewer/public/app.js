const state = {
  refreshMs: 3000,
  experiments: [],
  runs: [],
  selectedExperimentId: '',
  selectedRunType: '',
  selectedRunKey: '',
  runDetail: null,
  selectedEpisodeIndex: 0,
};

const el = {
  experimentFilter: document.getElementById('experiment-filter'),
  runTypeFilter: document.getElementById('run-type-filter'),
  autoRefresh: document.getElementById('auto-refresh'),
  runs: document.getElementById('runs'),
  runCount: document.getElementById('run-count'),
  runTitle: document.getElementById('run-title'),
  runSubtitle: document.getElementById('run-subtitle'),
  refreshIndicator: document.getElementById('refresh-indicator'),
  metricsGrid: document.getElementById('metrics-grid'),
  chart: document.getElementById('trajectory-chart'),
  episodeSelect: document.getElementById('episode-select'),
  episodeMeta: document.getElementById('episode-meta'),
  toolMeta: document.getElementById('tool-meta'),
  conversation: document.getElementById('conversation'),
};

function runKey(experimentId, runId) {
  return `${experimentId}::${runId}`;
}

function formatPct(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function formatNum(value, decimals = 2) {
  return Number(value).toFixed(decimals);
}

function fmtDate(iso) {
  const date = new Date(iso);
  return date.toLocaleString();
}

function escapeHtml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return response.json();
}

async function loadMeta() {
  const meta = await fetchJson('/api/meta');
  state.refreshMs = meta.refreshMs;
}

async function loadExperiments() {
  const data = await fetchJson('/api/experiments');
  state.experiments = data.experiments;
  renderExperimentFilter();
}

async function loadRuns() {
  const params = new URLSearchParams();
  if (state.selectedExperimentId) params.set('experimentId', state.selectedExperimentId);
  params.set('limit', '200');

  const data = await fetchJson(`/api/runs?${params.toString()}`);
  state.runs = data.runs;
  renderRuns();

  if (!state.selectedRunKey && state.runs.length > 0) {
    const first = state.runs[0];
    await selectRun(first.experimentId, first.runId);
  }
}

function renderExperimentFilter() {
  const options = [
    '<option value="">All experiments</option>',
    ...state.experiments.map((exp) =>
      `<option value="${escapeHtml(exp.experimentId)}">${escapeHtml(exp.label)} (${exp.runCount})</option>`
    ),
  ];
  el.experimentFilter.innerHTML = options.join('');
  el.experimentFilter.value = state.selectedExperimentId;
}

function getFilteredRuns() {
  return state.runs.filter((run) => {
    if (state.selectedRunType && run.runType !== state.selectedRunType) return false;
    return true;
  });
}

function renderRuns() {
  const runs = getFilteredRuns();
  el.runCount.textContent = `${runs.length} run(s)`;

  if (runs.length === 0) {
    el.runs.innerHTML = '<div class="empty">No runs match this filter.</div>';
    return;
  }

  el.runs.innerHTML = runs
    .map((run) => {
      const key = runKey(run.experimentId, run.runId);
      const activeClass = key === state.selectedRunKey ? 'active' : '';
      const successRate = run.summary ? formatPct(run.summary.successRate) : 'n/a';
      return `
        <button class="run-item ${activeClass}" data-run-key="${escapeHtml(key)}" type="button">
          <h4>${escapeHtml(run.runId)}</h4>
          <p>${escapeHtml(run.experimentId)}</p>
          <p>${escapeHtml(run.runType)} · success ${escapeHtml(successRate)} · ${fmtDate(run.createdAt)}</p>
        </button>
      `;
    })
    .join('');

  el.runs.querySelectorAll('[data-run-key]').forEach((node) => {
    node.addEventListener('click', async () => {
      const value = node.getAttribute('data-run-key');
      if (!value) return;
      const [experimentId, runId] = value.split('::');
      await selectRun(experimentId, runId);
    });
  });
}

async function selectRun(experimentId, runId, options = {}) {
  const preserveEpisode = options.preserveEpisode === true;
  state.selectedRunKey = runKey(experimentId, runId);
  renderRuns();

  const detail = await fetchJson(`/api/run?experimentId=${encodeURIComponent(experimentId)}&runId=${encodeURIComponent(runId)}`);
  state.runDetail = detail;
  const episodeIndexes = (detail.trajectories || []).map((trajectory) => trajectory.episodeIndex);
  if (!preserveEpisode || !episodeIndexes.includes(state.selectedEpisodeIndex)) {
    state.selectedEpisodeIndex = detail.trajectories?.[0]?.episodeIndex ?? 0;
  }
  renderRunDetail();
}

function metricCard(label, value) {
  return `
    <div class="metric">
      <div class="label">${escapeHtml(label)}</div>
      <div class="value">${escapeHtml(value)}</div>
    </div>
  `;
}

function renderMetrics(summary, trajectories) {
  if (!summary) {
    el.metricsGrid.innerHTML = '<div class="empty">Run summary missing.</div>';
    return;
  }

  const bestReward = trajectories.length ? Math.max(...trajectories.map((t) => t.totalReward)) : 0;
  const worstReward = trajectories.length ? Math.min(...trajectories.map((t) => t.totalReward)) : 0;

  el.metricsGrid.innerHTML = [
    metricCard('Episodes', String(summary.episodeCount)),
    metricCard('Success Rate', formatPct(summary.successRate)),
    metricCard('Avg Reward', formatNum(summary.avgReward)),
    metricCard('Avg Turns', formatNum(summary.avgTurns)),
    metricCard('Wrong Answer', formatPct(summary.wrongAnswerRate)),
    metricCard('Invalid Action', formatPct(summary.invalidActionRate)),
    metricCard('Best Episode Reward', String(bestReward)),
    metricCard('Worst Episode Reward', String(worstReward)),
    metricCard('Multistep Clue Completion', formatPct(summary.multistep.resolutionSuccessRate)),
    metricCard('Target Observed', formatPct(summary.multistep.targetFieldObservedRate)),
    metricCard('Follow-up Completion', formatPct(summary.multistep.followUpCompletionRate)),
    metricCard('Ended Awaiting Follow-up', formatPct(summary.multistep.endedAwaitingFollowUpRate)),
  ].join('');
}

function drawTrajectoryChart(trajectories) {
  const width = 920;
  const height = 250;
  const pad = { top: 18, right: 18, bottom: 28, left: 30 };

  if (!trajectories.length) {
    el.chart.innerHTML = `<text x="20" y="34" fill="#5f6368" font-size="14">No trajectories available</text>`;
    return;
  }

  const rewards = trajectories.map((t) => t.totalReward);
  const minReward = Math.min(...rewards, 0);
  const maxReward = Math.max(...rewards, 0);
  const span = Math.max(1, maxReward - minReward);

  const chartW = width - pad.left - pad.right;
  const chartH = height - pad.top - pad.bottom;
  const zeroY = pad.top + ((maxReward - 0) / span) * chartH;

  const barW = Math.max(4, chartW / trajectories.length - 3);
  const step = chartW / trajectories.length;

  const bars = trajectories.map((t, idx) => {
    const x = pad.left + idx * step + 1;
    const yVal = pad.top + ((maxReward - t.totalReward) / span) * chartH;
    const y = Math.min(yVal, zeroY);
    const h = Math.max(1, Math.abs(yVal - zeroY));
    const color = t.totalReward >= 0 ? '#1f8f4f' : '#b53d3d';
    return `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${barW.toFixed(2)}" height="${h.toFixed(2)}" fill="${color}" opacity="0.82" />`;
  });

  let running = 0;
  const points = trajectories.map((t, idx) => {
    running += t.totalReward;
    const avg = running / (idx + 1);
    const x = pad.left + idx * step + barW / 2;
    const y = pad.top + ((maxReward - avg) / span) * chartH;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });

  const axis = [
    `<line x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${height - pad.bottom}" stroke="#bbb"/>`,
    `<line x1="${pad.left}" y1="${zeroY.toFixed(2)}" x2="${width - pad.right}" y2="${zeroY.toFixed(2)}" stroke="#bbb" stroke-dasharray="3 2"/>`,
    `<line x1="${pad.left}" y1="${height - pad.bottom}" x2="${width - pad.right}" y2="${height - pad.bottom}" stroke="#bbb"/>`,
  ];

  const labels = [
    `<text x="${pad.left}" y="${pad.top - 4}" fill="#5f6368" font-size="11">max ${maxReward}</text>`,
    `<text x="${pad.left}" y="${height - pad.bottom + 14}" fill="#5f6368" font-size="11">min ${minReward}</text>`,
    `<text x="${width - 140}" y="${pad.top + 12}" fill="#1768ac" font-size="11">cumulative avg reward</text>`,
  ];

  el.chart.innerHTML = `
    ${axis.join('')}
    ${bars.join('')}
    <polyline points="${points.join(' ')}" fill="none" stroke="#1768ac" stroke-width="2.2" />
    ${labels.join('')}
  `;
}

function renderEpisodeSelect(trajectories) {
  if (!trajectories.length) {
    el.episodeSelect.innerHTML = '<option value="0">No episodes</option>';
    return;
  }

  el.episodeSelect.innerHTML = trajectories
    .map((t) => {
      const outcome = t.success ? 'success' : 'fail';
      return `<option value="${t.episodeIndex}">Episode ${t.episodeIndex + 1} · ${outcome} · reward ${t.totalReward}</option>`;
    })
    .join('');

  el.episodeSelect.value = String(state.selectedEpisodeIndex);
}

function chip(text, className = '') {
  return `<span class="chip ${className}">${escapeHtml(text)}</span>`;
}

function summarizeToolEvents(trajectory) {
  const toolEvents = trajectory.voiceAgentToolEvents || [];
  const lookups = toolEvents.filter((e) => e.type === 'lookup_result').length;
  const fieldFetches = toolEvents.filter((e) => e.type === 'field_retrieved').length;

  const byField = new Map();
  for (const evt of toolEvents) {
    if (evt.type !== 'field_retrieved') continue;
    const current = byField.get(evt.field) || 0;
    byField.set(evt.field, current + 1);
  }

  const fieldSummary = Array.from(byField.entries())
    .map(([field, count]) => `${field}: ${count}`)
    .slice(0, 4)
    .join(' | ');

  return { lookups, fieldFetches, fieldSummary };
}

function renderEpisodeDetail() {
  const trajectories = state.runDetail?.trajectories || [];
  const trajectory = trajectories.find((t) => t.episodeIndex === state.selectedEpisodeIndex) || trajectories[0];

  if (!trajectory) {
    el.episodeMeta.innerHTML = '';
    el.toolMeta.innerHTML = '';
    el.conversation.innerHTML = '<div class="empty">No episode data.</div>';
    return;
  }

  const outcomeClass = trajectory.success ? 'good' : 'bad';
  el.episodeMeta.innerHTML = [
    chip(trajectory.success ? 'SUCCESS' : `FAIL: ${trajectory.failureReason || 'unknown'}`, outcomeClass),
    chip(`task ${trajectory.scenarioType}`),
    chip(`reward ${trajectory.totalReward}`),
    chip(`turns ${trajectory.turnCount}`),
    chip(`invalid actions ${trajectory.invalidActionCount}`, trajectory.invalidActionCount > 0 ? 'bad' : ''),
    chip(`phase ${trajectory.progress.phase}`),
    chip(`target observed ${trajectory.progress.targetFieldObserved ? 'yes' : 'no'}`),
  ].join('');

  const toolSummary = summarizeToolEvents(trajectory);
  el.toolMeta.innerHTML = [
    chip(`lookups ${toolSummary.lookups}`),
    chip(`field fetches ${toolSummary.fieldFetches}`),
    chip(`submitted ${trajectory.submittedField || 'none'} = ${trajectory.submittedAnswer || 'none'}`),
    toolSummary.fieldSummary ? chip(toolSummary.fieldSummary) : '',
  ].join('');

  const messages = trajectory.conversationHistory || [];
  if (!messages.length) {
    el.conversation.innerHTML = '<div class="empty">Conversation is empty.</div>';
    return;
  }

  el.conversation.innerHTML = messages
    .map((message) => {
      const speaker = message.speaker === 'CALLER' ? 'CALLER' : 'VOICE AGENT';
      const cls = message.speaker === 'CALLER' ? 'caller' : 'voice';
      return `
        <div class="message ${cls}">
          <div class="msg-speaker">${speaker}</div>
          <div>${escapeHtml(message.utterance)}</div>
        </div>
      `;
    })
    .join('');
}

function renderRunDetail() {
  const detail = state.runDetail;
  if (!detail || !detail.manifest) {
    el.runTitle.textContent = 'Select a run';
    el.runSubtitle.textContent = 'No run selected';
    el.metricsGrid.innerHTML = '';
    el.chart.innerHTML = '';
    el.episodeSelect.innerHTML = '';
    el.episodeMeta.innerHTML = '';
    el.toolMeta.innerHTML = '';
    el.conversation.innerHTML = '<div class="empty">Select a run to view trajectory details.</div>';
    return;
  }

  const { manifest, summary, trajectories } = detail;
  el.runTitle.textContent = `${manifest.runId} (${manifest.runType})`;
  el.runSubtitle.textContent = `${manifest.experimentId} · ${manifest.policyId} · ${fmtDate(manifest.createdAt)}`;

  renderMetrics(summary, trajectories);
  drawTrajectoryChart(trajectories);
  renderEpisodeSelect(trajectories);
  renderEpisodeDetail();
}

function markRefresh(status) {
  const now = new Date().toLocaleTimeString();
  el.refreshIndicator.textContent = `${status} · ${now}`;
}

async function refreshAll() {
  markRefresh('Refreshing');
  await Promise.all([loadExperiments(), loadRuns()]);

  if (state.selectedRunKey) {
    const [experimentId, runId] = state.selectedRunKey.split('::');
    if (experimentId && runId) {
      try {
        await selectRun(experimentId, runId, { preserveEpisode: true });
      } catch {
        state.runDetail = null;
      }
    }
  }

  markRefresh('Updated');
}

function installEvents() {
  el.experimentFilter.addEventListener('change', async (event) => {
    state.selectedExperimentId = event.target.value;
    state.selectedRunKey = '';
    await loadRuns();
  });

  el.runTypeFilter.addEventListener('change', async (event) => {
    state.selectedRunType = event.target.value;
    renderRuns();

    const visible = getFilteredRuns();
    if (!visible.some((run) => runKey(run.experimentId, run.runId) === state.selectedRunKey)) {
      state.selectedRunKey = '';
      if (visible.length > 0) {
        await selectRun(visible[0].experimentId, visible[0].runId);
      } else {
        state.runDetail = null;
        renderRunDetail();
      }
    }
  });

  el.episodeSelect.addEventListener('change', (event) => {
    state.selectedEpisodeIndex = Number(event.target.value);
    renderEpisodeDetail();
  });
}

async function bootstrap() {
  installEvents();
  await loadMeta();
  await refreshAll();

  setInterval(async () => {
    if (!el.autoRefresh.checked) return;
    try {
      await refreshAll();
    } catch {
      markRefresh('Refresh error');
    }
  }, state.refreshMs);
}

bootstrap().catch((error) => {
  console.error(error);
  markRefresh(`Error: ${error.message}`);
});
