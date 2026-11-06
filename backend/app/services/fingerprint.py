"""중복 판정 지문. 프론트 `src/import/fingerprint.ts`와 바이트 단위로 같아야 한다."""

import hashlib
import json
import re
import unicodedata
from datetime import date
from datetime import time as datetime_time
from decimal import Decimal, InvalidOperation

# JS `\s` + BOM과 같은 공백 코드 포인트(프론트 EDGE_SPACE_CODEPOINTS와 동일).
EDGE_SPACE_CODEPOINTS: tuple[int, ...] = (
    0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x20, 0xA0, 0x1680,
    0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200A,
    0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF,
)
_EDGE_SPACE = "".join(chr(c) for c in EDGE_SPACE_CODEPOINTS)
_AMOUNT_RE = re.compile(r"^[+-]?\d+(\.\d*)?$")


def normalize_text(value: str | None) -> str:
    """NFC 정규화 후 앞뒤 공백을 제거한다."""
    return unicodedata.normalize("NFC", value or "").strip(_EDGE_SPACE)


def canonical_amount(value: Decimal | str) -> str:
    """부호를 보존한 정규 십진 문자열(후행 0 제거, -0은 0). 부동소수점을 쓰지 않는다."""
    text = str(value).strip().replace(",", "")
    if not _AMOUNT_RE.match(text):
        raise ValueError("invalid amount")
    try:
        number = Decimal(text)
    except InvalidOperation as exc:  # pragma: no cover - 정규식에서 걸러짐
        raise ValueError("invalid amount") from exc
    if number == 0:
        return "0"
    result = format(number.normalize(), "f")
    if "." in result:
        result = result.rstrip("0").rstrip(".")
    return result


def fingerprint_payload(
    *,
    tx_date: date,
    tx_time: datetime_time | None,
    source_type: str,
    amount: Decimal | str,
    currency: str,
    payment_method: str,
    description: str,
) -> str:
    """지문 입력 JSON(로그로 남기지 않는다)."""
    fields = [
        tx_date.isoformat(),
        tx_time.strftime("%H:%M:%S") if tx_time is not None else "",
        normalize_text(source_type),
        canonical_amount(amount),
        normalize_text(currency).upper(),
        normalize_text(payment_method),
        normalize_text(description),
    ]
    return json.dumps(fields, ensure_ascii=False, separators=(",", ":"))


def compute_fingerprint(**fields: object) -> str:
    """SHA-256 hex 지문. 인자는 `fingerprint_payload`와 같다."""
    payload = fingerprint_payload(**fields)  # type: ignore[arg-type]
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()
