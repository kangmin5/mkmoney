/**
 * 앱 전역 상태: 조회 기간, 데이터 변경 신호(dataVersion), 화면 이동과 거래 필터.
 * 데이터를 바꾸는 작업 후에는 `notifyDataChanged()`를 호출해 모든 화면이 다시 불러오게 한다.
 */
import { createContext, useContext } from "react";

import type { TransactionFilters } from "../api/client";
import type { Period } from "../domain/periods";

/** 화면 경로(해시). */
export type Route = "dashboard" | "transactions" | "categories" | "cards" | "import" | "settings";

/** 메뉴 정의(표시 순서). */
export const ROUTES: readonly { route: Route; label: string; short: string }[] = [
  { route: "dashboard", label: "자금 현황", short: "현황" },
  { route: "transactions", label: "거래내역", short: "거래" },
  { route: "categories", label: "분류", short: "분류" },
  { route: "cards", label: "카드 사용", short: "카드" },
  { route: "import", label: "가져오기", short: "가져오기" },
  { route: "settings", label: "설정", short: "설정" },
];

/** 거래내역 화면 추가 필터(기간 외). */
export type ExtraFilters = Omit<TransactionFilters, "start" | "end">;

export interface AppContextValue {
  period: Period;
  setPeriod: (period: Period) => void;
  /** 데이터가 바뀔 때마다 증가. 데이터 로더의 의존값으로 쓴다. */
  dataVersion: number;
  notifyDataChanged: () => void;
  /** 화면 이동(거래내역은 필터를 함께 지정 가능). */
  navigate: (route: Route, filters?: ExtraFilters) => void;
  transactionFilters: ExtraFilters;
  setTransactionFilters: (filters: ExtraFilters) => void;
}

export const AppContext = createContext<AppContextValue | null>(null);

/** 앱 컨텍스트 사용(Provider 밖이면 오류). */
export function useApp(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) throw new Error("AppContext provider is missing");
  return value;
}

/** 해시에서 경로를 읽는다(알 수 없으면 dashboard). */
export function routeFromHash(hash: string): Route {
  const name = hash.replace(/^#/, "");
  return ROUTES.some((r) => r.route === name) ? (name as Route) : "dashboard";
}
