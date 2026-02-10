"""Tests for cost collector."""

from __future__ import annotations

from datetime import datetime, timezone

from dapanoskop.collector import _get_periods, _month_range


def test_month_range_regular() -> None:
    start, end = _month_range(2026, 3)
    assert start == "2026-03-01"
    assert end == "2026-04-01"


def test_month_range_december() -> None:
    start, end = _month_range(2025, 12)
    assert start == "2025-12-01"
    assert end == "2026-01-01"


def test_get_periods_mid_month() -> None:
    """On Feb 10, current period should be January."""
    now = datetime(2026, 2, 10, 12, 0, 0, tzinfo=timezone.utc)
    periods = _get_periods(now)

    assert periods["current"][0] == "2026-01-01"
    assert periods["prev_month"][0] == "2025-12-01"
    assert periods["yoy"][0] == "2025-01-01"


def test_get_periods_first_of_month() -> None:
    """On Mar 1, current period should be January (two months ago)."""
    now = datetime(2026, 3, 1, 6, 0, 0, tzinfo=timezone.utc)
    periods = _get_periods(now)

    assert periods["current"][0] == "2026-01-01"
    assert periods["prev_month"][0] == "2025-12-01"
    assert periods["yoy"][0] == "2025-01-01"


def test_get_periods_january() -> None:
    """On Jan 15, current period should be December of previous year."""
    now = datetime(2026, 1, 15, 6, 0, 0, tzinfo=timezone.utc)
    periods = _get_periods(now)

    assert periods["current"][0] == "2025-12-01"
    assert periods["prev_month"][0] == "2025-11-01"
    assert periods["yoy"][0] == "2024-12-01"
