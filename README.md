# mkmoney

뱅크샐러드 엑셀(`expense-20xx-xx-xx.xlsx`)을 검토·승인 후 누적해 월별·기간별 수익·지출·카드 사용액을 보는 **단일 사용자 개인 웹앱**입니다.

- 접속 주소: **https://money.kangmin.kr** (집 안 네트워크 전용)
- 버전: 화면 상단과 `/api/health`에 표시 (`make version`)

## 데이터는 어디에 저장되나요

| 데이터 | 위치 | 비고 |
|---|---|---|
| 엑셀 원본 파일 | **사용자 기기에만** | 브라우저에서 읽고 서버로 보내지 않습니다 |
| 승인한 거래·매핑·가져오기 기록 | 집 안 서버 PostgreSQL (`pgdata-prod/`) | "기기 안에만 저장"이 아닙니다 |
| 서버 DB 백업 | 집 안 서버 `backups/` (권한 600) | **암호화되지 않은** pg_dump. 서버 밖으로 옮기지 마세요 |
| 암호화 백업 파일 | 사용자가 내려받은 곳 | 앱의 설정 → 암호화 백업. 암호를 잊으면 복원 불가 |
| HTTPS 로컬 CA 키 | 집 안 서버 `caddy-data-prod/` | 유출되면 이 CA를 신뢰한 기기가 위험. 백업·복사 금지 |

금융 데이터는 외부 서비스(분석·광고·AI·CDN)로 보내지 않습니다. 브라우저의 CSP가 같은 출처 외 요청을 막습니다.

## 구성

```
브라우저(PC·휴대폰) ──HTTPS──▶ Caddy(192.168.0.2:443, 로컬 CA) ──▶ FastAPI(app:8000) ──▶ PostgreSQL(db, 내부 네트워크)
```

- `compose.yaml`(운영, 프로젝트 이름 `mkmoney-prod`): DB·앱은 호스트 포트를 열지 않고, 프록시만 `LAN_BIND_IP:443`에 바인드합니다.
- `compose.dev.yaml`(개발 DB, 127.0.0.1:55433), `compose.test.yaml`(테스트 전용 일회용 DB, 127.0.0.1:55432)과 데이터·이름이 분리되어 있습니다.
- 공유기 포트포워딩·공개 터널은 **사용하지 않습니다**. 집 밖에서는 접속되지 않는 것이 정상입니다.

## 개발

필요: Python 3.13(uv), Node.js, Docker. `make help`로 전체 명령을 볼 수 있습니다.

```bash
make dev-db          # 개발 DB 기동 + 마이그레이션
make back            # 백엔드(localhost HTTP 개발 모드). 로그인하려면 아래 환경 변수 필요
make front           # Vite 개발 서버(http://localhost:5173, /api는 백엔드로 프록시)
make test            # pytest·ruff·mypy + 타입체크·vitest·빌드 (테스트 DB 자동 기동)
```

개발 로그인용 값은 셸에서 주입합니다(저장소에 넣지 않음):

```bash
export MKMONEY_PASSWORD_HASH='...'   # make password-hash 출력값
export MKMONEY_SESSION_SECRET=$(make -s secret)
export MKMONEY_ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
```

테스트와 화면 예시는 합성 데이터만 씁니다. 실제 파일은 `data/`(Git 제외)에 두고 커밋하지 않습니다.

## 운영 배포(최초 1회 준비)

### 1. 서버 IP 고정

서버(`mk-home-server`)는 현재 공유기 DHCP로 `192.168.0.2`를 받습니다. 공유기 관리 화면에서 이 서버 MAC 주소에 **`192.168.0.2` 고정 할당(DHCP 예약)** 을 설정하세요. 주소가 바뀌면 접속이 끊깁니다.

### 2. DNS 레코드(Cloudflare)

Cloudflare 대시보드 → `kangmin.kr` → DNS → 레코드 추가:

| 유형 | 이름 | 값 | 프록시 상태 |
|---|---|---|---|
| A | `money` | `192.168.0.2` | **DNS 전용(회색 구름)** |

- 반드시 **DNS 전용**이어야 합니다. 주황 구름(프록시)이면 Cloudflare가 트래픽을 중계하려다 실패합니다.
- 사설 IP를 가리키므로 집 밖에서는 연결되지 않습니다(공개 노출 없음). 사설 IP 주소가 공개 DNS에 보이는 점은 감수합니다.
- 일부 공유기는 "DNS 리바인딩 보호"로 사설 IP 응답을 막습니다. 집에서 `money.kangmin.kr`이 열리지 않으면 공유기에서 이 도메인을 예외로 두거나, 공유기의 내부 DNS(호스트 이름) 기능으로 같은 레코드를 추가하세요.

### 3. 환경 파일

```bash
cp .env.example .env
chmod 600 .env
make secret          # 출력값을 POSTGRES_PASSWORD에
make secret          # 출력값을 MKMONEY_SESSION_SECRET에
make password-hash   # 로그인 비밀번호 입력(12자 이상) → 출력된 한 줄로 MKMONEY_PASSWORD_HASH 교체
```

- `MKMONEY_PASSWORD_HASH`는 `$`를 포함하므로 **반드시 작은따옴표로 감싼 그대로** 둡니다(감싸지 않으면 값이 깨져 로그인이 실패합니다).
- `POSTGRES_PASSWORD`는 영문·숫자만 씁니다(DB 접속 URL에 들어갑니다).
- `make prod-config`로 설정 오류를 미리 확인할 수 있습니다.

### 4. 배포

```bash
make deploy   # 설정 검증 → (기존 DB가 있으면) 백업 → 재빌드·기동 → HTTPS 헬스·버전 확인
```

`scripts/deploy_prod.sh`는 `LAN_BIND_IP`가 사설 IP이고 이 서버의 주소인지 확인한 뒤에만 기동합니다.

### 5. 기기에 인증서 신뢰 등록

Caddy가 만든 로컬 CA 루트 인증서를 각 기기에 한 번 등록해야 브라우저 경고 없이 접속됩니다.

```bash
make ca-cert   # ./mkmoney-local-ca.crt 생성, SHA-256 지문 출력
```

파일을 기기로 옮길 때는 USB·AirDrop·직접 케이블 등 **신뢰할 수 있는 경로**를 쓰고, 등록 후 기기에 표시되는 지문이 위 출력과 같은지 확인하세요. 루트 인증서(공개키)만 옮기며, `caddy-data-prod/`의 개인키는 절대 복사하지 않습니다.

- **Android**: 설정 → 보안(및 개인정보 보호) → 기타 보안 설정 → 인증서 설치 → **CA 인증서** → 파일 선택. Chrome은 사용자 CA를 신뢰합니다(일부 앱은 신뢰하지 않으나 이 웹앱은 브라우저로 씁니다). 메뉴 이름은 제조사·버전마다 조금 다를 수 있습니다(설정 검색에서 "인증서"로 찾기).
- **iPhone/iPad**: 파일을 열어 프로파일 다운로드 → 설정 → 일반 → VPN 및 기기 관리 → 프로파일 설치 → 설정 → 일반 → 정보 → **인증서 신뢰 설정**에서 해당 루트 인증서를 **완전히 신뢰**로 켭니다.
- **Windows**: 파일 더블클릭 → 인증서 설치 → 로컬 컴퓨터 → "신뢰할 수 있는 루트 인증 기관".
- **macOS**: 키체인 접근 → 시스템 → 파일 끌어넣기 → 항목을 열어 "항상 신뢰".
- **Linux(Chrome)**: 설정 → 개인정보 및 보안 → 보안 → 인증서 관리 → 기관 → 가져오기.

루트 인증서 유효기간은 약 10년이며, 서버 인증서는 Caddy가 자동 갱신합니다. `caddy-data-prod/`를 지우면 새 CA가 만들어져 **모든 기기에 다시 등록**해야 합니다.

## 운영

```bash
make prod-ps     # 상태
make prod-logs   # 로그(요청 본문·거래 값은 기록하지 않음, 프록시 접근 로그 없음)
make backup      # 서버 DB 즉시 백업(최근 14개 유지)
make deploy      # 업데이트 배포(배포 전 자동 백업)
```

### 백업과 복원

- **서버 DB 백업**(`make backup`, 배포 시 자동): 서버 디스크 장애 대비용. 암호화되지 않으므로 서버 밖으로 옮기지 않습니다.
- **암호화 백업**(앱 → 설정): 브라우저에서 AES-GCM-256(PBKDF2 600,000회)으로 암호화한 파일을 내려받습니다. 외부 보관용입니다.
- **복원**(앱 → 설정 → 백업에서 복원): 미리보기 후 승인하면 **백업에만 있는 거래·설정을 추가**합니다. 기존 거래·설정은 덮어쓰거나 지우지 않습니다. 잘못된 암호·손상 파일은 아무것도 바꾸지 않습니다.

### 버전·릴리스

- `make release V=x.y.z MSG="요약"`: 버전 동기화 → 검사 → 기록 → 커밋 → 푸시(배포 없음)
- `make ship V=x.y.z MSG="요약"`: release + 배포
- 커밋마다 patch, 기능 단위 완료 시 minor를 올립니다. 기록은 `dev_record.md`.

## 하지 않는 것

공개 인터넷 노출, 여러 사용자 계정, 클라우드 동기화, 금융기관 연동, 상품 추천·투자 판단, 통화 환산, 가져오기로 기존 거래 수정·삭제.
