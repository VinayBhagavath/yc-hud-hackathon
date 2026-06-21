const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const preciseCurrency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

const percent = new Intl.NumberFormat("en-US", {
  style: "percent",
  maximumFractionDigits: 0,
});

const state = {
  data: null,
  roundIndex: 0,
  timer: null,
};

const elements = {
  metricGrid: document.querySelector("#metric-grid"),
  dataSource: document.querySelector("#data-source"),
  statusDot: document.querySelector(".status-dot"),
  roundTitle: document.querySelector("#round-title"),
  budgetUsed: document.querySelector("#budget-used-label"),
  budgetFill: document.querySelector("#budget-fill"),
  roundStats: document.querySelector("#round-stats"),
  allocationCaption: document.querySelector("#allocation-caption"),
  allocationMap: document.querySelector("#allocation-map"),
  toolFeed: document.querySelector("#tool-feed"),
  poolVisual: document.querySelector("#pool-visual"),
  poolCaption: document.querySelector("#pool-caption"),
  fundingBody: document.querySelector("#funding-body"),
  skipList: document.querySelector("#skip-list"),
  patientQueue: document.querySelector("#patient-queue"),
  trainingCurve: document.querySelector("#training-curve"),
  evalChart: document.querySelector("#eval-chart"),
  doseResponse: document.querySelector("#dose-response"),
  taskGrid: document.querySelector("#task-grid"),
  sensitivityList: document.querySelector("#sensitivity-list"),
  specialtyChart: document.querySelector("#specialty-chart"),
  regionGrid: document.querySelector("#region-grid"),
  leaderboard: document.querySelector("#leaderboard"),
  previous: document.querySelector("#prev-round"),
  next: document.querySelector("#next-round"),
  playToggle: document.querySelector("#play-toggle"),
};

async function boot() {
  bindControls();
  try {
    const response = await fetch("/api/dashboard");
    if (!response.ok) {
      throw new Error(`Dashboard API returned ${response.status}`);
    }
    state.data = await response.json();
    elements.statusDot.classList.add("ready");
    elements.dataSource.textContent = "Casey + William fixture feed online";
    renderAll();
  } catch (error) {
    elements.dataSource.textContent = "Read layer unavailable";
    document.querySelector("main").innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
  }
}

function bindControls() {
  elements.previous.addEventListener("click", () => moveRound(-1));
  elements.next.addEventListener("click", () => moveRound(1));
  elements.playToggle.addEventListener("click", togglePlayback);
}

function renderAll() {
  renderMetrics();
  renderPlayback();
  renderPatientQueue();
  renderTrainingCurve();
  renderEvalChart();
  renderDoseResponse();
  renderTasks();
  renderSensitivity();
  renderSpecialtyChart();
  renderRegionGrid();
  renderLeaderboard();
}

function renderMetrics() {
  const { overview, playback, eval_summaries: evalSummaries } = state.data;
  const finalRound = playback[playback.length - 1];
  const trained = evalSummaries.find((row) => row.policy_name === "trained");
  const random = evalSummaries.find((row) => row.policy_name === "random");
  const saved = trained && random ? random.avg_cost_per_medicated - trained.avg_cost_per_medicated : 0;
  const completion = overview.total_patients
    ? Math.round((overview.medicated / overview.total_patients) * 100)
    : 0;

  const cards = [
    ["Active cohort", overview.total_patients, `${completion}% medicated after replay`, "cohort"],
    ["Treatment gap", `${Math.round(overview.avg_treatment_gap_days)}d`, "Average Synthea diagnosis-to-treatment gap", "gap"],
    ["Reward cost", finalRound?.running_cost_per_medicated ? preciseCurrency.format(finalRound.running_cost_per_medicated) : "n/a", "Running cost per funded conversion", "cost"],
    ["Policy lift", currency.format(saved), "Cost avoided vs random baseline", "lift"],
    ["Sponsored", currency.format(overview.total_sponsorship_usd), "Cumulative physician sponsorship", "spend"],
  ];

  elements.metricGrid.innerHTML = cards
    .map(
      ([label, value, note, tone]) => `
        <article class="metric-card ${tone}">
          <p class="metric-label">${escapeHtml(label)}</p>
          <span class="metric-value">${escapeHtml(value)}</span>
          <p class="metric-note">${escapeHtml(note)}</p>
        </article>
      `,
    )
    .join("");
}

function renderPlayback() {
  const rounds = state.data.playback;
  const round = rounds[state.roundIndex];
  if (!round) {
    elements.roundTitle.textContent = "No playback rounds";
    return;
  }

  const budgetUsed = round.budget.budget_total_usd - round.budget.budget_remaining_usd;
  const budgetRatio = round.budget.budget_total_usd
    ? clamp((budgetUsed / round.budget.budget_total_usd) * 100, 0, 100)
    : 0;

  elements.roundTitle.textContent = `${round.round_id} allocation cycle`;
  elements.budgetUsed.textContent = `${currency.format(budgetUsed)} / ${currency.format(round.budget.budget_total_usd)}`;
  elements.budgetFill.style.width = `${budgetRatio}%`;
  elements.allocationCaption.textContent = `${round.summary.num_funded} funded, ${round.skipped.length} observed`;

  elements.roundStats.innerHTML = [
    ["Reviewed", `${round.budget.patients_reviewed}/${round.budget.patients_total}`],
    ["Funded spend", currency.format(round.summary.total_spend)],
    ["Funded conversions", round.summary.num_medicated_among_funded],
    ["Reward", preciseCurrency.format(round.summary.reward)],
  ]
    .map(([label, value]) => `<div class="round-stat"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`)
    .join("");

  renderAllocationMap(round);
  renderToolFeed(round);
  renderPool(round);
  renderFunding(round);
  renderSkipped(round);
}

function renderAllocationMap(round) {
  const maxAmount = Math.max(...round.funded.map((item) => item.amount_usd), 1);
  const fundedMarkup = round.funded
    .map((item) => {
      const height = 28 + (item.amount_usd / maxAmount) * 68;
      const converted = item.outcome === "medicated";
      return `
        <div class="allocation-node ${converted ? "converted" : "missed"}" style="--node-height:${height}px">
          <span class="node-amount">${currency.format(item.amount_usd)}</span>
          <span class="node-bar"></span>
          <strong>${escapeHtml(item.patient_id)}</strong>
          <small>${escapeHtml(item.physician_region)}</small>
        </div>
      `;
    })
    .join("");

  const skippedMarkup = round.skipped
    .map(
      (item) => `
        <div class="allocation-node skipped" style="--node-height:22px">
          <span class="node-amount">$0</span>
          <span class="node-bar"></span>
          <strong>${escapeHtml(item.patient_id)}</strong>
          <small>${escapeHtml(item.outcome === "organic_medicated" ? "organic" : "held")}</small>
        </div>
      `,
    )
    .join("");

  elements.allocationMap.innerHTML = fundedMarkup + skippedMarkup;
}

function renderToolFeed(round) {
  elements.toolFeed.innerHTML = round.tool_events
    .map(
      (event, index) => `
        <div class="tool-event ${event.status}">
          <span class="tool-index">${String(index + 1).padStart(2, "0")}</span>
          <div>
            <strong>${escapeHtml(event.tool_name)}</strong>
            <p>${escapeHtml(event.detail)}</p>
          </div>
          ${event.amount_usd ? `<span class="tool-money">${currency.format(event.amount_usd)}</span>` : ""}
        </div>
      `,
    )
    .join("");
}

function renderPool(round) {
  const initialPool = state.data.playback[0]?.started_pool || round.started_pool;
  const resolvedCount = Math.max(0, initialPool - round.ending_pool);
  const currentStart = Math.max(0, resolvedCount - round.summary.num_medicated_among_funded);
  elements.poolCaption.textContent = `${round.started_pool} to ${round.ending_pool} active`;

  elements.poolVisual.innerHTML = Array.from({ length: initialPool }, (_, index) => {
    const isResolved = index < resolvedCount;
    const isCurrent = index >= currentStart && index < resolvedCount;
    const className = ["pool-cell", isResolved ? "resolved" : "", isCurrent ? "current" : ""]
      .filter(Boolean)
      .join(" ");
    return `<span class="${className}" title="Pool slot ${index + 1}"></span>`;
  }).join("");
}

function renderFunding(round) {
  elements.fundingBody.innerHTML = round.funded
    .map((item) => {
      const medicated = item.outcome === "medicated";
      const signal = `${item.age}y, ${item.diagnosis_to_treatment_gap_days}d gap`;
      return `
        <tr>
          <td><strong>${escapeHtml(item.patient_id)}</strong><span>${escapeHtml(item.diagnosis)}</span></td>
          <td>${escapeHtml(signal)}</td>
          <td><strong>${escapeHtml(item.physician_id)}</strong><span>${escapeHtml(item.physician_specialty)}</span></td>
          <td class="money">${currency.format(item.amount_usd)}</td>
          <td>${percent.format(item.projected_conversion_rate)}<span>+${Math.round(item.expected_lift_pp)} pts</span></td>
          <td><span class="pill ${medicated ? "good" : "watch"}">${medicated ? "Medicated" : "Still under"}</span></td>
        </tr>
      `;
    })
    .join("");
}

function renderSkipped(round) {
  elements.skipList.innerHTML = round.skipped
    .map((item) => {
      const organic = item.outcome === "organic_medicated";
      return `
        <div class="skip-item ${organic ? "organic" : ""}">
          <div>
            <strong>${escapeHtml(item.patient_id)}</strong>
            <span>${escapeHtml(item.diagnosis)} under ${escapeHtml(item.physician_id)}</span>
          </div>
          <span class="pill ${organic ? "neutral" : "watch"}">${organic ? "Organic conversion" : "Not rewarded"}</span>
        </div>
      `;
    })
    .join("");
}

function renderPatientQueue() {
  const round = state.data.playback[state.roundIndex];
  const activeIds = new Set([...round.funded, ...round.skipped].map((item) => item.patient_id));
  const physicianById = new Map(state.data.physicians.map((physician) => [physician.physician_id, physician]));

  elements.patientQueue.innerHTML = state.data.patients
    .filter((patient) => activeIds.has(patient.patient_id))
    .sort((a, b) => b.diagnosis_to_treatment_gap_days - a.diagnosis_to_treatment_gap_days)
    .map((patient) => {
      const physician = physicianById.get(patient.physician_id);
      return `
        <div class="dossier ${patient.status}">
          <div class="dossier-top">
            <strong>${escapeHtml(patient.patient_id)}</strong>
            <span>${patient.age}y</span>
          </div>
          <p>${escapeHtml(patient.diagnosis)}</p>
          <div class="gap-meter">
            <span style="width:${clamp(patient.diagnosis_to_treatment_gap_days / 450 * 100, 8, 100)}%"></span>
          </div>
          <div class="dossier-meta">
            <span>${patient.diagnosis_to_treatment_gap_days}d gap</span>
            <span>${escapeHtml(physician?.specialty || "Unknown")}</span>
          </div>
        </div>
      `;
    })
    .join("");
}

function renderTrainingCurve() {
  const rows = state.data.training_curve;
  elements.trainingCurve.innerHTML = lineChart({
    rows,
    width: 680,
    height: 240,
    series: [
      ["trained_cost_per_medicated", "Trained", "#168078"],
      ["greedy_cost_per_medicated", "Greedy", "#406fa8"],
      ["random_cost_per_medicated", "Random", "#b54848"],
    ],
    xKey: "step",
    yLabel: "$/medicated",
  });
}

function renderEvalChart() {
  const rows = [...state.data.eval_summaries].sort(
    (a, b) => b.avg_cost_per_medicated - a.avg_cost_per_medicated,
  );
  const maxCost = Math.max(...rows.map((row) => row.avg_cost_per_medicated), 1);

  elements.evalChart.innerHTML = rows
    .map((row) => {
      const width = Math.max(8, (row.avg_cost_per_medicated / maxCost) * 100);
      return `
        <div class="policy-row ${row.policy_name}">
          <div>
            <strong>${titleCase(row.policy_name)}</strong>
            <span>${row.rounds_evaluated} eval rounds, ${percent.format(row.conversion_rate)} conversion</span>
          </div>
          <div class="bar-track"><div class="bar-fill" style="width:${width}%"></div></div>
          <strong class="bar-value">${currency.format(row.avg_cost_per_medicated)}</strong>
        </div>
      `;
    })
    .join("");
}

function renderDoseResponse() {
  const rows = state.data.dose_response;
  elements.doseResponse.innerHTML = lineChart({
    rows,
    width: 680,
    height: 240,
    series: [
      ["DR-014|PT-1011", "Near saturation", "#c27a18"],
      ["DR-021|PT-1003", "Fresh pulmonary", "#168078"],
      ["DR-030|PT-1009", "Cardiology probe", "#406fa8"],
    ],
    xKey: "amount_usd",
    yKeyResolver: (row, key) => {
      const [physicianId, patientId] = key.split("|");
      return row.physician_id === physicianId && row.patient_id === patientId ? row.probability * 100 : null;
    },
    yLabel: "P(medicated)",
  });
}

function renderTasks() {
  elements.taskGrid.innerHTML = state.data.task_results
    .map(
      (task) => `
        <div class="task-card ${task.difficulty}">
          <div>
            <strong>${escapeHtml(task.task_id)}</strong>
            <span>${escapeHtml(task.difficulty)} - seed ${task.population_seed}</span>
          </div>
          <div class="task-score">${preciseCurrency.format(Math.abs(task.avg_reward))}</div>
          <div class="variance-track"><span style="width:${clamp(task.variance * 100, 6, 100)}%"></span></div>
          <small>variance ${task.variance.toFixed(2)}, budget ${currency.format(task.budget_total_usd)}</small>
        </div>
      `,
    )
    .join("");
}

function renderSensitivity() {
  const max = Math.max(
    ...state.data.sensitivity.flatMap((row) => [
      row.trained_cost_per_medicated,
      row.random_cost_per_medicated,
      row.greedy_cost_per_medicated,
    ]),
    1,
  );

  elements.sensitivityList.innerHTML = state.data.sensitivity
    .map(
      (row) => `
        <div class="sensitivity-row">
          <strong>${escapeHtml(row.scenario)}</strong>
          <div class="mini-bars">
            ${miniBar("trained", row.trained_cost_per_medicated, max)}
            ${miniBar("greedy", row.greedy_cost_per_medicated, max)}
            ${miniBar("random", row.random_cost_per_medicated, max)}
          </div>
        </div>
      `,
    )
    .join("");
}

function renderSpecialtyChart() {
  elements.specialtyChart.innerHTML = state.data.overview.specialty_buckets
    .map((bucket) => {
      const total = bucket.undermedicated + bucket.medicated || 1;
      const medicatedWidth = (bucket.medicated / total) * 100;
      const underWidth = 100 - medicatedWidth;
      return `
        <div class="stack-row">
          <strong>${escapeHtml(bucket.label)}</strong>
          <div class="stack-track">
            <span class="stack-medicated" style="width:${medicatedWidth}%"></span>
            <span class="stack-under" style="width:${underWidth}%"></span>
          </div>
          <span>${bucket.medicated}/${total} medicated</span>
        </div>
      `;
    })
    .join("");
}

function renderRegionGrid() {
  const maxSpend = Math.max(...state.data.overview.allocation_by_region.map((row) => row.spend_usd), 1);
  elements.regionGrid.innerHTML = state.data.overview.allocation_by_region
    .map(
      (region) => `
        <div class="region-row">
          <div>
            <strong>${escapeHtml(region.label)}</strong>
            <span>${region.medicated}/${region.funded} funded converted</span>
          </div>
          <div class="region-meter"><span style="width:${Math.max(6, (region.spend_usd / maxSpend) * 100)}%"></span></div>
          <strong>${currency.format(region.spend_usd)}</strong>
        </div>
      `,
    )
    .join("");
}

function renderLeaderboard() {
  const physicians = [...state.data.physicians].sort(
    (a, b) => b.cumulative_sponsorship_usd - a.cumulative_sponsorship_usd,
  );

  elements.leaderboard.innerHTML = physicians
    .map(
      (physician) => `
        <div class="leader-row ${physician.saturation_band}">
          <div>
            <p class="leader-name">${escapeHtml(physician.physician_id)} - ${escapeHtml(physician.specialty)}</p>
            <span class="leader-meta">${escapeHtml(physician.region)} - ${physician.panel_size} active dossiers</span>
            <p class="leader-summary">${escapeHtml(physician.dossier_summary)}</p>
          </div>
          <div class="leader-money">
            <strong>${currency.format(physician.cumulative_sponsorship_usd)}</strong>
            <span>${escapeHtml(physician.saturation_band.replaceAll("_", " "))}</span>
          </div>
        </div>
      `,
    )
    .join("");
}

function lineChart({ rows, width, height, series, xKey, yLabel, yKeyResolver }) {
  const padding = { left: 48, right: 18, top: 18, bottom: 34 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const xValues = [...new Set(rows.map((row) => row[xKey]))].sort((a, b) => a - b);
  const allY = [];
  const seriesRows = series.map(([key, label, color]) => {
    const points = xValues.map((xValue) => {
      const source = rows.find((row) => row[xKey] === xValue && (!yKeyResolver || yKeyResolver(row, key) !== null));
      const value = source ? (yKeyResolver ? yKeyResolver(source, key) : source[key]) : null;
      if (value !== null && value !== undefined) allY.push(value);
      return { xValue, value };
    });
    return { key, label, color, points };
  });

  const minY = Math.min(...allY, 0);
  const maxY = Math.max(...allY, 1);
  const xMin = Math.min(...xValues);
  const xMax = Math.max(...xValues);
  const xScale = (value) => padding.left + ((value - xMin) / Math.max(1, xMax - xMin)) * chartWidth;
  const yScale = (value) => padding.top + (1 - (value - minY) / Math.max(1, maxY - minY)) * chartHeight;
  const grid = [0, 0.25, 0.5, 0.75, 1]
    .map((ratio) => {
      const y = padding.top + ratio * chartHeight;
      return `<line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" class="grid-line"></line>`;
    })
    .join("");
  const paths = seriesRows
    .map((line) => {
      const coords = line.points
        .filter((point) => point.value !== null && point.value !== undefined)
        .map((point) => `${xScale(point.xValue)},${yScale(point.value)}`);
      const circles = line.points
        .filter((point) => point.value !== null && point.value !== undefined)
        .map((point) => `<circle cx="${xScale(point.xValue)}" cy="${yScale(point.value)}" r="4" fill="${line.color}"></circle>`)
        .join("");
      return `<polyline points="${coords.join(" ")}" fill="none" stroke="${line.color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></polyline>${circles}`;
    })
    .join("");
  const legend = seriesRows
    .map((line, index) => `<span style="--legend-color:${line.color}">${escapeHtml(line.label)}</span>`)
    .join("");

  return `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(yLabel)} chart">
      ${grid}
      <line x1="${padding.left}" y1="${height - padding.bottom}" x2="${width - padding.right}" y2="${height - padding.bottom}" class="axis-line"></line>
      <line x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${height - padding.bottom}" class="axis-line"></line>
      ${paths}
      <text x="${padding.left}" y="${height - 8}" class="axis-text">${escapeHtml(String(xMin))}</text>
      <text x="${width - padding.right - 42}" y="${height - 8}" class="axis-text">${escapeHtml(String(xMax))}</text>
      <text x="8" y="18" class="axis-text">${escapeHtml(yLabel)}</text>
    </svg>
    <div class="chart-legend">${legend}</div>
  `;
}

function miniBar(label, value, max) {
  return `
    <div class="mini-bar ${label}">
      <span>${titleCase(label)}</span>
      <div><i style="width:${Math.max(6, (value / max) * 100)}%"></i></div>
      <strong>${currency.format(value)}</strong>
    </div>
  `;
}

function moveRound(delta) {
  stopPlayback();
  const rounds = state.data?.playback || [];
  if (!rounds.length) return;
  state.roundIndex = (state.roundIndex + delta + rounds.length) % rounds.length;
  renderPlayback();
  renderPatientQueue();
}

function togglePlayback() {
  if (state.timer) {
    stopPlayback();
    return;
  }
  elements.playToggle.textContent = "||";
  elements.playToggle.setAttribute("aria-label", "Pause rounds");
  state.timer = window.setInterval(() => {
    const rounds = state.data?.playback || [];
    if (!rounds.length) return;
    state.roundIndex = (state.roundIndex + 1) % rounds.length;
    renderPlayback();
    renderPatientQueue();
  }, 1800);
}

function stopPlayback() {
  if (!state.timer) return;
  window.clearInterval(state.timer);
  state.timer = null;
  elements.playToggle.textContent = ">";
  elements.playToggle.setAttribute("aria-label", "Play rounds");
}

function titleCase(value) {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

boot();
