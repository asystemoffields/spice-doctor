import { SCENARIOS } from '../core/catalog.js';
import { generateDownloadList } from '../core/manifest.js';
import { buildManifestReport } from '../core/report.js';

const root = document.querySelector('#app');
if (!root) throw new Error('Missing app root');

root.innerHTML = `
  <section class="shell">
    <aside class="sidebar">
      <div class="brand">
        <div class="mark">SD</div>
        <div>
          <h1>SPICE Doctor</h1>
          <p>Kernel manifest and coverage workbench</p>
        </div>
      </div>
      <label>
        Scenario
        <select id="scenario"></select>
      </label>
      <div class="time-grid">
        <label>
          From UTC
          <input id="from" type="text" spellcheck="false" />
        </label>
        <label>
          To UTC
          <input id="to" type="text" spellcheck="false" />
        </label>
      </div>
      <fieldset>
        <legend>Geometry products</legend>
        <label class="check"><input type="checkbox" value="state-vector" checked /> State vector</label>
        <label class="check"><input type="checkbox" value="range-rate" checked /> Range rate</label>
        <label class="check"><input type="checkbox" value="phase-angle" checked /> Phase angle</label>
        <label class="check"><input type="checkbox" value="sub-observer-point" checked /> Sub-observer point</label>
        <label class="check"><input type="checkbox" value="sub-solar-point" checked /> Sub-solar point</label>
      </fieldset>
      <button id="run" type="button">Resolve manifest</button>
    </aside>
    <section class="workspace">
      <header class="topbar">
        <div>
          <p class="eyebrow">NAIF kernel readiness</p>
          <h2 id="scenario-title"></h2>
        </div>
        <span id="status-pill" class="pill"></span>
      </header>
      <section class="summary">
        <div>
          <span class="metric" id="kernel-count"></span>
          <span class="label">kernels selected</span>
        </div>
        <div>
          <span class="metric" id="issue-count"></span>
          <span class="label">diagnostics</span>
        </div>
        <div>
          <span class="metric" id="download-size"></span>
          <span class="label">catalog size</span>
        </div>
      </section>
      <section class="panel">
        <h3>Coverage</h3>
        <div id="coverage"></div>
      </section>
      <section class="split">
        <article class="panel">
          <h3>Kernels</h3>
          <div id="kernels"></div>
        </article>
        <article class="panel">
          <h3>Diagnostics</h3>
          <div id="diagnostics"></div>
        </article>
      </section>
      <section class="tabs">
        <div class="tab-buttons">
          <button class="tab active" type="button" data-tab="metakernel">Meta-kernel</button>
          <button class="tab" type="button" data-tab="recipe">SpiceyPy</button>
          <button class="tab" type="button" data-tab="downloads">Downloads</button>
        </div>
        <pre id="code"></pre>
      </section>
    </section>
  </section>
`;

const scenarioSelect = byId('scenario');
const fromInput = byId('from');
const toInput = byId('to');
const runButton = byId('run');
const scenarioTitle = byId('scenario-title');
const statusPill = byId('status-pill');
const kernelCount = byId('kernel-count');
const issueCount = byId('issue-count');
const downloadSize = byId('download-size');
const coverageEl = byId('coverage');
const kernelsEl = byId('kernels');
const diagnosticsEl = byId('diagnostics');
const codeEl = byId('code');

let currentReport;
let activeTab = 'metakernel';

for (const scenario of SCENARIOS) {
  const option = document.createElement('option');
  option.value = scenario.id;
  option.textContent = scenario.name;
  scenarioSelect.appendChild(option);
}

scenarioSelect.value = 'juno-jupiter';
setInputsFromScenario();
render();

scenarioSelect.addEventListener('change', () => {
  setInputsFromScenario();
  render();
});
runButton.addEventListener('click', render);
for (const input of document.querySelectorAll('input[type="checkbox"]')) {
  input.addEventListener('change', render);
}

for (const tab of document.querySelectorAll('.tab')) {
  tab.addEventListener('click', () => {
    activeTab = tab.dataset.tab ?? 'metakernel';
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
    renderCode();
  });
}

function render() {
  const scenario = SCENARIOS.find((s) => s.id === scenarioSelect.value);
  currentReport = buildManifestReport({
    scenarioId: scenario.id,
    window: {
      start: localToIso(fromInput.value),
      stop: localToIso(toInput.value),
    },
    calculations: selectedCalculations(),
  });

  scenarioTitle.textContent = currentReport.scenario.name;
  statusPill.textContent = currentReport.status;
  statusPill.className = `pill ${currentReport.status}`;
  kernelCount.textContent = String(currentReport.kernels.length);
  issueCount.textContent = String(currentReport.issues.length);
  const mb = currentReport.kernels.reduce((sum, kernel) => sum + (kernel.sizeMb ?? 0), 0);
  downloadSize.textContent = mb > 0 ? `${Math.round(mb)} MB` : 'cataloged';

  renderCoverage(currentReport.selections);
  renderKernels();
  renderDiagnostics();
  renderCode();
}

function renderCoverage(selections) {
  coverageEl.textContent = '';
  for (const selection of selections) {
    const row = document.createElement('div');
    row.className = `coverage-row ${selection.covered ? 'ok' : selection.required ? 'bad' : 'warn'}`;
    row.innerHTML = `
      <div class="coverage-head">
        <strong>${labelRole(selection.role)}</strong>
        <span>${selection.required ? 'required' : 'optional'}</span>
      </div>
      <div class="bar">
        <span style="width:${selection.covered ? '100' : '42'}%"></span>
      </div>
      <p>${selection.message}</p>
    `;
    coverageEl.appendChild(row);
  }
}

function renderKernels() {
  kernelsEl.textContent = '';
  for (const kernel of currentReport.kernels) {
    const row = document.createElement('a');
    row.className = 'kernel-row';
    row.href = kernel.url;
    row.target = '_blank';
    row.rel = 'noreferrer';
    row.innerHTML = `
      <span class="kernel-type">${kernel.type}</span>
      <span>
        <strong>${kernel.name}</strong>
        <small>${kernel.localPath}</small>
      </span>
    `;
    kernelsEl.appendChild(row);
  }
}

function renderDiagnostics() {
  diagnosticsEl.textContent = '';
  if (currentReport.issues.length === 0) {
    diagnosticsEl.innerHTML = '<p class="empty">Ready for a first SpiceyPy run.</p>';
    return;
  }
  for (const issue of currentReport.issues) {
    const row = document.createElement('div');
    row.className = `diagnostic ${issue.severity}`;
    row.innerHTML = `
      <strong>${issue.code}</strong>
      <p>${issue.message}</p>
      ${issue.fix ? `<small>${issue.fix}</small>` : ''}
    `;
    diagnosticsEl.appendChild(row);
  }
}

function renderCode() {
  if (activeTab === 'recipe') codeEl.textContent = currentReport.spiceypyRecipe;
  else if (activeTab === 'downloads') codeEl.textContent = generateDownloadList(currentReport.kernels);
  else codeEl.textContent = currentReport.metaKernel;
}

function setInputsFromScenario() {
  const scenario = SCENARIOS.find((s) => s.id === scenarioSelect.value);
  fromInput.value = isoToLocal(scenario.sampleWindow.start);
  toInput.value = isoToLocal(scenario.sampleWindow.stop);
}

function selectedCalculations() {
  return [...document.querySelectorAll('input[type="checkbox"]:checked')]
    .map((input) => input.value);
}

function localToIso(value) {
  return new Date(value).toISOString().replace('.000Z', 'Z');
}

function isoToLocal(value) {
  return value;
}

function labelRole(role) {
  return role.replace(/-/g, ' ');
}

function byId(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el;
}
