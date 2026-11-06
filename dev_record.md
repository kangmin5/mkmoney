# 개발 기록

커밋마다 버전과 변경 요약을 기록한다.

## v0.1.0 — MVP 골격과 가져오기·인증·집계 API

- Task 1·2: FastAPI/Vite 셸, PostgreSQL 모델·마이그레이션(0001).
- Task 0: Makefile 표준 타깃, 개발·테스트 DB compose 분리, mypy 추가.
- Task 3: 브라우저 엑셀 파싱, 지문(SHA-256) 생성, 미리보기 분류.
- Task 4: 단일 사용자 세션 인증, 지문 중복 확인·승인 가져오기 API, 매핑 API, 마이그레이션 0002.
- Task 5: 기간·월별·분류·카드 집계 API.
- xlsx를 SheetJS 공식 배포 0.20.3으로 교체(npm 0.18.5의 알려진 취약점 회피).
- 상단바에 앱 버전 표시(package.json → 빌드 주입), `/api/health`에 서버 버전 포함, 버전 3곳 동기화 테스트.
- Makefile: `version`, `release`(배포 없는 커밋·푸시) 추가, `bump`가 package-lock·uv.lock도 갱신.
