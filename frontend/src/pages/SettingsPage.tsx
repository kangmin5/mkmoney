/**
 * 설정 화면(Task 7·8에서 타입 매핑·결제수단 매핑·백업을 구현한다). 현재는 안내만 표시한다.
 */
import { APP_VERSION } from "../version";

/** 설정 자리표시 화면. */
export function SettingsPage() {
  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">SETTINGS</p>
          <h1>설정</h1>
        </div>
      </div>
      <div className="status status--empty">타입·결제수단 매핑과 암호화 백업은 다음 단계에서 제공됩니다. 카드 종류는 지금도 카드 사용 화면에서 지정할 수 있습니다.</div>
      <p className="basis">앱 버전 {APP_VERSION}</p>
    </>
  );
}
