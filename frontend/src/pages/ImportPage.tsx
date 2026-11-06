/**
 * 가져오기 화면(Task 7에서 검토·승인 흐름을 구현한다). 현재는 안내만 표시한다.
 */

/** 가져오기 자리표시 화면. */
export function ImportPage() {
  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">IMPORT</p>
          <h1>거래 가져오기</h1>
        </div>
      </div>
      <div className="status status--empty">엑셀 검토·승인 화면은 다음 단계에서 제공됩니다.</div>
    </>
  );
}
