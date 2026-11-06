from datetime import date

import pytest

from app.services.periods import comparison_range, shift_month, validate_range


@pytest.mark.parametrize(("start", "end", "mode", "expected"), [
    # 전체 전월: 연 경계
    (date(2026, 1, 1), date(2026, 1, 31), "previous_month", (date(2025, 12, 1), date(2025, 12, 31))),
    # 전월 같은 날짜 구간: 3/1~3/31 → 2/1~2/29 (윤년)
    (date(2028, 3, 1), date(2028, 3, 31), "same_range", (date(2028, 2, 1), date(2028, 2, 29))),
    # 월 중간까지 비교: 11/1~11/7 → 10/1~10/7
    (date(2026, 11, 1), date(2026, 11, 7), "same_range", (date(2026, 10, 1), date(2026, 10, 7))),
    # 3/30 같은 날이 없는 2월 → 말일로
    (date(2027, 3, 30), date(2027, 3, 30), "same_range", (date(2027, 2, 28), date(2027, 2, 28))),
    # 직전 동일 일수(양 끝 포함 10일)
    (date(2026, 3, 1), date(2026, 3, 10), "previous_period", (date(2026, 2, 19), date(2026, 2, 28))),
])
def test_comparison_ranges(start: date, end: date, mode: str, expected: tuple[date, date]) -> None:
    assert comparison_range(start, end, mode) == expected  # type: ignore[arg-type]


def test_shift_month_clamps_and_crosses_years() -> None:
    assert shift_month(date(2026, 1, 31), -2) == date(2025, 11, 30)
    assert shift_month(date(2024, 2, 29), 12) == date(2025, 2, 28)


def test_validate_range_rejects_inverted_and_huge_ranges() -> None:
    with pytest.raises(ValueError):
        validate_range(date(2026, 2, 1), date(2026, 1, 1))
    with pytest.raises(ValueError):
        validate_range(date(2000, 1, 1), date(2026, 1, 1))
    validate_range(date(2026, 1, 1), date(2026, 1, 1))
