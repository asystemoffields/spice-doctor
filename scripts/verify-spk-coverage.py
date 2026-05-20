#!/usr/bin/env python3
"""Audit curated SPICE kernel coverage against real SPK metadata.

This script keeps the app itself lightweight while giving maintainers a real
SPICE verification path. It reads the JavaScript catalog through
`scripts/export-catalog.js`, downloads selected SPK kernels into a local cache,
uses SpiceyPy/CSPICE to read object IDs and coverage windows, and writes an
audit JSON report.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
import tempfile
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:
    import spiceypy as spice
except ImportError as exc:  # pragma: no cover - exercised manually
    raise SystemExit(
        "SpiceyPy is required for real SPK coverage audits.\n"
        "Install it with:\n"
        "  python -m pip install -r requirements-spice.txt\n"
    ) from exc


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CACHE = ROOT / ".spice-kernels"
DEFAULT_NODE = os.environ.get("NODE", "node")


@dataclass
class AuditOptions:
    scenario: str | None
    cache_dir: Path
    output: Path
    download: bool
    max_download_mb: float
    node: str


def main(argv: list[str] | None = None) -> int:
    opts = parse_args(argv)
    catalog = load_catalog(opts.node)
    kernels = catalog["kernels"]
    scenarios = catalog["scenarios"]

    if opts.scenario:
        scenario = next((s for s in scenarios if s["id"] == opts.scenario), None)
        if scenario is None:
            raise SystemExit(f"Unknown scenario: {opts.scenario}")
        wanted_roles = set(scenario["requiredRoles"]) | set(scenario["optionalRoles"])
        wanted_observer = scenario["observer"].upper()
        kernels = [
            k
            for k in kernels
            if k["role"] in wanted_roles
            and (
                k["role"] != "spacecraft-trajectory"
                or wanted_observer in [body.upper() for body in k.get("bodies", [])]
            )
        ]

    opts.cache_dir.mkdir(parents=True, exist_ok=True)
    audit = {
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "scenario": opts.scenario,
        "cacheDir": str(opts.cache_dir),
        "spiceypyVersion": getattr(spice, "__version__", "unknown"),
        "kernels": [],
        "summary": {"checked": 0, "downloaded": 0, "skipped": 0, "errors": 0},
    }

    lsk = next((k for k in kernels if k["type"] == "LSK"), None) or next(
        (k for k in catalog["kernels"] if k["type"] == "LSK"),
        None,
    )
    if lsk is not None:
        lsk_path, lsk_downloaded = ensure_kernel(lsk, opts)
        if lsk_path is not None:
            spice.furnsh(str(lsk_path))
            if lsk_downloaded:
                audit["summary"]["downloaded"] += 1

    try:
        for kernel in kernels:
            audit_kernel(kernel, opts, audit)
    finally:
        spice.kclear()

    opts.output.parent.mkdir(parents=True, exist_ok=True)
    opts.output.write_text(json.dumps(audit, indent=2), encoding="utf-8")
    print(f"Wrote {opts.output}")
    print(json.dumps(audit["summary"], indent=2))
    return 0 if audit["summary"]["errors"] == 0 else 1


def audit_kernel(kernel: dict[str, Any], opts: AuditOptions, audit: dict[str, Any]) -> None:
    if kernel["type"] != "SPK":
        audit["kernels"].append(skip(kernel, "not-spk"))
        audit["summary"]["skipped"] += 1
        return

    try:
        path, downloaded = ensure_kernel(kernel, opts)
        if path is None:
            audit["kernels"].append(skip(kernel, "missing-local-file"))
            audit["summary"]["skipped"] += 1
            return
        if downloaded:
            audit["summary"]["downloaded"] += 1
        result = inspect_spk(kernel, path)
        audit["kernels"].append(result)
        audit["summary"]["checked"] += 1
    except Exception as exc:  # pragma: no cover - diagnostic path
        audit["kernels"].append(
            {
                "id": kernel["id"],
                "name": kernel["name"],
                "type": kernel["type"],
                "role": kernel["role"],
                "url": kernel["url"],
                "status": "error",
                "error": str(exc),
            }
        )
        audit["summary"]["errors"] += 1


def parse_args(argv: list[str] | None) -> AuditOptions:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--scenario", help="Limit audit to one scenario id.")
    p.add_argument("--cache-dir", type=Path, default=DEFAULT_CACHE)
    p.add_argument("--output", type=Path, default=ROOT / "artifacts" / "spk-coverage-audit.json")
    p.add_argument("--download", action="store_true", help="Download missing SPK kernels into the cache.")
    p.add_argument(
        "--max-download-mb",
        type=float,
        default=80,
        help="Per-kernel download limit. Use a larger value for Juno/MRO reconstructed kernels.",
    )
    p.add_argument("--node", default=DEFAULT_NODE, help="Node executable used to export the JS catalog.")
    ns = p.parse_args(argv)
    return AuditOptions(
        scenario=ns.scenario,
        cache_dir=ns.cache_dir,
        output=ns.output,
        download=ns.download,
        max_download_mb=ns.max_download_mb,
        node=ns.node,
    )


def load_catalog(node: str) -> dict[str, Any]:
    script = ROOT / "scripts" / "export-catalog.js"
    try:
        proc = subprocess.run(
            [node, str(script)],
            cwd=ROOT,
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
    except FileNotFoundError as exc:
        raise SystemExit(f"Node executable not found: {node}") from exc
    except subprocess.CalledProcessError as exc:
        raise SystemExit(exc.stderr or exc.stdout) from exc
    return json.loads(proc.stdout)


def ensure_kernel(kernel: dict[str, Any], opts: AuditOptions) -> tuple[Path | None, bool]:
    path = opts.cache_dir / kernel["localPath"]
    if path.exists():
        return path, False
    if not opts.download:
        return None, False

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


def inspect_spk(kernel: dict[str, Any], path: Path) -> dict[str, Any]:
    ids = sorted(int(x) for x in spice.spkobj(str(path)))
    objects = []
    union_start: str | None = None
    union_stop: str | None = None

    for body_id in ids:
        window = spice.spkcov(str(path), body_id)
        intervals = []
        for i in range(spice.wncard(window)):
            start_et, stop_et = spice.wnfetd(window, i)
            start = et_to_iso(start_et)
            stop = et_to_iso(stop_et)
            intervals.append({"start": start, "stop": stop})
            union_start = start if union_start is None or start < union_start else union_start
            union_stop = stop if union_stop is None or stop > union_stop else union_stop
        objects.append({"id": body_id, "name": safe_body_name(body_id), "coverage": intervals})

    catalog_coverage = kernel.get("coverage")
    computed_coverage = (
        {"start": union_start, "stop": union_stop}
        if union_start is not None and union_stop is not None
        else None
    )
    catalog_matches = coverage_contains(computed_coverage, catalog_coverage)
    return {
        "id": kernel["id"],
        "name": kernel["name"],
        "type": kernel["type"],
        "role": kernel["role"],
        "url": kernel["url"],
        "localPath": kernel["localPath"],
        "status": "checked",
        "sha256": sha256(path),
        "bytes": path.stat().st_size,
        "catalogCoverage": catalog_coverage,
        "computedCoverage": computed_coverage,
        "catalogCoverageContained": catalog_matches,
        "objectCount": len(objects),
        "objects": objects,
    }


def safe_body_name(body_id: int) -> str:
    try:
        return spice.bodc2n(body_id)
    except Exception:
        return str(body_id)


def et_to_iso(et: float) -> str:
    return spice.et2utc(et, "ISOC", 3) + "Z"


def coverage_contains(computed: dict[str, str] | None, catalog: dict[str, str] | None) -> bool | None:
    if computed is None or catalog is None:
        return None
    return iso_to_dt(computed["start"]) <= iso_to_dt(catalog["start"]) and iso_to_dt(computed["stop"]) >= iso_to_dt(catalog["stop"])


def iso_to_dt(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def skip(kernel: dict[str, Any], reason: str) -> dict[str, Any]:
    return {
        "id": kernel["id"],
        "name": kernel["name"],
        "type": kernel["type"],
        "role": kernel["role"],
        "url": kernel["url"],
        "status": "skipped",
        "reason": reason,
    }


if __name__ == "__main__":
    raise SystemExit(main())
