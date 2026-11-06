# CLAUDE.md

이 프로젝트의 개발 지침은 `AGENTS.md`에 있다. 아래 import로 그 내용을 그대로 불러와 따른다.
지침을 고칠 때는 이 파일이 아니라 `AGENTS.md`를 수정한다(내용 중복·불일치 방지).

@AGENTS.md

## Claude 전용 보충 (이 저장소)

- 버전은 `x.y.z`, 화면 표시 버전 3곳(`frontend/package.json`·`backend/pyproject.toml`·`backend/app/__init__.py`)은 항상 같아야 한다(`backend/tests/test_health.py`가 검사).
- 커밋·푸시는 사용자가 요청할 때만 `make release V=x.y.z MSG="요약"`으로 한다(버전 동기화→검증→dev_record 기록→`vX.Y.Z: 요약` 커밋→푸시). 운영 배포가 준비되면 `make ship`.
- 커밋마다 patch를 올리고, 기능 단위가 끝나면 minor를 올린다.
