"""로그인 비밀번호의 Argon2id 해시를 만든다. 비밀번호는 출력·저장하지 않는다.

사용: make password-hash  (출력된 한 줄을 .env에 붙여 넣는다)
"""

import getpass
import sys

from app.security import hash_password

MIN_LENGTH = 12


def main() -> int:
    """비밀번호를 두 번 입력받아 .env 형식의 해시 줄을 출력한다."""
    password = getpass.getpass("새 로그인 비밀번호(12자 이상): ")
    if len(password) < MIN_LENGTH:
        print(f"비밀번호는 {MIN_LENGTH}자 이상이어야 합니다.", file=sys.stderr)
        return 1
    if getpass.getpass("비밀번호 확인: ") != password:
        print("비밀번호 확인이 일치하지 않습니다.", file=sys.stderr)
        return 1
    # $ 문자가 Compose 변수로 해석되지 않도록 작은따옴표로 감싼다.
    print(f"MKMONEY_PASSWORD_HASH='{hash_password(password)}'")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
