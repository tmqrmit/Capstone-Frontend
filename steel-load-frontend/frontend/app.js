const API_BASE = "http://localhost:3000";

let ranges = null;          // /ranges response
let charts = {};            // Chart.js instances keyed by canvas id
let lastDashboardRows = []; // raw input rows used for the dashboard (for load-type mix etc.)

// ---------------------------------------------------------------
// Boot
// ---------------------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
  wireTabs();
  wireDashboardControls();
  wireCsvUpload();
  checkApi();
  loadRanges();
  wirePredictForm();
});

// ---------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------
function wireTabs(){
  document.querySelectorAll(".tab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach(t => { t.classList.remove("active"); t.setAttribute("aria-selected","false"); });
      tab.classList.add("active");
      tab.setAttribute("aria-selected","true");
      const view = tab.dataset.view;
      document.getElementById("dashboard-view").hidden = view !== "dashboard";
      document.getElementById("predict-view").hidden = view !== "predict";
    });
  });
}

// ---------------------------------------------------------------
// API status
// ---------------------------------------------------------------
async function checkApi(){
  const dot = document.getElementById("apiDot");
  const text = document.getElementById("apiStatusText");
  document.getElementById("apiUrlLabel").textContent = API_BASE;
  try{
    const res = await fetch(`${API_BASE}/`);
    if(!res.ok) throw new Error("bad status");
    dot.className = "dot ok";
    text.textContent = "API connected";
  }catch(e){
    dot.className = "dot err";
    text.textContent = "API not reachable — start rf_model.py";
  }
}

// ---------------------------------------------------------------
// Ranges (feature min/max/mean, categories) — powers both views
// ---------------------------------------------------------------
async function loadRanges(){
  try{
    const res = await fetch(`${API_BASE}/ranges`);
    ranges = await res.json();
  }catch(e){
    // Fallback so the UI still works if /ranges isn't available
    ranges = {
      features: {
        "Lagging_Current_Reactive.Power_kVarh": {min:0,max:96.91,mean:13.04,unit:"kVarh"},
        "Leading_Current_Reactive_Power_kVarh": {min:0,max:27.76,mean:3.87,unit:"kVarh"},
        "CO2(tCO2)": {min:0,max:0.07,mean:0.0115,unit:"tCO2"},
        "Lagging_Current_Power_Factor": {min:0,max:100,mean:80.58,unit:"%"},
        "Leading_Current_Power_Factor": {min:0,max:100,mean:84.37,unit:"%"},
        "NSM": {min:0,max:85500,mean:42750,unit:"seconds since midnight"}
      },
      loadTypes: ["Light_Load","Medium_Load","Maximum_Load"],
      daysOfWeek: ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"],
      target: {min:0,max:157.18,mean:27.39}
    };
  }
  populatePredictForm();
}

// ---------------------------------------------------------------
// Dashboard: controls
// ---------------------------------------------------------------
function wireDashboardControls(){
  document.getElementById("genSampleBtn").addEventListener("click", async () => {
    if(!ranges) await loadRanges();
    const rows = generateSampleBatch(40);
    lastDashboardRows = rows;
    runDashboard(rows);
  });
}

function randBetween(min,max){ return min + Math.random()*(max-min); }
function pick(arr){ return arr[Math.floor(Math.random()*arr.length)]; }

function generateSampleBatch(n){
  const f = ranges.features;
  const rows = [];
  for(let i=0;i<n;i++){
    rows.push({
      "Lagging_Current_Reactive.Power_kVarh": round2(randBetween(f["Lagging_Current_Reactive.Power_kVarh"].min, f["Lagging_Current_Reactive.Power_kVarh"].max)),
      "Leading_Current_Reactive_Power_kVarh": round2(randBetween(f["Leading_Current_Reactive_Power_kVarh"].min, f["Leading_Current_Reactive_Power_kVarh"].max)),
      "CO2(tCO2)": round3(randBetween(f["CO2(tCO2)"].min, f["CO2(tCO2)"].max)),
      "Lagging_Current_Power_Factor": round2(randBetween(f["Lagging_Current_Power_Factor"].min, f["Lagging_Current_Power_Factor"].max)),
      "Leading_Current_Power_Factor": round2(randBetween(f["Leading_Current_Power_Factor"].min, f["Leading_Current_Power_Factor"].max)),
      "NSM": Math.round(randBetween(f.NSM.min, f.NSM.max)),
      "Load_Type": pick(ranges.loadTypes),
      "Day_of_week": pick(ranges.daysOfWeek)
    });
  }
  return rows;
}

function round2(v){ return Math.round(v*100)/100; }
function round3(v){ return Math.round(v*1000)/1000; }

// ---------------------------------------------------------------
// Dashboard: CSV upload
// ---------------------------------------------------------------
function wireCsvUpload(){
  document.getElementById("csvInput").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if(!file) return;
    Papa.parse(file, {
      header: true,
      dynamicTyping: true,
      skipEmptyLines: true,
      complete: (results) => {
        const rows = results.data;
        if(!rows.length){ alert("No rows found in that CSV."); return; }
        lastDashboardRows = rows;
        runDashboard(rows);
      },
      error: (err) => alert("Could not parse CSV: " + err.message)
    });
  });
}

// ---------------------------------------------------------------
// Dashboard: run + render
// ---------------------------------------------------------------
async function runDashboard(rows){
  document.getElementById("dashboardEmpty").style.display = "none";
  try{
    const res = await fetch(`${API_BASE}/dashboard`, {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify(rows)
    });
    const data = await res.json();
    if(data.error){ alert("API error: " + data.error); return; }
    renderDashboard(data);
  }catch(e){
    alert("Could not reach the API at " + API_BASE + ". Is rf_model.py running?");
  }
}

function renderDashboard(data){
  const s = data.summary;
  document.getElementById("mRecords").textContent = s.totalRecords;
  document.getElementById("mAvg").textContent = s.averagePrediction;
  document.getElementById("mMax").textContent = s.maximumPrediction;
  document.getElementById("mMin").textContent = s.minimumPrediction;
  document.getElementById("mStd").textContent = s.standardDeviation;

  renderSeriesChart(data.chartData);
  renderImportanceChart(data.featureImportance);
  renderDistChart(data.chartData);
  renderLoadTypeChart(data.predictions);
  renderTable(data.predictions);
}

function destroyChart(id){
  if(charts[id]){ charts[id].destroy(); delete charts[id]; }
}

const chartFont = { family: "'IBM Plex Mono', monospace", size: 11 };
const gridColor = "#2e353b";
const textColor = "#97a0a6";

function renderSeriesChart(chartData){
  destroyChart("chartSeries");
  const ctx = document.getElementById("chartSeries");
  charts.chartSeries = new Chart(ctx, {
    type: "line",
    data: {
      labels: chartData.map(d => d.index),
      datasets: [{
        label: "Predicted Usage (kWh)",
        data: chartData.map(d => d.prediction),
        borderColor: "#ef8354",
        backgroundColor: "#ef835426",
        fill: true,
        tension: 0.3,
        pointRadius: 2,
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display:false } },
      scales: {
        x: { ticks: { color: textColor, font: chartFont, maxTicksLimit: 12 }, grid: { color: gridColor } },
        y: { ticks: { color: textColor, font: chartFont }, grid: { color: gridColor } }
      }
    }
  });
}

function renderImportanceChart(featureImportance){
  destroyChart("chartImportance");
  const ctx = document.getElementById("chartImportance");
  charts.chartImportance = new Chart(ctx, {
    type: "bar",
    data: {
      labels: featureImportance.map(f => f.feature),
      datasets: [{
        data: featureImportance.map(f => f.importance),
        backgroundColor: "#4fb8d9",
        borderRadius: 4
      }]
    },
    options: {
      indexAxis: "y",
      responsive: true,
      plugins: { legend: { display:false } },
      scales: {
        x: { ticks: { color: textColor, font: chartFont }, grid: { color: gridColor } },
        y: { ticks: { color: textColor, font: { family: "'IBM Plex Sans', sans-serif", size: 11.5 } }, grid: { display:false } }
      }
    }
  });
}

function renderDistChart(chartData){
  destroyChart("chartDist");
  const values = chartData.map(d => d.prediction);
  const min = Math.min(...values), max = Math.max(...values);
  const bins = 10;
  const width = (max - min) / bins || 1;
  const counts = new Array(bins).fill(0);
  values.forEach(v => {
    let idx = Math.floor((v - min) / width);
    if(idx >= bins) idx = bins - 1;
    if(idx < 0) idx = 0;
    counts[idx]++;
  });
  const labels = counts.map((_,i) => (min + i*width).toFixed(0));

  const ctx = document.getElementById("chartDist");
  charts.chartDist = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [{ data: counts, backgroundColor: "#ef8354", borderRadius: 3 }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display:false } },
      scales: {
        x: { title: { display:true, text:"kWh", color:textColor, font: chartFont }, ticks: { color: textColor, font: chartFont }, grid: { display:false } },
        y: { ticks: { color: textColor, font: chartFont }, grid: { color: gridColor } }
      }
    }
  });
}

function renderLoadTypeChart(predictions){
  destroyChart("chartLoadType");
  const counts = {};
  predictions.forEach(p => {
    const key = p.Load_Type || "Unknown";
    counts[key] = (counts[key] || 0) + 1;
  });
  const ctx = document.getElementById("chartLoadType");
  charts.chartLoadType = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: Object.keys(counts),
      datasets: [{
        data: Object.values(counts),
        backgroundColor: ["#ef8354", "#4fb8d9", "#e0b23a", "#6fbf73"],
        borderColor: "#1b1f23",
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position:"bottom", labels: { color: textColor, font: { family:"'IBM Plex Sans', sans-serif", size: 11.5 }, boxWidth: 12 } }
      }
    }
  });
}

function renderTable(predictions){
  const head = document.getElementById("tableHead");
  const body = document.getElementById("tableBody");
  document.getElementById("tableNote").textContent = `${predictions.length} record(s)`;
  if(!predictions.length){ head.innerHTML=""; body.innerHTML=""; return; }

  const cols = Object.keys(predictions[0]);
  head.innerHTML = cols.map(c => `<th>${c}</th>`).join("");

  const rowsToShow = predictions.slice(0, 200);
  body.innerHTML = rowsToShow.map(row => {
    return "<tr>" + cols.map(c => {
      const isPred = c === "Predicted_Usage_kWh";
      const val = row[c];
      return `<td class="${isPred ? 'pred-col' : ''}">${val}</td>`;
    }).join("") + "</tr>";
  }).join("");
}

// ---------------------------------------------------------------
// Predict view
// ---------------------------------------------------------------
const fieldMap = [
  { key: "Lagging_Current_Reactive.Power_kVarh", input: "f_lag", range: "f_lag_range", step: 0.1 },
  { key: "Leading_Current_Reactive_Power_kVarh", input: "f_lead", range: "f_lead_range", step: 0.1 },
  { key: "CO2(tCO2)", input: "f_co2", range: "f_co2_range", step: 0.001 },
  { key: "Lagging_Current_Power_Factor", input: "f_lagpf", range: "f_lagpf_range", step: 0.1 },
  { key: "Leading_Current_Power_Factor", input: "f_leadpf", range: "f_leadpf_range", step: 0.1 },
  { key: "NSM", input: "f_nsm", range: "f_nsm_range", step: 1 }
];

function populatePredictForm(){
  if(!ranges) return;

  fieldMap.forEach(fm => {
    const stats = ranges.features[fm.key];
    if(!stats) return;
    const numEl = document.getElementById(fm.input);
    const rangeEl = document.getElementById(fm.range);
    [numEl, rangeEl].forEach(el => {
      el.min = stats.min;
      el.max = stats.max;
      el.step = fm.step;
    });
    const start = round2(stats.mean);
    numEl.value = start;
    rangeEl.value = start;
  });
  syncNsmClock();

  const loadSel = document.getElementById("f_loadtype");
  loadSel.innerHTML = ranges.loadTypes.map(l => `<option value="${l}">${l.replace("_"," ")}</option>`).join("");

  const daySel = document.getElementById("f_day");
  daySel.innerHTML = ranges.daysOfWeek.map(d => `<option value="${d}">${d}</option>`).join("");
}

function wirePredictForm(){
  fieldMap.forEach(fm => {
    const numEl = document.getElementById(fm.input);
    const rangeEl = document.getElementById(fm.range);
    numEl.addEventListener("input", () => { rangeEl.value = numEl.value; if(fm.key === "NSM") syncNsmClock(); });
    rangeEl.addEventListener("input", () => { numEl.value = rangeEl.value; if(fm.key === "NSM") syncNsmClock(); });
  });

  document.getElementById("predictForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    await runPredict();
  });

  drawGauge(0);
}

function syncNsmClock(){
  const nsm = Number(document.getElementById("f_nsm").value || 0);
  const h = Math.floor(nsm / 3600);
  const m = Math.floor((nsm % 3600) / 60);
  document.getElementById("f_nsm_clock").textContent =
    String(h).padStart(2,"0") + ":" + String(m).padStart(2,"0");
}

async function runPredict(){
  const btn = document.getElementById("predictBtn");
  btn.disabled = true;
  btn.textContent = "Running…";

  const record = {
    "Lagging_Current_Reactive.Power_kVarh": Number(document.getElementById("f_lag").value),
    "Leading_Current_Reactive_Power_kVarh": Number(document.getElementById("f_lead").value),
    "CO2(tCO2)": Number(document.getElementById("f_co2").value),
    "Lagging_Current_Power_Factor": Number(document.getElementById("f_lagpf").value),
    "Leading_Current_Power_Factor": Number(document.getElementById("f_leadpf").value),
    "NSM": Number(document.getElementById("f_nsm").value),
    "Load_Type": document.getElementById("f_loadtype").value,
    "Day_of_week": document.getElementById("f_day").value
  };

  try{
    const res = await fetch(`${API_BASE}/dashboard`, {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify(record)
    });
    const data = await res.json();
    if(data.error){ alert("API error: " + data.error); return; }

    const predicted = data.predictions[0].Predicted_Usage_kWh;
    document.getElementById("predValue").textContent = predicted;
    drawGauge(predicted);

    const avg = ranges ? ranges.target.mean : 27.39;
    const diff = predicted - avg;
    const dir = diff >= 0 ? "above" : "below";
    document.getElementById("predContext").textContent =
      `${Math.abs(diff).toFixed(1)} kWh ${dir} the typical interval average (${avg} kWh).`;

    renderMiniImportance(data.featureImportance);
  }catch(e){
    alert("Could not reach the API at " + API_BASE + ". Is rf_model.py running?");
  }finally{
    btn.disabled = false;
    btn.textContent = "Run prediction";
  }
}

function renderMiniImportance(featureImportance){
  const wrap = document.getElementById("miniImportanceList");
  const top = featureImportance.slice(0, 5);
  const maxImp = Math.max(...top.map(f => f.importance));
  wrap.innerHTML = top.map(f => `
    <div class="mi-row">
      <span class="mi-label">${f.feature}</span>
      <div class="mi-bar-track"><div class="mi-bar-fill" style="width:${(f.importance/maxImp*100).toFixed(0)}%"></div></div>
    </div>
  `).join("");
}

// Semicircle gauge: 0 -> target.max range
function drawGauge(value){
  const max = ranges ? ranges.target.max : 157.18;
  const clamped = Math.max(0, Math.min(value, max));
  const frac = clamped / max;

  const cx = 110, cy = 110, r = 90;
  const startAngle = Math.PI;      // 180deg (left)
  const endAngle = 0;              // 0deg (right), sweeping through top
  const arcPoint = (angle) => [cx + r*Math.cos(angle), cy - r*Math.sin(Math.max(0,angle))];

  function describeArc(fracEnd){
    const a0 = startAngle;
    const a1 = startAngle - (startAngle) * fracEnd; // sweep from PI down to PI*(1-fracEnd)
    const sweepAngle = Math.PI * fracEnd;
    const endA = startAngle - sweepAngle;
    const [x0,y0] = [cx + r*Math.cos(a0), cy - r*Math.sin(a0)];
    const [x1,y1] = [cx + r*Math.cos(endA), cy - r*Math.sin(endA)];
    const largeArc = sweepAngle > Math.PI ? 1 : 0;
    return `M ${x0} ${y0} A ${r} ${r} 0 ${largeArc} 1 ${x1} ${y1}`;
  }

  document.getElementById("gaugeTrack").setAttribute("d", describeArc(1));
  document.getElementById("gaugeFill").setAttribute("d", describeArc(frac));

  const fill = document.getElementById("gaugeFill");
  if(frac > 0.75) fill.style.stroke = "#e05a4f";
  else if(frac > 0.45) fill.style.stroke = "#ef8354";
  else fill.style.stroke = "#6fbf73";
}
