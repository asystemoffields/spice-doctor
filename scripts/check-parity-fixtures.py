#!/usr/bin/env python3
"""Validate or compare WebGeocalc-style parity fixtures."""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]


def main(argv: list[str] | None = None) -> int:
    opts = parse_args(argv)
    failures: list[str] = []
    for fixture_path in sorted(opts.fixtures.glob("*.json")):
        fixture = json.loads(fixture_path.read_text(encoding="utf-8"))
        failures.extend(validate_fixture(fixture_path, fixture))
        if opts.actual_dir:
            actual_path = opts.actual_dir / fixture_path.name
            if actual_path.exists():
                actual = json.loads(actual_path.read_text(encoding="utf-8"))
                failures.extend(compare_fixture(fixture_path, fixture, actual))
            else:
                failures.append(f"{fixture_path.name}: missing actual result {actual_path}")
    if failures:
        for failure in failures:
            print(f"FAIL {failure}")
        return 1
    print(f"Checked fixtures in {opts.fixtures}")
    return 0


def parse_args(argv: list[str] | None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--fixtures", type=Path, default=ROOT / "fixtures" / "webgeocalc")
    p.add_argument("--actual-dir", type=Path, help="Directory containing same-schema actual result JSON files.")
    return p.parse_args(argv)


def validate_fixture(path: Path, fixture: dict[str, Any]) -> list[str]:
    failures = []
    for key in ["scenario", "observer", "target", "window", "sampleUtc", "kernels", "expected", "tolerances"]:
        if key not in fixture:
            failures.append(f"{path.name}: missing {key}")
    expected = fixture.get("expected", {})
    for key in ["rangeKm", "rangeRateKmS", "phaseAngleDeg", "subObserver", "subSolar"]:
        if key not in expected:
            failures.append(f"{path.name}: missing expected.{key}")
    failures.extend(check_finite(path.name, expected))
    return failures


def compare_fixture(path: Path, fixture: dict[str, Any], actual: dict[str, Any]) -> list[str]:
    expected = fixture["expected"]
    observed = actual.get("expected", actual.get("geometry", actual))
    tolerances = fixture["tolerances"]
    checks = [
        ("rangeKm", tolerances["rangeKm"]),
        ("rangeRateKmS", tolerances["rangeRateKmS"]),
        ("phaseAngleDeg", tolerances["phaseAngleDeg"]),
    ]
    failures = []
    for key, tolerance in checks:
        delta = abs(float(expected[key]) - float(observed[key]))
        if delta > tolerance:
            failures.append(f"{path.name}: {key} delta {delta} exceeds {tolerance}")
    for point_key in ["subObserver", "subSolar"]:
        for component in ["latDeg", "lonDeg"]:
            delta = abs(float(expected[point_key][component]) - float(observed[point_key][component]))
            if delta > tolerances["latLonDeg"]:
                failures.append(f"{path.name}: {point_key}.{component} delta {delta} exceeds {tolerances['latLonDeg']}")
    return failures


def check_finite(name: str, value: Any, path: str = "expected") -> list[str]:
    failures = []
    if isinstance(value, dict):
        for key, child in value.items():
            failures.extend(check_finite(name, child, f"{path}.{key}"))
    elif isinstance(value, list):
        for i, child in enumerate(value):
            failures.extend(check_finite(name, child, f"{path}[{i}]"))
    elif isinstance(value, (int, float)) and not math.isfinite(value):
        failures.append(f"{name}: {path} is not finite")
    return failures


if __name__ == "__main__":
    raise SystemExit(main())
