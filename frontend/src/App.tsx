import { APP_VERSION } from "./version";

/** 앱 셸: 상단 메뉴와 현재 화면. */
export default function App() {
  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#dashboard" aria-label="m:money 자금 현황">
          m<span>:</span>money
        </a>
        <nav aria-label="주요 메뉴">
          <a href="#dashboard" aria-current="page">자금 현황</a>
          <a href="#transactions">거래내역</a>
          <a href="#categories">분류</a>
          <a href="#cards">카드 사용</a>
          <a href="#import">가져오기</a>
          <a href="#settings">설정</a>
        </nav>
        <span className="account-label">내 가계부</span>
        <span className="app-version" aria-label={`앱 버전 ${APP_VERSION}`}>{APP_VERSION}</span>
      </header>
      <main id="dashboard" className="page-content">
        <p className="eyebrow">PERSONAL FINANCE · CASHFLOW</p>
        <h1>이번 달 자금 흐름</h1>
        <p className="empty-state">엑셀을 가져와 이번 달의 흐름을 확인해 보세요.</p>
      </main>
    </div>
  );
}
