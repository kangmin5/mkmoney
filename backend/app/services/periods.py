"""기간 경계 규칙(양 끝 날짜 포함, 로컬 달력 날짜 기준)."""

import calendar
from datetime import date, timedelta
from typing import Literal

ComparisonMode = Literal["previous_month", "same_range", "previous_period"]
MAX_RANGE_DAYS = 3660


def month_bounds(day: date) -> tuple[date, date]:
    """해당 월의 1일과 말일."""
    return day.replace(day=1), day.replace(day=calendar.monthrange(day.year, day.month)[1])


def shift_month(day: date, months: int) -> date:
    """월을 이동한다. 대상 월에 같은 날이 없으면 말일로 맞춘다(3/31 → 2/28·29)."""
    index = day.year * 12 + day.month - 1 + months
    year, month = divmod(index, 12)
    last = calendar.monthrange(year, month + 1)[1]
    return date(year, month + 1, min(day.day, last))


def comparison_range(start: date, end: date, mode: ComparisonMode) -> tuple[date, date]:
    """
    비교 기간.
    - previous_month: 시작일이 속한 달의 바로 전 달 전체.
    - same_range: 시작·종료일을 각각 한 달 앞으로(전월 같은 날짜 구간). 종료일이 그 달 말일이면
      비교 종료일도 전월 말일로 맞춘다(예: 3/1~3/31 → 2/1~2/28).
    - previous_period: 같은 일수의 바로 앞 기간.
    """
    if mode == "previous_month":
        return month_bounds(shift_month(start.replace(day=1), -1))
    if mode == "same_range":
        prev_end = shift_month(end, -1)
        if end == month_bounds(end)[1]:
            prev_end = month_bounds(prev_end)[1]
        return shift_month(start, -1), prev_end
    days = (end - start).days + 1
    return start - timedelta(days=days), start - timedelta(days=1)


def validate_range(start: date, end: date) -> None:
    """시작 ≤ 종료, 최대 길이 제한."""
    if start > end:
        raise ValueError("시작일이 종료일보다 늦습니다.")
    if (end - start).days + 1 > MAX_RANGE_DAYS:
        raise ValueError("조회 기간이 너무 깁니다.")
