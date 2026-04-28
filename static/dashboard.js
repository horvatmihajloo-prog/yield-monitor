let dailyChart;
let pieChart;
let statsData = [];
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
    if (!meta?.data?.length) return;

    ctx.save();
    meta.data.forEach((bar, idx) => {
      const value = data[idx];
      const props = bar.getProps(["x", "y", "base", "width"], true);
      const left = props.x - props.width / 2 + 2;
      const right = props.x + props.width / 2 - 2;
      const height = props.base - props.y;

      // Draw segmented separator lines inside each bar.
      ctx.strokeStyle = "#163a5a";
      ctx.lineWidth = 1;
      for (let i = 1; i <= 3; i += 1) {
        const lineY = props.base - (height * i) / 4;
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
  const res = await fetch("/daily");
  return res.json();
}

async function fetchStatsData() {
  const res = await fetch("/stats");
  return res.json();
}

async function parseErrorMessage(res) {
  try {
    const data = await res.json();
    return data?.detail || "Unknown error";
  } catch {
    return `${res.status} ${res.statusText}`.trim() || "Unknown error";
  }
}

function renderDailyChart(daily) {
  const labels = daily.map((d) => formatShortDate(d.date));
  const counts = daily.map((d) => d.count);
  const total = counts.reduce((sum, value) => sum + value, 0);
  document.getElementById("dailyMeta").innerHTML = `${total} <span>units / 7 days</span>`;
  if (dailyChart) dailyChart.destroy();
  dailyChart = new Chart(document.getElementById("dailyChart"), {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label: "Units Tested",
        data: counts,
        backgroundColor: counts.map((_, idx) => idx === counts.length - 1 ? "#2de0c2" : "#2f6f92"),
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

function renderDashboard(daily, stats) {
  statsData = stats;
  renderDailyChart(daily);
  renderPieChart(statsData);
}

async function refreshDashboard() {
  const [daily, stats] = await Promise.all([fetchDailyData(), fetchStatsData()]);
  renderDashboard(daily, stats);
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
