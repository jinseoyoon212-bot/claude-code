# Session Web (비공식)

Session Desktop (`ts/`, upstream [session-foundation/session-desktop](https://github.com/session-foundation/session-desktop) @ `3bfb0f1`)
을 **소스 수정 없이** 브라우저에서 실행하는 포팅입니다. Electron·Node·네이티브 모듈이 하던 일을
`web/` 아래의 브라우저용 구현으로 바꿔 끼웁니다.

## 실행

```bash
pnpm install --ignore-scripts      # Electron/네이티브 모듈 빌드는 필요 없음
pnpm build:web                     # -> dist-web/ (정적 파일)
pnpm start:web                     # 개발 서버 http://localhost:8080
```

`dist-web/`는 아무 정적 호스팅에 올리면 됩니다.

### Cloudflare Pages

Git 연결로 배포할 때 설정:

| 항목                    | 값                                                                      |
| ----------------------- | ----------------------------------------------------------------------- |
| Production branch       | `ccr-0e41d845-j2twfo`                                                    |
| Build command           | `pnpm install --frozen-lockfile --ignore-scripts && pnpm build:web`      |
| Build output directory  | `dist-web`                                                               |
| 환경변수                | `NODE_VERSION=24.22.1`, (선택) `SESSION_WEB_RELAY_URL=https://<relay>`    |

저장소에 `.tool-versions`를 두지 마세요. Cloudflare가 asdf로 Node를 설치하려다 `node plugin is not installed`로 실패합니다 (Node 버전은 `.nvmrc`로 고정).

`gh-pages` 브랜치에 빌드 결과를 올리는 워크플로는 두지 않습니다. Cloudflare가 그 브랜치를 소스로 착각해 빌드하다 실패하기 때문입니다 (`No package.json found`).
 현재 배포는 Cloudflare Pages (`https://session-relay.pages.dev`)입니다.

## 구조

| 데스크톱 (Electron)                         | 웹                                                                   |
| ------------------------------------------- | -------------------------------------------------------------------- |
| main process (`ts/mains/main_node.ts`)      | `web/index.ts` + `web/main/ipcMainHandlers.ts` (페이지 안에서 IPC 처리) |
| SQLCipher (`@signalapp/sqlcipher`)           | `web/shims/sqlcipher.ts` → SQLite WASM + OPFS, `web/main/sql.worker.ts` |
| `libsession_util_nodejs` (C++ addon)         | `web/libsession/index.ts` → `@session-foundation/libsession-wasm`      |
| `preload.js`                                | `web/preload.ts`                                                      |
| `fs` / `fs-extra` (첨부파일)                  | `web/shims/fs.ts` → 메모리 + IndexedDB                                |
| `node-fetch` + 고정 인증서 https agent         | `web/shims/node-fetch.ts` → `fetch`, Session 노드는 relay 경유          |
| `sharp` 이미지 처리 워커                       | `web/workers/image_processor.worker.ts` (아직 미지원)                  |

`ts/` 코드는 데스크톱과 같은 CommonJS로 컴파일합니다(순환 import 때문에 ESM으로 바꾸면 깨짐).

## 네트워크 (relay)

브라우저는 Session seed/service 노드에 직접 연결할 수 없습니다 (비표준 포트, 자체 서명/고정 인증서).
그래서 해당 요청만 `web/relay/server.js`를 거칩니다.

- relay는 목적지(가드 노드 IP)와 트래픽 크기·시간만 봅니다. 메시지 내용은 클라이언트가 onion 암호화합니다.
- 공인 IPv4 + 1024 이상 포트, seed 노드 도메인으로만 전달합니다 (내부망·임의 사이트 차단).

```bash
ALLOWED_ORIGINS=https://<owner>.github.io PORT=8787 node web/relay/server.js
# 또는 (저장소 루트에서): docker build -f web/relay/Dockerfile -t session-relay . && docker run -p 8787:8787 session-relay
```

relay 주소는 빌드할 때 넣습니다: `SESSION_WEB_RELAY_URL=https://relay.example.com pnpm build:web`
(Cloudflare Pages에서는 Settings > Variables and Secrets의 `SESSION_WEB_RELAY_URL`).
relay가 없으면 앱은 오프라인 상태(왼쪽 아래 빨간 점)로 동작합니다.

## 현재 상태

범례: ✅ 실제 Session 네트워크(중계 서버 경유)에서 웹 클라이언트끼리 확인 · 🧪 테스트(`pnpm test:web`)로만 확인 · ❌ 미지원

| 기능 | 상태 | 비고 |
| --- | --- | --- |
| 앱 부팅, DB 스키마/마이그레이션 (SQLite WASM) | ✅ | |
| 계정 생성, 새로고침 후 유지 (OPFS + IndexedDB) | ✅ | |
| Session 네트워크 연결 (양파 라우팅, 초록 점) | ✅ | relay 필요 |
| 1:1 메시지 (웹 ↔ 웹) | ✅ | 약 10~20초. 폰/데스크톱 Session 앱과의 호환은 아직 못 해 봄 |
| 새 그룹(03): 만들기, 초대, 수락, 그룹 메시지(양방향) | ✅ | 웹 3명 |
| 그룹: 이름 변경, 멤버 추가(초대), 멤버 제거 후 새 키로 읽기 차단 | ✅ | |
| 그룹: 새로고침 후 복원 | ✅ | |
| 공개 커뮤니티(SOGS) 참여와 메시지 읽기 | ✅ | 공식 Session 커뮤니티에서 실제 메시지 확인. 쓰기·DM은 미확인 |
| 노트투셀프(동기화) 메시지 | 🧪 | |
| 이미지 처리 (아바타, 썸네일, 업로드 용량 맞추기) | ✅ | 썸네일/업로드는 위 흐름에서 확인. 애니메이션 GIF/WebP는 재인코딩 불가 → 원본 유지 + 정지 이미지 대체본 |
| 이미지 첨부 전송/수신 (이미지 처리 → 암호화 → 파일 서버 업로드/다운로드 → 복호화) | ✅ | 웹 ↔ 웹. 받는 쪽은 원본처럼 "Click to download media" → Auto Download 확인 |
| Session Pro | ❌ | 결제가 앱스토어 기반이라 웹에서 구매 불가. Pro 서명은 보내지 않고, 받은 Pro 정보는 검증하지 않음 |
| DB 비밀번호, 저장 데이터 암호화 | ❌ | OPFS는 평문 저장 |
| 통화(WebRTC) | 미확인 | |

`web/test/e2e/`에 실제 네트워크 종단 간 테스트(Playwright)가 있습니다.

### 그룹 구현 방식

공식 `@session-foundation/libsession-wasm` 0.0.14의 `MetaGroupW`에는 앱이 의존하는 기능이 빠져 있습니다 (실험으로 확인):
저장한 상태 복원(`new MetaGroupW(..., dump)`가 빈 덤프도 거부), 푸시 확인(`confirmPushed`), 암호화 키 읽기,
`needsRekey`, 멤버 쪽 서브계정 서명, 멤버 프로필 갱신 시각.

그래서 `web/libsession/metagroup.ts`가 **이벤트 기록(event sourcing)** 으로 이를 메웁니다 (+ `multiEncrypt`는 WASM에 nonce 인자가 없어 `web/libsession/messages.ts`에서 직접 구현):

- 상태에 영향을 준 것(받은 키 메시지, 병합한 설정 메시지, 내가 한 변경)을 순서대로 기록하고, WASM 객체는 이 기록에서 언제든 다시 만들 수 있는 값으로 취급합니다.
- **복원**: 저장하는 것은 libsession 덤프가 아니라 이 기록. 불러올 때 기록을 재생합니다.
- **푸시 확인**: 푸시한 스냅샷이 그보다 오래된 것들을 대체하고(네트워크가 준 해시와 함께), WASM을 다시 만들어 활성/오래된 해시가 맞게 합니다.
- 암호화 키는 키 설정 덤프(bencode)에서 libsession과 같은 규칙으로 읽습니다.
- 멤버 쪽 서브계정 서명은 libsession의 `swarm_subaccount_sign`을 JS로 옮겼고, 표준 Ed25519 검증으로 테스트합니다.

원본과 다른 점: `keysNeedsRekey()`는 항상 false, 멤버 프로필 갱신 시각은 로컬에서만 추적(동기화 설정에는 안 들어감), `memberResetAllSendingState()`는 할 일이 없음.
설정 메시지는 같은 libsession C++ 코드가 만든 실제 형식이고 웹 클라이언트끼리 실제 네트워크에서 동작을 확인했지만, 공식 Session 폰/데스크톱 앱과 주고받는 확인은 아직 못 했습니다.

## 화면 크기 (데스크톱 / 태블릿 / 폰)

빌드 하나, 사이트 하나, relay 서버 하나입니다. 화면 폭에 따라 CSS 미디어 쿼리로 배치만 바꿉니다
(`web/styles/layout.scss`, `web/styles/layoutControls.ts`). 앱 로직·네트워크는 그대로입니다.

| 폭 | 배치 |
| --- | --- |
| 1025px 이상 | 레일 + 대화 목록 + 채팅, 둥근 유리 카드. 목록은 가장자리 손잡이(또는 `Ctrl/⌘ + \\`)로 접고 펼침(기억함) |
| 701 ~ 1024px | 위와 같고 목록 폭만 260px |
| 700px 이하 | 한 번에 한 화면. 목록(하단 막대 + 새 대화 버튼) ↔ 채팅(뒤로가기 버튼). 브라우저/안드로이드 뒤로가기도 목록으로 돌아감 |

폰 레이아웃은 Session 안드로이드 앱(`session-foundation/session-android`)의 홈/대화 화면 구조(상단 툴바, 목록, 새 대화 FAB, 대화 툴바의 뒤로가기)를 참고했습니다. 코드를 가져온 것은 아니고 구조만 참고했습니다.
계정과 메시지 데이터는 브라우저(기기)마다 따로 저장됩니다. 다른 기기에서 같은 계정을 쓰려면 복구 문구로 복원하세요.

## upstream 업데이트

`ts/`, `stylesheets/`, `images/` 등은 upstream 그대로입니다. `preload.js`가 바뀌면 `web/preload.ts`도,
`ts/webworker/worker_interface.ts`가 바뀌면 `web/overrides/worker_interface.ts`도 맞춰야 합니다.

라이선스: upstream은 GPL-3.0 (`LICENSE.session-desktop`).
