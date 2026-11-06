/**
 * 앱 셸: 세션 확인(인증 게이트) → 상단/하단 메뉴 + 해시 라우팅 화면.
 */
import { useCallback, useEffect, useMemo, useState } from "react";

import { api, onUnauthorized } from "./api/client";
import { AppContext, type AppContextValue, type ExtraFilters, type Route, ROUTES, routeFromHash } from "./app/AppContext";
import { defaultPeriod, type Period } from "./domain/periods";
import { CardsPage } from "./pages/CardsPage";
import { CategoriesPage } from "./pages/CategoriesPage";
import { DashboardPage } from "./pages/DashboardPage";
import { ImportPage } from "./pages/ImportPage";
import { LoginPage } from "./pages/LoginPage";
import { SettingsPage } from "./pages/SettingsPage";
import { TransactionsPage } from "./pages/TransactionsPage";
import { APP_VERSION } from "./version";

type AuthState = "checking" | "anonymous" | "authenticated" | "error";

/** 최상위 컴포넌트. */
export default function App() {
  const [auth, setAuth] = useState<AuthState>("checking");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setAuth("checking");
    api.me(controller.signal).then(
      (me) => setAuth(me.authenticated ? "authenticated" : "anonymous"),
      (error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) setAuth("error");
      },
    );
    return () => controller.abort();
  }, [attempt]);

  // 어떤 API든 401이면 로그인 화면으로.
  useEffect(() => onUnauthorized(() => setAuth("anonymous")), []);

  if (auth === "checking") {
    return (
      <div className="status status--loading status--page" role="status">
        <span className="spinner" aria-hidden="true" />
        접속 상태를 확인하는 중…
      </div>
    );
  }
  if (auth === "error") {
    return (
      <div className="status status--error status--page" role="alert">
        <span>서버에 연결할 수 없습니다.</span>
        <button type="button" className="btn" onClick={() => setAttempt((n) => n + 1)}>
          다시 시도
        </button>
      </div>
    );
  }
  if (auth === "anonymous") return <LoginPage onSuccess={() => setAuth("authenticated")} />;
  return <AuthenticatedApp onLogout={() => setAuth("anonymous")} />;
}

/** 로그인 후 화면. */
function AuthenticatedApp({ onLogout }: { onLogout: () => void }) {
  const [route, setRoute] = useState<Route>(() => routeFromHash(window.location.hash));
  const [period, setPeriod] = useState<Period>(() => defaultPeriod());
  const [dataVersion, setDataVersion] = useState(0);
  const [transactionFilters, setTransactionFilters] = useState<ExtraFilters>({});

  useEffect(() => {
    const sync = () => setRoute(routeFromHash(window.location.hash));
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  // 화면 전환 시 맨 위로(모바일에서 이전 스크롤 위치가 남지 않게).
  useEffect(() => window.scrollTo?.(0, 0), [route]);

  const navigate = useCallback((next: Route, filters?: ExtraFilters) => {
    if (filters) setTransactionFilters(filters);
    window.location.hash = next;
    setRoute(next);
  }, []);

  const context = useMemo<AppContextValue>(
    () => ({
      period,
      setPeriod,
      dataVersion,
      notifyDataChanged: () => setDataVersion((n) => n + 1),
      navigate,
      transactionFilters,
      setTransactionFilters,
    }),
    [period, dataVersion, navigate, transactionFilters],
  );

  const logout = async () => {
    try {
      await api.logout();
    } finally {
      onLogout();
    }
  };

  return (
    <AppContext.Provider value={context}>
      <div className="app-shell">
        <a className="skip-link" href="#main">
          본문으로 건너뛰기
        </a>
        <header className="topbar">
          <a className="brand" href="#dashboard" aria-label="m:money 자금 현황">
            m<span>:</span>money
          </a>
          <nav aria-label="주요 메뉴" className="topnav">
            {ROUTES.map((item) => (
              <a key={item.route} href={`#${item.route}`} aria-current={route === item.route ? "page" : undefined}>
                {item.label}
              </a>
            ))}
          </nav>
          <span className="app-version" aria-label={`앱 버전 ${APP_VERSION}`}>
            {APP_VERSION}
          </span>
          <button type="button" className="btn btn--ghost" onClick={logout}>
            로그아웃
          </button>
        </header>
        <main id="main" className="page-content" tabIndex={-1}>
          {route === "dashboard" && <DashboardPage />}
          {route === "transactions" && <TransactionsPage />}
          {route === "categories" && <CategoriesPage />}
          {route === "cards" && <CardsPage />}
          {route === "import" && <ImportPage />}
          {route === "settings" && <SettingsPage />}
        </main>
        <nav aria-label="하단 메뉴" className="bottomnav">
          {ROUTES.map((item) => (
            <a key={item.route} href={`#${item.route}`} aria-current={route === item.route ? "page" : undefined}>
              {item.short}
            </a>
          ))}
        </nav>
      </div>
    </AppContext.Provider>
  );
}
