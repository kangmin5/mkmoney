"""경비 정산 흐름, 결제수단 종류 확장, 사용자 분류 이름, 분류 규칙 테이블."""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0003_rules_reimburse_kinds"
down_revision = "0002_flow_source_counts"
branch_labels = None
depends_on = None

OLD_FLOWS = "flow IN ('income', 'expense', 'transfer', 'refund', 'needs_review')"
NEW_FLOWS = (
    "flow IN ('income', 'expense', 'transfer', 'refund', 'reimbursement', 'needs_review')"
)
OLD_KINDS = "card_kind IN ('credit', 'debit', 'other')"
NEW_KINDS = "card_kind IN ('credit', 'debit', 'account', 'prepaid', 'point', 'other')"


def upgrade() -> None:
    """제약을 넓히고 열·테이블을 추가한다(기존 데이터는 그대로)."""
    for table, name in (
        ("transactions", "ck_transactions_flow"),
        ("transaction_type_mappings", "ck_type_mapping_flow"),
    ):
        op.drop_constraint(name, table, type_="check")
        op.create_check_constraint(name, table, NEW_FLOWS)
    op.drop_constraint("ck_payment_card_kind", "payment_method_mappings", type_="check")
    op.create_check_constraint("ck_payment_card_kind", "payment_method_mappings", NEW_KINDS)
    op.add_column("transactions", sa.Column("user_category", sa.String(120), nullable=True))
    op.create_table(
        "classification_rules",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(80), nullable=False, unique=True),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("description_contains", sa.String(200), nullable=False),
        sa.Column("source_type", sa.String(120)),
        sa.Column("direction", sa.String(3), nullable=False),
        sa.Column("min_amount", sa.Numeric(20, 4)),
        sa.Column("max_amount", sa.Numeric(20, 4)),
        sa.Column("flow", sa.String(20), nullable=False),
        sa.Column("user_category", sa.String(120)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(NEW_FLOWS, name="ck_rule_flow"),
        sa.CheckConstraint("direction IN ('in', 'out', 'any')", name="ck_rule_direction"),
        sa.CheckConstraint(
            "min_amount IS NULL OR min_amount >= 0", name="ck_rule_min_amount_nonnegative"
        ),
        sa.CheckConstraint("max_amount IS NULL OR max_amount > 0", name="ck_rule_max_amount_positive"),
    )


def downgrade() -> None:
    """새 값을 쓰는 데이터가 있으면 손실을 막기 위해 중단한다."""
    conn = op.get_bind()
    in_use = conn.execute(
        sa.text(
            "SELECT (SELECT count(*) FROM transactions WHERE flow = 'reimbursement')"
            " + (SELECT count(*) FROM transaction_type_mappings WHERE flow = 'reimbursement')"
            " + (SELECT count(*) FROM payment_method_mappings"
            "    WHERE card_kind IN ('account', 'prepaid', 'point'))"
            " + (SELECT count(*) FROM transactions WHERE user_category IS NOT NULL)"
            " + (SELECT count(*) FROM classification_rules)"
        )
    ).scalar_one()
    if in_use:
        raise RuntimeError(
            "0003 이후 데이터(경비 정산·새 결제수단 종류·사용자 분류·규칙)가 있어 되돌릴 수 없습니다."
        )
    op.drop_table("classification_rules")
    op.drop_column("transactions", "user_category")
    op.drop_constraint("ck_payment_card_kind", "payment_method_mappings", type_="check")
    op.create_check_constraint("ck_payment_card_kind", "payment_method_mappings", OLD_KINDS)
    for table, name in (
        ("transactions", "ck_transactions_flow"),
        ("transaction_type_mappings", "ck_type_mapping_flow"),
    ):
        op.drop_constraint(name, table, type_="check")
        op.create_check_constraint(name, table, OLD_FLOWS)
