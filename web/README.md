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

| 기능                                                | 상태 |
| --------------------------------------------------- | ---- |
| 앱 부팅, DB 스키마/마이그레이션 (SQLite WASM)          | ✅   |
| 계정 생성, 새로고침 후 유지 (OPFS + IndexedDB)         | ✅   |
| libsession: 프로필/연락처/그룹목록/대화상태 설정, 블라인딩 | ✅   |
| Session 네트워크 요청 (relay 경유)                    | ✅ 클라이언트 라우팅 · ⚠️ 실제 노드 연결은 relay 배포 후 확인 필요 |
| 1:1 메시지 암호화/복호화 (`encryptFor1o1`, `decryptFor1o1`) | ❌ WASM 매핑 필요 |
| 그룹(MetaGroup), 커뮤니티 메시지, Session Pro          | ❌   |
| 이미지 처리(아바타/첨부 리사이즈)                      | ❌ OffscreenCanvas로 구현 필요 |
| DB 비밀번호, 저장 데이터 암호화                         | ❌ (OPFS는 평문 저장) |
| 통화(WebRTC)                                         | 미확인 |

## upstream 업데이트

`ts/`, `stylesheets/`, `images/` 등은 upstream 그대로입니다. `preload.js`가 바뀌면 `web/preload.ts`도,
`ts/webworker/worker_interface.ts`가 바뀌면 `web/overrides/worker_interface.ts`도 맞춰야 합니다.

라이선스: upstream은 GPL-3.0 (`LICENSE.session-desktop`).
