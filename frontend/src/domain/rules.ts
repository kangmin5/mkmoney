/**
 * 사용자 분류 규칙 일치 판정. 백엔드 `app/services/rules.py`의 matches/first_match와 같은 규칙이며
 * 공유 테스트 벡터(rules.vectors.json)로 양쪽 결과를 맞춘다. 금액 비교는 정수 단위(부동소수점 없음).
 */
import type { RuleInput } from "../api/client";
import { normalizeText } from "../import/fingerprint";
import { toUnits } from "./money";

/** 비교용 정규화: NFC + 앞뒤 공백 제거 + 소문자. */
const fold = (text: string | null | undefined): string => normalizeText(text ?? "").toLowerCase();

/** 규칙 판정에 필요한 거래 값. */
export interface RuleTarget {
  description: string;
  sourceType: string;
  /** 부호 있는 십진 문자열 */
  amount: string;
}

/**
 * 규칙 조건이 모두 맞는지.
 * 내용 포함(대소문자 무시), 원본 타입(지정 시), 방향(in=양수·out=음수·any), 금액 절댓값 min 이상·max 미만.
 */
export function matchRule(rule: Pick<RuleInput, "description_contains" | "source_type" | "direction" | "min_amount" | "max_amount">, target: RuleTarget): boolean {
  if (!fold(target.description).includes(fold(rule.description_contains))) return false;
  if (rule.source_type !== null && normalizeText(rule.source_type) !== normalizeText(target.sourceType)) return false;
  const units = toUnits(target.amount);
  if (rule.direction === "in" && !(units > 0n)) return false;
  if (rule.direction === "out" && !(units < 0n)) return false;
  const magnitude = units < 0n ? -units : units;
  if (rule.min_amount !== null && magnitude < toUnits(rule.min_amount)) return false;
  if (rule.max_amount !== null && magnitude >= toUnits(rule.max_amount)) return false;
  return true;
}

/** 순서상 처음 일치하는 사용 중(enabled) 규칙. */
export function firstMatchingRule<R extends RuleInput>(rules: readonly R[], target: RuleTarget): R | null {
  for (const rule of rules) {
    if (rule.enabled && matchRule(rule, target)) return rule;
  }
  return null;
}
