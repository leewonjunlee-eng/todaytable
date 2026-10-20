# 사용자·운영자 주소 분리

같은 Next.js 앱과 Railway 웹 서비스를 사용한다. 데이터베이스와 워커는 분리하지 않는다.

## 현재 주소

- 사용자: `https://todaytable-production.up.railway.app/`
- 운영자 로그인: `https://todaytable-production.up.railway.app/admin/login`
- 운영 현황: `https://todaytable-production.up.railway.app/admin`

사용자 홈은 운영자 계정으로 접속해도 사용자 화면을 표시한다. 운영자 로그인은 활성 운영팀 계정만 받아 로그인 후 `/admin`으로 이동한다. 사용자 화면에는 운영자 메뉴를 표시하지 않는다. 운영 페이지와 API의 서버 권한 검사를 유지한다.

## 별도 도메인 연결

사용자가 소유한 실제 도메인을 확인한 뒤 두 호스트를 **기존 todaytable 웹 서비스**에 연결하고 Railway가 안내하는 DNS 레코드를 등록한다. 예시는 실제 확보된 도메인이 아니다.

```dotenv
APP_URL=https://your-domain.com
ADMIN_APP_URL=https://admin.your-domain.com
```

두 값은 경로 없는 서로 다른 HTTP(S) origin이어야 한다. Railway HTTPS 인증서가 준비된 뒤 환경변수를 설정하고 웹 서비스를 배포한다. `ADMIN_APP_URL`을 설정하지 않으면 기존 단일 주소의 `/admin/login`을 사용한다. 도메인 구매·DNS 변경은 아직 수행하지 않았다.

- 사용자 주소의 `/admin/...`은 같은 경로·검색 조건을 유지해 운영자 주소로 이동한다.
- 운영자 주소의 `/`은 `/admin`, `/login`은 `/admin/login`으로 이동한다.
- 운영자 주소의 사용자 페이지는 사용자 주소로 이동한다.
- API·정적 자산은 도메인 이동 대상에서 제외한다. API 권한 검사는 각 핸들러에서 수행한다.
- 요청 출처는 명시적으로 설정한 현재 호스트와 일치해야 한다. 사용자·운영자 호스트 사이의 다른 origin 요청은 허용하지 않는다.
- 세션 쿠키는 Domain을 설정하지 않아 호스트별로 보관한다. 두 주소에서 각각 로그인한다. 로그아웃은 현재 호스트의 세션을 종료한다.
- 운영 화면의 ‘참가자 화면 보기’는 사용자 주소를 연다.

Railway가 설정하는 `X-Forwarded-Host`를 명시된 두 origin과 대조한다. 임의 호스트로 리다이렉트 주소를 만들지 않는다.

## 검증

`tests/site-origins.test.ts`는 호스트별 이동·검색 조건 보존·교차 origin 거부·운영자 로그아웃과 단일 호스트 호환을 확인한다. `tests/login-accounts.test.ts`는 운영자 로그인에서 사용자·비활성 운영자 거부와 세션 생성 여부를 확인한다.

브라우저 재현에는 먼저 `tests/prepare-operator-browser.ts`의 격리 fixture와 production build가 필요하다. Playwright가 설치된 Python으로 `tests/site-links-browser.py`를 실행하고, 같은 build의 서버 두 개를 3337·3338 포트에서 제공한다. 두 서버 모두 `APP_URL=http://127.0.0.1:3337`, `ADMIN_APP_URL=http://localhost:3338`과 `.data/operator-browser.env`를 사용한다. 이 검사는 마지막에 fixture 운영자 세션을 로그아웃하므로 재실행 전 fixture를 다시 만든다.
