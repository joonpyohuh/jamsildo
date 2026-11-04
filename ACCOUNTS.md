# 계정·저장·운영

Supabase 프로젝트 `pcjewnxnbciofdmveeto` (서울)에서 Auth, Postgres, `jamsildo-account` Edge Function을 사용한다. Vercel 프로젝트는 기존 `jamsildo`다.

- 가입: 영문/숫자/밑줄 아이디 3~20자, 비밀번호 8~72자. 실제 이메일을 받지 않으며 내부 인증 주소는 `아이디@players.jamsildo.invalid`다. 이메일 복구는 제공하지 않는다.
- 관리자: Auth의 서버 전용 `app_metadata.jamsildo_admin = true`와 변경 권한이 없는 플레이어 레코드를 함께 검사한다. 비밀번호는 코드나 마이그레이션에 넣지 않는다. 관리자 로그인 후 계정 창에서 비밀번호를 바꿀 수 있다.
- 저장: 5초마다 계정별 기기 저장, 15초마다 클라우드 동기화, 탭 숨김/종료 시 추가 동기화. 오프라인 기록은 같은 기기에서 재전송한다. 다른 기기의 새 기록과 충돌하면 덮어쓰기를 중단하고 다운로드/서버 재불러오기를 제공한다.
- 복원: 현재 스테이지와 지도, 방 클리어/보상 여부, 방문 방, 정령, 성장/재화를 보관한다. 전투 도중 종료하면 현재 방 전투를 다시 시작한다. 쓰러진 후에는 현재 스테이지에서 다시 도전한다.
- 시간: 화면이 보이고 게임 진행 중인 시간만 누적한다. 설정/보상/계정/관리자 창과 타이틀/클리어/쓰러짐은 제외한다. 서버는 세션별 누적값을 중복 없이 더하고 경과 시간으로 상한을 제한한다. 클라이언트 게임이므로 경쟁용 서버 권위 판정/치트 방지는 범위에 없다.
- 운영: 가입자 수, 한국 시간 기준 신규/방문, 최근 60초 접속, 총 시간, 유저 검색·정렬·진행도, 스테이지별 인원, 제한/해제와 감사 기록. 스테이지 테스트는 별도 기기 저장 영역을 사용하며 실제 클라우드 기록에 쓰지 않는다.

## 로컬 실행

`.env.example`을 `.env.local`로 복사하고 `SUPABASE_URL`을 설정한 뒤 `npm run dev`를 실행한다. Vite는 계정 API를 Supabase Edge Function으로 프록시한다. Vercel은 `api/account.js`를 통해 같은 출처의 HttpOnly/Secure 세션 쿠키를 전달한다. 서버 키는 Supabase 함수 환경에서만 읽는다.

## 검증

`npm run build`, `npm run test:accounts`, `npm run test:campaign`, `npm run test:responsive`.

브라우저 검증에는 기존 Playwright 설치가 필요하며 `PLAYWRIGHT_MODULE`로 설치 위치를 지정할 수 있다. 계정 검증의 관리자 항목은 `JAMSILDO_ADMIN_PASSWORD` 환경변수로 실행한다. `SUPABASE_URL`과 공개 `SUPABASE_PUBLISHABLE_KEY`를 주면 RLS 직접 호출 검증도 한다. `BASE_URL`로 배포 주소를 검사할 수 있다. 테스트가 만든 계정 ID는 시스템 임시 폴더 `jamsildo-accounts/test-users.json`에 기록한다. 테스트 후 운영 통계에서 제거한다.

## 변경 배포

스키마는 `supabase/migrations`, API는 `supabase/functions/jamsildo-account`에 있다. Edge Function은 자체 쿠키 인증을 수행하므로 플랫폼 JWT 검증은 비활성화하고 배포한다. API 파일을 바꾸면 Edge Function도 재배포해야 한다. Vercel 환경변수에는 공개 프로젝트 주소 `SUPABASE_URL`만 필요하다.
