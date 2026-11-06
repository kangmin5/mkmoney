from datetime import date, time
from decimal import Decimal

import pytest

from app.services.fingerprint import canonical_amount, compute_fingerprint, normalize_text
from app.services.flow import derive_flow

# frontend/src/import/fingerprint.test.ts 와 같은 공유 벡터. 바꾸면 양쪽을 함께 바꾼다.
SHARED_VECTOR_HASH = "749ffbe561d75053e5920b3d8eca5d05c0b8932fd611d4da5077cad0e67499f8"


def test_shared_vector_matches_browser_fingerprint() -> None:
    assert compute_fingerprint(
        tx_date=date(2026, 1, 31), tx_time=None, source_type="지출", amount=Decimal("-1500.50"),
        currency="KRW", payment_method="합성카드", description='테스트 "따옴표" \\ 가게',
    ) == SHARED_VECTOR_HASH


def test_fingerprint_ignores_surrounding_space_and_currency_case() -> None:
    base = {"tx_date": date(2026, 11, 6), "tx_time": time(12), "source_type": "지출", "amount": "-12000.00",
                "currency": "KRW", "payment_method": "카드", "description": "점심"}
    spaced = {**base, "source_type": " 지출 ", "currency": "krw", "description": chr(0x3000) + "점심"}
    assert compute_fingerprint(**base) == compute_fingerprint(**spaced)
    assert compute_fingerprint(**base) != compute_fingerprint(**{**base, "tx_time": None})


@pytest.mark.parametrize(("raw", "expected"), [
    ("+0012000.000", "12000"), ("-0.0", "0"), ("1,234.5600", "1234.56"), ("0.1", "0.1"), ("-5", "-5"),
])
def test_canonical_amount(raw: str, expected: str) -> None:
    assert canonical_amount(raw) == expected


def test_canonical_amount_rejects_non_decimal() -> None:
    with pytest.raises(ValueError):
        canonical_amount("1e3")


def test_normalize_text_applies_nfc() -> None:
    assert normalize_text(chr(0x1100) + chr(0x1161)) == "가"


def test_derive_flow_never_guesses_refunds() -> None:
    assert derive_flow("지출", Decimal(-1), {}) == "expense"
    assert derive_flow("지출", Decimal(1), {}) == "needs_review"
    assert derive_flow("수입", Decimal(-1), {}) == "needs_review"
    assert derive_flow("이체", Decimal(1), {}) == "transfer"
    assert derive_flow("모름", Decimal(1), {}) == "needs_review"
    assert derive_flow("모름", Decimal(1), {"모름": "refund"}) == "refund"
