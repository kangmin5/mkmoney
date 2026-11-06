"""원본 타입·결제수단 매핑 조회와 저장."""

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db import get_session
from app.schemas import (
    PaymentMethodMappingRead,
    PaymentMethodMappingUpdate,
    TypeMappingRead,
    TypeMappingUpdate,
)
from app.security import require_session
from app.services import mappings as service

router = APIRouter(prefix="/api", tags=["mappings"], dependencies=[Depends(require_session)])
SessionDep = Annotated[Session, Depends(get_session)]


@router.get("/type-mappings", response_model=list[TypeMappingRead])
def get_type_mappings(session: SessionDep) -> list[TypeMappingRead]:
    """원본 타입 목록과 저장·기본 매핑."""
    return service.list_type_mappings(session)


@router.put("/type-mappings", response_model=list[TypeMappingRead])
def put_type_mapping(body: TypeMappingUpdate, session: SessionDep) -> list[TypeMappingRead]:
    """타입 매핑을 저장하고(자동 분류 행 재계산) 갱신된 목록을 돌려준다."""
    service.save_type_mapping(session, body)
    return service.list_type_mappings(session)


@router.get("/payment-method-mappings", response_model=list[PaymentMethodMappingRead])
def get_payment_mappings(session: SessionDep) -> list[PaymentMethodMappingRead]:
    """결제수단 라벨 목록과 저장된 카드 종류."""
    return service.list_payment_mappings(session)


@router.put("/payment-method-mappings", response_model=list[PaymentMethodMappingRead])
def put_payment_mapping(
    body: PaymentMethodMappingUpdate, session: SessionDep
) -> list[PaymentMethodMappingRead]:
    """결제수단 매핑을 저장하고 갱신된 목록을 돌려준다."""
    service.save_payment_mapping(session, body)
    return service.list_payment_mappings(session)
