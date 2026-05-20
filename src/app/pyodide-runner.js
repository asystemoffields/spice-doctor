const PYODIDE_VERSION = '0.29.4';
const PYODIDE_INDEX_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;
const PYODIDE_SCRIPT_URL = `${PYODIDE_INDEX_URL}pyodide.js`;

let pyodidePromise;

export async function probeSpiceyPy({ onStatus = () => {} } = {}) {
  onStatus('loading pyodide');
  const pyodide = await loadRuntime();
  const pyodideVersion = pyodide.runPython('import sys; sys.version');

  onStatus('loading micropip');
  await pyodide.loadPackage('micropip');
  const micropip = pyodide.pyimport('micropip');

  onStatus('checking spiceypy');
  try {
    return {
      status: 'spiceypy-ready',
      pyodideVersion,
      spiceypyVersion: await importSpiceyPy(pyodide),
      indexUrl: PYODIDE_INDEX_URL,
    };
  } catch (firstError) {
    onStatus('installing spiceypy');
    try {
      await micropip.install('spiceypy');
      return {
        status: 'spiceypy-ready',
        pyodideVersion,
        spiceypyVersion: await importSpiceyPy(pyodide),
        indexUrl: PYODIDE_INDEX_URL,
      };
    } catch (installError) {
      return {
        status: 'python-ready',
        pyodideVersion,
        spiceypyAvailable: false,
        indexUrl: PYODIDE_INDEX_URL,
        detail: installError instanceof Error ? installError.message : String(installError),
        firstImportError: firstError instanceof Error ? firstError.message : String(firstError),
      };
    }
  }
}

async function loadRuntime() {
  if (!pyodidePromise) {
    pyodidePromise = (async () => {
      await loadScript(PYODIDE_SCRIPT_URL);
      return globalThis.loadPyodide({ indexURL: PYODIDE_INDEX_URL });
    })();
  }
  return pyodidePromise;
}

async function importSpiceyPy(pyodide) {
  return pyodide.runPythonAsync(`
import spiceypy
getattr(spiceypy, "__version__", "unknown")
`);
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      existing.addEventListener('load', resolve, { once: true });
      existing.addEventListener('error', reject, { once: true });
      if (globalThis.loadPyodide) resolve();
      return;
    }

    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.addEventListener('load', resolve, { once: true });
    script.addEventListener('error', () => reject(new Error(`Could not load ${src}`)), { once: true });
    document.head.appendChild(script);
  });
}
