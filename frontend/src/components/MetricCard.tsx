/**
 * KPI 카드: 라벨, 금액, 보조 설명(비교 변화 등).
 */
import type { ReactNode } from "react";

interface MetricCardProps {
  label: string;
  value: string;
  /** 비교·계산 기준 설명 */
  note?: ReactNode;
  /** 넓게 표시(모바일 2열 그리드에서 한 줄 전체) */
  wide?: boolean;
}

/** 지표 하나를 표시한다. */
export function MetricCard({ label, value, note, wide }: MetricCardProps) {
  return (
    <div className={wide ? "metric metric--wide" : "metric"}>
      <dt>{label}</dt>
      <dd>
        <strong className="metric__value">{value}</strong>
        {note && <span className="metric__note">{note}</span>}
      </dd>
    </div>
  );
}
