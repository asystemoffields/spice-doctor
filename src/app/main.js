import { SCENARIOS } from '../core/catalog.js';
import { generateDownloadList } from '../core/manifest.js';
import { buildQuestionReport } from '../core/report.js';

const CALCULATION_LABELS = {
  'state-vector': 'State vector',
  'range-rate': 'Range rate',
  'phase-angle': 'Phase angle',
  'sub-observer-point': 'Sub-observer point',
  'sub-solar-point': 'Sub-solar point',
  'instrument-fov': 'Instrument FOV',
  'attitude-matrix': 'Attitude frame',
};

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
        Start from
        <select id="preset"></select>
      </label>
      <div class="question-grid">
        <label>
          Observer
          <input id="observer" type="text" spellcheck="false" />
        </label>
        <label>
          Target
          <input id="target" type="text" spellcheck="false" />
        </label>
        <label>
          Center
          <input id="center" type="text" spellcheck="false" />
        </label>
        <label>
          Instrument
          <input id="instrument" type="text" spellcheck="false" />
        </label>
      </div>
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
        <div id="calculations"></div>
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
      <section class="panel answer-panel">
        <h3>Answer</h3>
        <p id="answer"></p>
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
      <section class="panel">
        <h3>Browser Geometry</h3>
        <div class="browser-runner">
          <button id="pyodide-probe" type="button">Load Pyodide</button>
          <span id="pyodide-status" class="runner-status">idle</span>
        </div>
        <pre id="pyodide-output" class="compact-pre"></pre>
      </section>
    </section>
  </section>
`;

const presetSelect = byId('preset');
const calculationsEl = byId('calculations');
const observerInput = byId('observer');
const targetInput = byId('target');
const centerInput = byId('center');
const instrumentInput = byId('instrument');
const fromInput = byId('from');
const toInput = byId('to');
const runButton = byId('run');
const scenarioTitle = byId('scenario-title');
const statusPill = byId('status-pill');
const kernelCount = byId('kernel-count');
const issueCount = byId('issue-count');
const downloadSize = byId('download-size');
const answerEl = byId('answer');
const coverageEl = byId('coverage');
const kernelsEl = byId('kernels');
const diagnosticsEl = byId('diagnostics');
const codeEl = byId('code');
const pyodideProbe = byId('pyodide-probe');
const pyodideStatus = byId('pyodide-status');
const pyodideOutput = byId('pyodide-output');

let currentReport;
let activeTab = 'metakernel';

const customOption = document.createElement('option');
customOption.value = 'custom';
customOption.textContent = 'Custom question';
presetSelect.appendChild(customOption);

for (const scenario of SCENARIOS) {
  const option = document.createElement('option');
  option.value = scenario.id;
  option.textContent = scenario.name;
  presetSelect.appendChild(option);
}

presetSelect.value = 'juno-jupiter';
setInputsFromPreset();
renderCalculationControls();
render();

presetSelect.addEventListener('change', () => {
  setInputsFromPreset();
  renderCalculationControls();
  render();
});
runButton.addEventListener('click', render);
for (const input of [observerInput, targetInput, centerInput, instrumentInput, fromInput, toInput]) {
  input.addEventListener('change', () => {
    if (input !== fromInput && input !== toInput) presetSelect.value = 'custom';
    renderCalculationControls();
    render();
  });
}

for (const tab of document.querySelectorAll('.tab')) {
  tab.addEventListener('click', () => {
    activeTab = tab.dataset.tab ?? 'metakernel';
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
    renderCode();
  });
}

pyodideProbe.addEventListener('click', async () => {
  pyodideProbe.disabled = true;
  pyodideStatus.textContent = 'loading';
  pyodideOutput.textContent = '';
  try {
    const { probeSpiceyPy } = await import('./pyodide-runner.js');
    const result = await probeSpiceyPy({
      onStatus(status) {
        pyodideStatus.textContent = status;
      },
    });
    pyodideStatus.textContent = result.status;
    pyodideOutput.textContent = JSON.stringify(result, null, 2);
  } catch (error) {
    pyodideStatus.textContent = 'error';
    pyodideOutput.textContent = error instanceof Error ? error.message : String(error);
  } finally {
    pyodideProbe.disabled = false;
  }
});

function render() {
  currentReport = buildQuestionReport({
    presetScenarioId: presetSelect.value === 'custom' ? undefined : presetSelect.value,
    observer: observerInput.value,
    target: targetInput.value,
    center: centerInput.value,
    instrument: instrumentInput.value,
    frame: 'J2000',
    abcorr: 'LT+S',
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
  answerEl.textContent = currentReport.answer;

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

function setInputsFromPreset() {
  const scenario = SCENARIOS.find((s) => s.id === presetSelect.value) ?? SCENARIOS.find((s) => s.id === 'earth-moon-sun');
  observerInput.value = scenario.observer;
  targetInput.value = scenario.target;
  centerInput.value = scenario.center;
  instrumentInput.value = scenario.instrument?.id ?? '';
  fromInput.value = isoToLocal(scenario.sampleWindow.start);
  toInput.value = isoToLocal(scenario.sampleWindow.stop);
}

function renderCalculationControls() {
  const scenario = SCENARIOS.find((s) => s.id === presetSelect.value);
  const baseCalculations = scenario?.calculations ?? ['state-vector', 'range-rate', 'phase-angle', 'sub-observer-point', 'sub-solar-point'];
  const calculations = [...baseCalculations];
  if (!calculations.includes('instrument-fov')) calculations.push('instrument-fov');
  if (!calculations.includes('attitude-matrix')) {
    calculations.push('attitude-matrix');
  }

  calculationsEl.textContent = '';
  for (const calculation of calculations) {
    const label = document.createElement('label');
    label.className = 'check';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = calculation;
    input.checked = baseCalculations.includes(calculation);
    input.addEventListener('change', render);
    label.append(input, document.createTextNode(CALCULATION_LABELS[calculation] ?? labelRole(calculation)));
    calculationsEl.append(label);
  }
}

function selectedCalculations() {
  return [...calculationsEl.querySelectorAll('input[type="checkbox"]:checked')]
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
