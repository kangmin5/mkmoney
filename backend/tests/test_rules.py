import json
from decimal import Decimal
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Transaction
from app.services.rules import RuleSpec, first_match
from tests.conftest import make_row

VECTORS = json.loads((Path(__file__).parents[2] / "frontend/src/domain/rules.vectors.json").read_text(encoding="utf-8"))


def spec(rule: dict[str, object]) -> RuleSpec:
    dec = lambda v: Decimal(str(v)) if v is not None else None
    return RuleSpec(id=None, name=str(rule["name"]), description_contains=str(rule["description_contains"]),
                    source_type=rule["source_type"], direction=str(rule["direction"]),  # type: ignore[arg-type]
                    min_amount=dec(rule["min_amount"]), max_amount=dec(rule["max_amount"]),
                    flow=rule["flow"], user_category=rule["user_category"])  # type: ignore[arg-type]


@pytest.mark.parametrize("case", VECTORS["cases"], ids=lambda c: f"{c['description']}|{c['amount']}")
def test_shared_rule_vectors(case: dict[str, str]) -> None:
    rules = [spec(r) for r in VECTORS["rules"]]
    hit = first_match(rules, description=case["description"], source_type=case["source_type"], amount=Decimal(case["amount"]))
    assert (hit.name if hit else None) == case["expect"]


SALARY = {"name": "코어스톤 급여", "description_contains": "코어스톤", "direction": "in", "min_amount": "1000000", "flow": "income", "user_category": "급여"}
EXPENSE = {"name": "코어스톤 경비", "description_contains": "코어스톤", "direction": "in", "max_amount": "1000000", "flow": "reimbursement", "user_category": "회사 경비 정산"}


def post_import(client: TestClient, rows: list[dict[str, object]]) -> None:
    assert client.post("/api/imports", json={"file_name": "x.xlsx", "rows": rows}).status_code == 201


def test_rule_crud_order_and_validation(authed: TestClient) -> None:
    rules = authed.post("/api/rules", json=SALARY).json()
    rules = authed.post("/api/rules", json=EXPENSE).json()
    assert [r["name"] for r in rules] == ["코어스톤 급여", "코어스톤 경비"]
    assert authed.post("/api/rules", json=SALARY).status_code == 409
    assert authed.post("/api/rules", json={**SALARY, "name": "x", "min_amount": "5", "max_amount": "5"}).status_code == 422
    reordered = authed.put("/api/rules/order", json={"ids": [rules[1]["id"], rules[0]["id"]]}).json()
    assert [r["name"] for r in reordered] == ["코어스톤 경비", "코어스톤 급여"]
    updated = authed.put(f"/api/rules/{rules[0]['id']}", json={**SALARY, "enabled": False}).json()
    assert next(r for r in updated if r["name"] == "코어스톤 급여")["enabled"] is False
    assert len(authed.delete(f"/api/rules/{rules[0]['id']}").json()) == 1
    assert authed.delete(f"/api/rules/{rules[0]['id']}").status_code == 404


def test_apply_preview_then_apply_only_auto_rows(authed: TestClient, db: Session) -> None:
    salary = make_row(source_type="이체", flow="transfer", description="(주)코어스톤", amount="3000000", time="09:00:00")
    expense = make_row(source_type="이체", flow="transfer", description="(주)코어스톤", amount="45000", time="10:00:00")
    manual = make_row(source_type="이체", flow="income", description="(주)코어스톤", amount="2000", time="11:00:00")
    other = make_row(time="12:00:00")
    post_import(authed, [salary, expense, manual, other])
    authed.post("/api/rules", json=SALARY)
    authed.post("/api/rules", json=EXPENSE)
    preview = authed.post("/api/rules/apply/preview").json()
    assert preview["matched"] == 2
    assert {(c["from_flow"], c["to_flow"], c["count"]) for c in preview["flow_changes"]} == {("transfer", "income", 1), ("transfer", "reimbursement", 1)}
    assert db.scalar(select(Transaction.flow).where(Transaction.amount == Decimal(3000000))) == "transfer"  # 미리보기는 변경 없음
    assert authed.post("/api/rules/apply").json() == {"updated": 2}
    rows = {str(t.amount): (t.flow, t.flow_source, t.user_category, t.major_category) for t in db.scalars(select(Transaction))}
    assert rows["3000000.0000"] == ("income", "manual", "급여", "식비")
    assert rows["45000.0000"] == ("reimbursement", "manual", "회사 경비 정산", "식비")
    assert rows["2000.0000"] == ("income", "manual", None, "식비")  # 사용자가 이미 지정한 행은 그대로
    assert authed.post("/api/rules/apply/preview").json()["matched"] == 0  # 다시 적용해도 대상 없음


def test_import_with_user_category_is_manual_and_type_mapping_keeps_it(authed: TestClient, db: Session) -> None:
    row = make_row(source_type="이체", flow="income", description="(주)코어스톤", amount="3000000", user_category="급여")
    post_import(authed, [row])
    authed.put("/api/type-mappings", json={"source_type": "이체", "flow": "transfer"})
    stored = db.scalars(select(Transaction)).one()
    assert (stored.flow, stored.flow_source, stored.user_category) == ("income", "manual", "급여")


def test_patch_user_category_and_category_filter(authed: TestClient, db: Session) -> None:
    post_import(authed, [make_row(), make_row(time="13:00:00", major_category=None)])
    tx_id = str(db.scalars(select(Transaction.id).where(Transaction.major_category == "식비")).one())
    patched = authed.patch(f"/api/transactions/{tx_id}/flow", json={"flow": "expense", "user_category": "회식"}).json()
    assert (patched["user_category"], patched["flow_source"]) == ("회식", "manual")
    assert authed.get("/api/transactions", params={"category": "회식"}).json()["total"] == 1
    assert authed.get("/api/transactions", params={"category": ""}).json()["total"] == 1
    kept = authed.patch(f"/api/transactions/{tx_id}/flow", json={"flow": "expense"}).json()
    assert kept["user_category"] == "회식"  # 보내지 않으면 유지
    cleared = authed.patch(f"/api/transactions/{tx_id}/flow", json={"flow": None, "user_category": None}).json()
    assert (cleared["user_category"], cleared["flow_source"]) == (None, "auto")
