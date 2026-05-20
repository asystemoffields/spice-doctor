#!/usr/bin/env python3
"""Run a live SpiceyPy geometry smoke test for a spice-doctor scenario."""

from __future__ import annotations

import argparse
import json
import math
import os
import subprocess
import tempfile
import urllib.request
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

try:
    import spiceypy as spice
except ImportError as exc:  # pragma: no cover - exercised manually
    raise SystemExit(
        "SpiceyPy is required for the geometry smoke test.\n"
        "Install it with:\n"
        "  python -m pip install -r requirements-spice.txt\n"
    ) from exc


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CACHE = ROOT / ".spice-kernels"
DEFAULT_NODE = os.environ.get("NODE", "node")


@dataclass
class SmokeOptions:
    scenario: str
    start: str | None
    stop: str | None
    cache_dir: Path
    output: Path
    download: bool
    max_download_mb: float
    node: str


def main(argv: list[str] | None = None) -> int:
    opts = parse_args(argv)
    report = load_report(opts)
    if report["status"] != "ready":
        write_output(opts.output, {"status": "blocked", "reportStatus": report["status"], "issues": report["issues"]})
        raise SystemExit(f"Scenario is {report['status']}; see {opts.output}")

    opts.cache_dir.mkdir(parents=True, exist_ok=True)
    kernel_files = []
    for kernel in report["kernels"]:
        path, downloaded = ensure_kernel(kernel, opts)
        kernel_files.append(
            {
                "id": kernel["id"],
                "localPath": kernel["localPath"],
                "file": str(path),
                "bytes": path.stat().st_size,
                "downloaded": downloaded,
            }
        )

    try:
        for item in kernel_files:
            spice.furnsh(item["file"])
        result = run_geometry(report)
    finally:
        spice.kclear()

    payload = {
        "status": "ok",
        "scenario": report["scenario"]["id"],
        "observer": report["scenario"]["observer"],
        "target": report["scenario"]["target"],
        "window": report["request"]["window"],
        "kernelCount": len(kernel_files),
        "kernels": kernel_files,
        "geometry": result,
        "spiceypyVersion": getattr(spice, "__version__", "unknown"),
    }
    write_output(opts.output, payload)
    print(f"Wrote {opts.output}")
    print(json.dumps(result, indent=2))
    return 0


def parse_args(argv: list[str] | None) -> SmokeOptions:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--scenario", default="juno-jupiter", help="Scenario id to test.")
    p.add_argument("--from", dest="start", help="UTC start. Defaults to the scenario sample window.")
    p.add_argument("--to", dest="stop", help="UTC stop. Defaults to the scenario sample window.")
    p.add_argument("--cache-dir", type=Path, default=DEFAULT_CACHE)
    p.add_argument("--output", type=Path, default=ROOT / "artifacts" / "spice-geometry-smoke.json")
    p.add_argument("--download", action="store_true", help="Download missing kernels into the cache.")
    p.add_argument("--max-download-mb", type=float, default=150, help="Per-kernel download limit.")
    p.add_argument("--node", default=DEFAULT_NODE, help="Node executable used to run the CLI.")
    ns = p.parse_args(argv)
    return SmokeOptions(
        scenario=ns.scenario,
        start=ns.start,
        stop=ns.stop,
        cache_dir=ns.cache_dir,
        output=ns.output,
        download=ns.download,
        max_download_mb=ns.max_download_mb,
        node=ns.node,
    )


def load_report(opts: SmokeOptions) -> dict[str, Any]:
    cmd = [opts.node, str(ROOT / "src" / "cli.js"), "--scenario", opts.scenario, "--json"]
    if opts.start:
        cmd.extend(["--from", opts.start])
    if opts.stop:
        cmd.extend(["--to", opts.stop])

    try:
        proc = subprocess.run(
            cmd,
            cwd=ROOT,
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
    except FileNotFoundError as exc:
        raise SystemExit(f"Node executable not found: {opts.node}") from exc
    except subprocess.CalledProcessError as exc:
        raise SystemExit(exc.stderr or exc.stdout) from exc
    return json.loads(proc.stdout)


def run_geometry(report: dict[str, Any]) -> dict[str, Any]:
    scenario = report["scenario"]
    window = report["request"]["window"]
    utc = midpoint_utc(window["start"], window["stop"])
    et = spice.utc2et(utc)

    state, light_time = spice.spkezr(
        scenario["target"],
        et,
        scenario["frame"],
        scenario["abcorr"],
        scenario["observer"],
    )
    position = state[:3]
    velocity = state[3:]
    range_km = float(spice.vnorm(position))
    range_rate_km_s = float(spice.vdot(position, velocity) / range_km)
    phase_deg = float(spice.dpr() * spice.phaseq(et, scenario["target"], "SUN", scenario["observer"], scenario["abcorr"]))

    if range_km <= 0 or not math.isfinite(range_km):
        raise RuntimeError(f"Invalid range_km: {range_km}")
    if not math.isfinite(range_rate_km_s):
        raise RuntimeError(f"Invalid range_rate_km_s: {range_rate_km_s}")
    if phase_deg < 0 or phase_deg > 180:
        raise RuntimeError(f"Invalid phase_angle_deg: {phase_deg}")

    body_frame = "IAU_" + scenario["target"].replace(" ", "_")
    sub_observer = surface_point("sub_observer", spice.subpnt, scenario, et, body_frame)
    sub_solar = surface_point("sub_solar", spice.subslr, scenario, et, body_frame)

    return {
        "utc": utc,
        "rangeKm": range_km,
        "rangeRateKmS": range_rate_km_s,
        "lightTimeS": float(light_time),
        "phaseAngleDeg": phase_deg,
        "subObserver": sub_observer,
        "subSolar": sub_solar,
    }


def surface_point(name: str, fn: Any, scenario: dict[str, Any], et: float, body_frame: str) -> dict[str, float]:
    spoint, trgepc, srfvec = fn(
        "Near point: ellipsoid",
        scenario["target"],
        et,
        body_frame,
        scenario["abcorr"],
        scenario["observer"],
    )
    radius, lon, lat = spice.reclat(spoint)
    distance = spice.vnorm(srfvec)
    values = {
        "latDeg": float(spice.dpr() * lat),
        "lonDeg": float(spice.dpr() * lon),
        "radiusKm": float(radius),
        "surfaceVectorKm": float(distance),
        "targetEpochEt": float(trgepc),
    }
    for key, value in values.items():
        if not math.isfinite(value):
            raise RuntimeError(f"Invalid {name}.{key}: {value}")
    return values


def ensure_kernel(kernel: dict[str, Any], opts: SmokeOptions) -> tuple[Path, bool]:
    path = opts.cache_dir / kernel["localPath"]
    if path.exists():
        return path, False
    if not opts.download:
        raise RuntimeError(f"Missing local kernel {path}. Re-run with --download to cache it.")

    limit_bytes = int(opts.max_download_mb * 1024 * 1024)
    size_mb = kernel.get("sizeMb")
    if size_mb is not None and float(size_mb) > opts.max_download_mb:
        raise RuntimeError(
            f"Refusing to download {kernel['id']} ({size_mb} MB) above --max-download-mb={opts.max_download_mb}."
        )

    path.parent.mkdir(parents=True, exist_ok=True)
    print(f"Downloading {kernel['url']} -> {path}")
    tmp_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, dir=path.parent) as tmp:
            tmp_path = Path(tmp.name)
            with urllib.request.urlopen(kernel["url"], timeout=120) as response:
                content_length = response.headers.get("Content-Length")
                if content_length is not None and int(content_length) > limit_bytes:
                    content_mb = int(content_length) / (1024 * 1024)
                    raise RuntimeError(
                        f"Refusing to download {kernel['id']} ({content_mb:.1f} MB) above "
                        f"--max-download-mb={opts.max_download_mb}."
                    )
                total = 0
                while True:
                    chunk = response.read(1024 * 1024)
                    if not chunk:
                        break
                    total += len(chunk)
                    if total > limit_bytes:
                        raise RuntimeError(
                            f"Refusing to continue download for {kernel['id']} above "
                            f"--max-download-mb={opts.max_download_mb}."
                        )
                    tmp.write(chunk)
        tmp_path.replace(path)
    except Exception:
        if tmp_path is not None and tmp_path.exists():
            tmp_path.unlink()
        raise
    return path, True


def midpoint_utc(start: str, stop: str) -> str:
    start_dt = datetime.fromisoformat(start.replace("Z", "+00:00"))
    stop_dt = datetime.fromisoformat(stop.replace("Z", "+00:00"))
    mid = start_dt + (stop_dt - start_dt) / 2
    return mid.isoformat(timespec="milliseconds").replace("+00:00", "Z").replace(".000Z", "Z")


def write_output(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


if __name__ == "__main__":
    raise SystemExit(main())
