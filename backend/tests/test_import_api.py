import logging

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import ImportBatch, Transaction
from tests.conftest import make_row


def post_import(client: TestClient, rows: list[dict[str, object]], **summary: int) -> dict[str, object]:
    response = client.post("/api/imports", json={"file_name": "expense-2026-11-06.xlsx", "rows": rows, "summary": summary})
    assert response.status_code == 201, response.text
    return response.json()


def count(db: Session) -> int:
    return db.scalar(select(func.count()).select_from(Transaction)) or 0


def test_check_returns_only_existing_fingerprints_and_rejects_row_payloads(authed: TestClient) -> None:
    first, second = make_row(), make_row(description="다른 합성 가게")
    post_import(authed, [first])
    response = authed.post("/api/imports/check", json={"fingerprints": [first["fingerprint"], second["fingerprint"]]})
    assert response.json() == {"existing": [first["fingerprint"]]}
    assert authed.post("/api/imports/check", json={"fingerprints": [], "rows": [first]}).status_code == 422
    assert authed.post("/api/imports/check", json={"fingerprints": ["not-a-hash"]}).status_code == 422


def test_reimport_and_retry_add_nothing_and_never_update(authed: TestClient, db: Session) -> None:
    row = make_row()
    assert post_import(authed, [row])["inserted"] == 1
    changed_category = {**row, "major_category": "다른 분류", "memo": "다른 메모"}
    result = post_import(authed, [changed_category, make_row(time="13:00:00")])
    assert (result["inserted"], result["duplicate"]) == (1, 1)
    assert count(db) == 2
    stored = db.scalars(select(Transaction).where(Transaction.fingerprint == row["fingerprint"])).one()
    assert stored.major_category == "식비" and stored.memo is None


def test_same_day_rows_with_different_time_are_distinct(authed: TestClient, db: Session) -> None:
    post_import(authed, [make_row(time="09:00:00"), make_row(time="10:00:00"), make_row(time=None)])
    assert count(db) == 3


def test_mismatched_fingerprint_rejects_whole_batch(authed: TestClient, db: Session) -> None:
    bad = {**make_row(), "amount": "-13000"}
    response = authed.post("/api/imports", json={"file_name": "x.xlsx", "rows": [make_row(time="08:00:00"), bad]})
    assert response.status_code == 422
    assert "13000" not in response.text
    assert count(db) == 0 and db.scalar(select(func.count()).select_from(ImportBatch)) == 0


def test_validation_errors_do_not_echo_values(authed: TestClient) -> None:
    response = authed.post("/api/imports", json={"file_name": "x.xlsx", "rows": [{**make_row(), "currency": "합성통화"}]})
    assert response.status_code == 422
    assert "합성통화" not in response.text


def test_batch_summary_and_flow_source(authed: TestClient, db: Session) -> None:
    refund = make_row(amount="5000", flow="refund", time="14:00:00")  # 양수 지출을 사용자가 환불로 지정
    post_import(authed, [make_row(), refund], in_file_duplicate=2, review=1, error=3)
    recent = authed.get("/api/imports/recent").json()[0]
    assert (recent["inserted_count"], recent["in_file_duplicate_count"], recent["review_count"], recent["error_count"]) == (2, 2, 1, 3)
    sources = dict(db.execute(select(Transaction.flow, Transaction.flow_source)).all())
    assert sources == {"expense": "auto", "refund": "manual"}


def test_logs_contain_no_transaction_values(authed: TestClient, caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.DEBUG)
    row = make_row(description="로그금지합성값")
    authed.post("/api/imports/check", json={"fingerprints": [row["fingerprint"]]})
    post_import(authed, [row])
    assert "로그금지합성값" not in caplog.text and row["fingerprint"] not in caplog.text


def test_type_mapping_recomputes_only_auto_rows(authed: TestClient, db: Session) -> None:
    unknown = make_row(source_type="합성타입", flow="needs_review", amount="300")
    manual = make_row(source_type="합성타입", flow="income", amount="400")
    post_import(authed, [unknown, manual])
    authed.put("/api/type-mappings", json={"source_type": "합성타입", "flow": "refund"})
    flows = {str(t.amount): (t.flow, t.flow_source) for t in db.scalars(select(Transaction))}
    assert flows == {"300.0000": ("refund", "auto"), "400.0000": ("income", "manual")}
    listed = {m["source_type"]: m for m in authed.get("/api/type-mappings").json()}
    assert listed["합성타입"]["flow"] == "refund" and listed["지출"]["default_flow"] == "expense"


def test_payment_mapping_persists_and_lists_unmapped(authed: TestClient) -> None:
    post_import(authed, [make_row(), make_row(payment_method="합성체크", time="15:00:00")])
    authed.put("/api/payment-method-mappings", json={"source_label": "합성카드", "card_kind": "credit"})
    listed = {m["source_label"]: m["card_kind"] for m in authed.get("/api/payment-method-mappings").json()}
    assert listed == {"합성카드": "credit", "합성체크": None}


def test_patch_flow_marks_manual_and_can_reset(authed: TestClient, db: Session) -> None:
    post_import(authed, [make_row(amount="5000", flow="needs_review")])
    tx_id = str(db.scalars(select(Transaction.id)).one())
    assert authed.patch(f"/api/transactions/{tx_id}/flow", json={"flow": "refund"}).json()["flow_source"] == "manual"
    reset = authed.patch(f"/api/transactions/{tx_id}/flow", json={"flow": None}).json()
    assert (reset["flow"], reset["flow_source"]) == ("needs_review", "auto")


def test_transactions_are_paginated_and_filtered(authed: TestClient) -> None:
    post_import(authed, [make_row(time=f"0{i}:00:00") for i in range(5)] + [make_row(date="2026-10-31")])
    page = authed.get("/api/transactions", params={"start": "2026-11-01", "end": "2026-11-30", "limit": 2}).json()
    assert page["total"] == 5 and len(page["items"]) == 2 and page["items"][0]["time"] == "04:00:00"
    assert authed.get("/api/transactions", params={"start": "2026-11-02", "end": "2026-11-01"}).status_code == 422


def test_empty_major_category_filter_matches_missing_categories(authed: TestClient) -> None:
    post_import(authed, [make_row(major_category=None), make_row(major_category="", time="01:00:00"), make_row(time="02:00:00")])
    page = authed.get("/api/transactions", params={"major_category": ""}).json()
    assert page["total"] == 2
