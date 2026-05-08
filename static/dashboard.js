let dailyChart;
let pieChart;
let statsData = [];
let testsData = [];
let dailyData = [];
let selectedDailyDate = null;
let dailyWeekOffset = 0;
let gaugeLength = 0;
const GAUGE_ARC_RATIO = 0.7;
const doughnutCenterTextPlugin = {
  id: "doughnutCenterText",
  afterDraw(chart) {
    if (chart.config.type !== "doughnut") return;
    const { ctx } = chart;
    const meta = chart.getDatasetMeta(0);
    if (!meta?.data?.length) return;
    const x = meta.data[0].x;
    const y = meta.data[0].y;
    const total = (chart.data.datasets[0].data || []).reduce((sum, n) => sum + n, 0);

    ctx.save();
    ctx.textAlign = "center";
    ctx.fillStyle = "#6d8fb2";
    ctx.font = "500 14px Arial, sans-serif";
    ctx.fillText("TOTAL", x, y - 16);
    ctx.fillStyle = "#e9f2ff";
    ctx.font = "700 36px Arial, sans-serif";
    ctx.fillText(String(total), x, y + 24);
    ctx.fillStyle = "#6d8fb2";
    ctx.font = "500 12px Arial, sans-serif";
    ctx.fillText("units", x, y + 44);
    ctx.restore();
  }
};
Chart.register(doughnutCenterTextPlugin);

const dailyBarDesignPlugin = {
  id: "dailyBarDesign",
  afterDatasetsDraw(chart) {
    if (chart.canvas?.id !== "dailyChart" || chart.config.type !== "bar") return;
    const { ctx } = chart;
    const meta = chart.getDatasetMeta(0);
    const data = chart.data.datasets[0].data || [];
    const yScale = chart.scales?.y;
    if (!meta?.data?.length) return;
    if (!yScale) return;

    const levelCount = 4;
    const maxValue = Number.isFinite(yScale.max) && yScale.max > 0 ? yScale.max : Math.max(...data, 0);
    const levelPixels = [];
    for (let level = 1; level < levelCount; level += 1) {
      const levelValue = (maxValue * level) / levelCount;
      levelPixels.push(yScale.getPixelForValue(levelValue));
    }

    ctx.save();
    meta.data.forEach((bar, idx) => {
      const value = data[idx];
      const props = bar.getProps(["x", "y", "base", "width"], true);
      const left = props.x - props.width / 2 + 2;
      const right = props.x + props.width / 2 - 2;
      const height = props.base - props.y;

      // Draw shared level separators inside each bar, aligned to chart-wide levels.
      ctx.strokeStyle = "#163a5a";
      ctx.lineWidth = 1;
      for (const lineY of levelPixels) {
        if (lineY <= props.y || lineY >= props.base) continue;
        ctx.beginPath();
        ctx.moveTo(left, lineY);
        ctx.lineTo(right, lineY);
        ctx.stroke();
      }

      // Draw value label above each bar.
      ctx.fillStyle = "#5e87ac";
      ctx.font = "700 11px Arial";
      ctx.textAlign = "center";
      ctx.fillText(String(value), props.x, props.y - 8);
    });
    ctx.restore();
  }
};
Chart.register(dailyBarDesignPlugin);

function formatShortDate(isoDate) {
  return new Date(isoDate + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function getYieldColor(value) {
  if (value >= 90) return "#10b981";
  if (value >= 80) return "#f59e0b";
  return "#ef4444";
}

function updateGauge(partNumber, yieldPercent) {
  const progress = document.getElementById("gaugeProgress");
  const track = document.querySelector(".gauge-track");
  const text = document.getElementById("yieldText");
  const selected = document.getElementById("selectedPart");
  const panelTitlePart = document.getElementById("yieldRatePartTitle");
  const percent = Math.max(0, Math.min(100, yieldPercent));
  const color = getYieldColor(percent);
  const visibleArcLength = gaugeLength * GAUGE_ARC_RATIO;
  const hiddenArcLength = Math.max(gaugeLength - visibleArcLength, 0.001);
  const filledLength = visibleArcLength * (percent / 100);
  const remainingVisible = Math.max(visibleArcLength - filledLength, 0.001);

  track.style.strokeDasharray = `${visibleArcLength} ${hiddenArcLength}`;
  track.style.strokeDashoffset = 0;
  progress.style.stroke = color;
  progress.style.strokeDasharray = `${filledLength} ${remainingVisible + hiddenArcLength}`;
  progress.style.strokeDashoffset = 0;
  text.textContent = `${percent.toFixed(1)}%`;
  text.style.color = color;
  selected.textContent = partNumber;
  panelTitlePart.textContent = partNumber;
}

function updateGaugeStats(selected) {
  const failed = selected.total_tested - selected.passed;
  document.getElementById("testedVal").textContent = selected.total_tested;
  document.getElementById("passedVal").textContent = selected.passed;
  document.getElementById("failedVal").textContent = failed;
  document.getElementById("yieldVal").textContent = `${selected.yield_percent.toFixed(1)}%`;
}

async function fetchDailyData() {
  const res = await fetch(`/daily?week_offset=${dailyWeekOffset}`);
  return res.json();
}

async function fetchStatsData() {
  const res = await fetch("/stats");
  return res.json();
}

async function fetchTestsData() {
  const res = await fetch("/tests");
  return res.json();
}

async function parseErrorMessage(res) {
  try {
    const data = await res.json();
    if (typeof data?.detail === "string") return data.detail;
    if (typeof data?.output === "string") return data.output;
    return "Unknown error";
  } catch {
    return `${res.status} ${res.statusText}`.trim() || "Unknown error";
  }
}

function updateDailyMeta() {
  const metaEl = document.getElementById("dailyMeta");
  if (selectedDailyDate) {
    const selected = dailyData.find((d) => d.date === selectedDailyDate);
    const count = selected ? selected.count : 0;
    metaEl.innerHTML = `${count} <span>units / ${formatShortDate(selectedDailyDate)}</span>`;
    return;
  }
  const total = dailyData.reduce((sum, item) => sum + item.count, 0);
  metaEl.innerHTML = `${total} <span>units / 7 days</span>`;
}

function updateWeekButtons() {
  document.getElementById("todayWeekBtn").disabled = dailyWeekOffset === 0;
}

function renderDailyChart() {
  const labels = dailyData.map((d) => formatShortDate(d.date));
  const counts = dailyData.map((d) => d.count);
  const selectedIndex = selectedDailyDate
    ? dailyData.findIndex((d) => d.date === selectedDailyDate)
    : -1;
  const total = counts.reduce((sum, value) => sum + value, 0);
  const hasSelection = selectedIndex >= 0;
  const barColors = counts.map((_, idx) => {
    if (!hasSelection) return "#2f6f92";
    return idx === selectedIndex ? "#2de0c2" : "#1c4565";
  });
  if (!hasSelection && total === 0) {
    // Keep same appearance when there is no data.
    barColors.fill("#2f6f92");
  }
  if (dailyChart) dailyChart.destroy();
  dailyChart = new Chart(document.getElementById("dailyChart"), {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label: "Units Tested",
        data: counts,
        backgroundColor: barColors,
        borderRadius: 5,
        borderSkipped: false,
        clip: false,
        barThickness: 38,
        categoryPercentage: 0.86,
        barPercentage: 0.96
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { top: 24 } },
      plugins: { legend: { display: false } },
      onClick: (event, elements) => {
        if (!elements.length) {
          selectedDailyDate = null;
          updateViewsForSelectedDate();
          return;
        }
        console.log(elements);
        const index = elements[0].index;
        const clickedDate = dailyData[index]?.date;
        if (!clickedDate) return;
        selectedDailyDate = selectedDailyDate === clickedDate ? null : clickedDate;
        updateViewsForSelectedDate();
      },
      scales: {
        x: {
          ticks: { color: "#4f79a2", font: { size: 10, weight: "700" } },
          grid: { display: false },
          border: { display: false }
        },
        y: {
          display: false,
          grid: { display: false },
          border: { display: false },
          beginAtZero: true
        }
      }
    }
  });
}

function renderPieChart(stats) {
  const labels = stats.map((s) => s.part_number);
  const values = stats.map((s) => s.total_tested);
  const colors = ["#2de0c2", "#2586c8", "#f5a623"];
  if (pieChart) pieChart.destroy();
  const legendContainer = document.getElementById("partLegend");
  legendContainer.innerHTML = stats.map((s, idx) =>
    `<div data-part="${s.part_number}">
      <span class="legend-left">
        <span class="legend-dot" style="color:${colors[idx % colors.length]}">●</span>
        <span class="legend-part">${s.part_number}</span>
      </span>
      <span>${s.total_tested}</span>
    </div>`
  ).join("");

  const selectPart = (partNumber) => {
    const selected = stats.find((item) => item.part_number === partNumber);
    if (!selected) return;
    legendContainer.querySelectorAll("div[data-part]").forEach((row) => {
      row.classList.toggle("selected", row.getAttribute("data-part") === partNumber);
    });
    updateGauge(selected.part_number, selected.yield_percent);
    updateGaugeStats(selected);
  };

  legendContainer.querySelectorAll("div[data-part]").forEach((row) => {
    row.addEventListener("click", () => selectPart(row.getAttribute("data-part")));
  });

  pieChart = new Chart(document.getElementById("partPieChart"), {
    type: "doughnut",
    data: {
      labels,
      datasets: [{ data: values, backgroundColor: colors, borderWidth: 0, hoverBorderWidth: 0 }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "48%",
      plugins: { legend: { display: false } },
      onClick: (event, elements) => {
        if (!elements.length) return;
        const index = elements[0].index;
        selectPart(stats[index].part_number);
      }
    }
  });

  if (stats.length > 0) {
    selectPart(stats[0].part_number);
  }
}

function buildStatsForDate(date) {
  const aggregate = new Map(statsData.map((item) => [item.part_number, { total_tested: 0, passed: 0 }]));
  const filteredTests = date
    ? testsData.filter((item) => String(item.timestamp).slice(0, 10) === date)
    : testsData;

  filteredTests.forEach((item) => {
    if (!aggregate.has(item.part_number)) {
      aggregate.set(item.part_number, { total_tested: 0, passed: 0 });
    }
    const target = aggregate.get(item.part_number);
    target.total_tested += 1;
    if (item.status) target.passed += 1;
  });

  return Array.from(aggregate.entries()).map(([part_number, totals]) => {
    const yield_percent = totals.total_tested
      ? roundTo2((totals.passed / totals.total_tested) * 100)
      : 0;
    return { part_number, total_tested: totals.total_tested, passed: totals.passed, yield_percent };
  });
}

function roundTo2(value) {
  return Math.round(value * 100) / 100;
}

function updateViewsForSelectedDate() {
  if (selectedDailyDate && !dailyData.some((item) => item.date === selectedDailyDate)) {
    selectedDailyDate = null;
  }
  updateDailyMeta();
  renderDailyChart();
  const filteredStats = buildStatsForDate(selectedDailyDate);
  renderPieChart(filteredStats);
}

function renderDashboard(daily, stats, tests) {
  dailyData = daily;
  statsData = stats;
  testsData = tests;
  updateWeekButtons();
  updateViewsForSelectedDate();
}

async function refreshDashboard() {
  const [daily, stats, tests] = await Promise.all([fetchDailyData(), fetchStatsData(), fetchTestsData()]);
  renderDashboard(daily, stats, tests);
}

async function addManualTest() {
  const serial = document.getElementById("serialNumber").value.trim();
  const part = document.getElementById("partNumber").value;
  const status = document.getElementById("statusCheckbox").checked;

  if (!serial) {
    alert("Serial number is required.");
    return;
  }

  const payload = { serial_number: serial, part_number: part, status };
  const res = await fetch("/tests", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const message = await parseErrorMessage(res);
    alert(`Failed to add test: ${message}`);
    return;
  }

  document.getElementById("serialNumber").value = "";
  document.getElementById("statusCheckbox").checked = false;
  document.getElementById("manualModal").style.display = "none";
  await refreshDashboard();
}

function updateClock() {
  document.getElementById("timestampLabel").textContent = new Date().toLocaleString();
}

function setupUiEvents() {
  const modal = document.getElementById("manualModal");
  document.getElementById("manualTestBtn").addEventListener("click", () => {
    modal.style.display = "flex";
  });
  document.getElementById("addTestBtn").addEventListener("click", addManualTest);
  document.getElementById("viewApiBtn").addEventListener("click", () => window.open("/docs", "_blank"));
  document.getElementById("viewScriptBtn").addEventListener("click", () => window.open("/static/test_yield.py", "_blank"));
  document.getElementById("previousWeekBtn").addEventListener("click", async () => {
    dailyWeekOffset -= 1;
    selectedDailyDate = null;
    await refreshDashboard();
  });
  document.getElementById("todayWeekBtn").addEventListener("click", async () => {
    dailyWeekOffset = 0;
    selectedDailyDate = null;
    await refreshDashboard();
  });
  document.getElementById("nextWeekBtn").addEventListener("click", async () => {
    dailyWeekOffset += 1;
    selectedDailyDate = null;
    await refreshDashboard();
  });
  window.addEventListener("click", (event) => {
    if (event.target === modal) modal.style.display = "none";
  });
}

function initializeGauge() {
  gaugeLength = document.getElementById("gaugeProgress").getTotalLength();
  document.getElementById("gaugeProgress").style.strokeDasharray = `0 ${gaugeLength}`;
  document.querySelector(".gauge-track").style.strokeDasharray = `${gaugeLength * GAUGE_ARC_RATIO} ${gaugeLength * (1 - GAUGE_ARC_RATIO)}`;
}

function initializeApp() {
  setupUiEvents();
  initializeGauge();
  updateClock();
  setInterval(updateClock, 1000);
  refreshDashboard();
}

initializeApp();
