#!/usr/bin/env python3
"""Generate WebGeocalc-style parity fixtures from local SpiceyPy smoke runs."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_NODE = os.environ.get("NODE", "node")
DEFAULT_SCENARIOS = [
    "earth-moon-sun",
    "juno-jupiter",
    "mro-mars",
    "cassini-enceladus-2012",
]
DOWNLOAD_LIMITS = {
    "earth-moon-sun": 150,
    "juno-jupiter": 150,
    "mro-mars": 180,
    "cassini-enceladus-2012": 700,
}


def main(argv: list[str] | None = None) -> int:
    opts = parse_args(argv)
    opts.output_dir.mkdir(parents=True, exist_ok=True)
    for scenario in opts.scenarios:
        smoke = run_smoke(scenario, opts)
        fixture = to_fixture(smoke)
        path = opts.output_dir / f"{scenario}.json"
        path.write_text(json.dumps(fixture, indent=2), encoding="utf-8")
        print(f"Wrote {path}")
    return 0


def parse_args(argv: list[str] | None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--scenario", action="append", dest="scenarios", help="Scenario id. May be repeated.")
    p.add_argument("--output-dir", type=Path, default=ROOT / "fixtures" / "webgeocalc")
    p.add_argument("--cache-dir", type=Path, default=ROOT / ".spice-kernels")
    p.add_argument("--node", default=DEFAULT_NODE)
    p.add_argument("--download", action="store_true", default=True)
    ns = p.parse_args(argv)
    ns.scenarios = ns.scenarios or DEFAULT_SCENARIOS
    return ns


def run_smoke(scenario: str, opts: argparse.Namespace) -> dict[str, Any]:
    with tempfile.TemporaryDirectory() as tmp:
        output = Path(tmp) / f"{scenario}.json"
        cmd = [
            sys.executable,
            str(ROOT / "scripts" / "smoke-spice-geometry.py"),
            "--scenario",
            scenario,
            "--cache-dir",
            str(opts.cache_dir),
            "--node",
            opts.node,
            "--max-download-mb",
            str(DOWNLOAD_LIMITS.get(scenario, 150)),
            "--output",
            str(output),
        ]
        if opts.download:
            cmd.append("--download")
        subprocess.run(cmd, cwd=ROOT, check=True)
        return json.loads(output.read_text(encoding="utf-8"))


def to_fixture(smoke: dict[str, Any]) -> dict[str, Any]:
    return {
        "schemaVersion": 1,
        "kind": "webgeocalc-parity-fixture",
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "source": "SpiceyPy/CSPICE local smoke run",
        "scenario": smoke["scenario"],
        "observer": smoke["observer"],
        "target": smoke["target"],
        "window": smoke["window"],
        "sampleUtc": smoke["geometry"]["utc"],
        "kernels": [
            {
                "id": kernel["id"],
                "localPath": kernel["localPath"],
                "bytes": kernel["bytes"],
            }
            for kernel in smoke["kernels"]
        ],
        "expected": smoke["geometry"],
        "tolerances": {
            "rangeKm": 1e-3,
            "rangeRateKmS": 1e-9,
            "phaseAngleDeg": 1e-9,
            "latLonDeg": 1e-9,
            "unitVector": 1e-9,
        },
    }


if __name__ == "__main__":
    raise SystemExit(main())
