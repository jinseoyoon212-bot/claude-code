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

범례: ✅ 실제 환경에서 확인 · 🧪 단위/브라우저 테스트로만 확인 (`pnpm test:web`) · ❌ 미지원

| 기능 | 상태 | 비고 |
| --- | --- | --- |
| 앱 부팅, DB 스키마/마이그레이션 (SQLite WASM) | ✅ | |
| 계정 생성, 새로고침 후 유지 (OPFS + IndexedDB) | ✅ | |
| Session 네트워크 연결 (relay 경유, 초록 점) | ✅ | relay 필요 |
| libsession: 프로필/연락처/그룹 목록/대화 상태, 블라인딩 | ✅ | |
| 1:1 메시지 암호화/복호화 | 🧪 | 공식 WASM의 `encodeFor1o1`/`decodeEnvelope1o1` 그대로 사용. 왕복 테스트 통과, 실제 상대와 주고받는 것은 미확인 |
| 노트투셀프(동기화) 메시지 | 🧪 | 위와 동일 경로 |
| 커뮤니티(SOGS) 메시지 암·복호화, 커뮤니티 DM 암호화 | 🧪 | 공식 WASM이 구현하지 않아 `web/libsession/messages.ts`에서 직접 구현 |
| 이미지 처리 (아바타, 썸네일, 업로드 용량 맞추기) | 🧪 | Chromium에서 확인. 애니메이션 GIF/WebP는 재인코딩 불가 → 원본 유지 + 정지 이미지 대체본 |
| 새 그룹(03) 만들기/참여/메시지 | ❌ | 아래 "그룹이 안 되는 이유" |
| Session Pro | ❌ | 결제가 앱스토어 기반이라 웹에서 구매 불가. Pro 서명은 보내지 않고, 받은 Pro 정보는 검증하지 않음 |
| 첨부파일 | 🧪 | 가상 파일시스템(IndexedDB). 업로드/다운로드 흐름은 미확인 |
| DB 비밀번호, 저장 데이터 암호화 | ❌ | OPFS는 평문 저장 |
| 통화(WebRTC) | 미확인 | |

### 그룹이 안 되는 이유

그룹 암호화(`encryptForGroup`/`decryptForGroup`)는 구현되어 있지만, 그룹 설정을 관리하는 `MetaGroupWrapperNode`는
공식 `@session-foundation/libsession-wasm` 0.0.14에 필요한 기능이 빠져 있어 만들 수 없습니다 (실험으로 확인):

- 저장해 둔 그룹 상태를 복원하지 못함: `new MetaGroupW(..., dump)`가 새 그룹의 빈 덤프도 `bt_deserialize_invalid_type`로 거부
- 그룹 정보/멤버 설정의 `confirmPushed`가 없음 → `needsPush`가 계속 true라서 같은 설정을 반복 전송하게 됨
- `needsRekey`, 멤버 프로필 갱신 시각, `pushForRecovery`, 멤버 쪽 서브계정 서명이 없음

JS로 흉내 내면 실제 그룹에 잘못된 설정을 올릴 수 있어서, 새 WASM이 나올 때까지 "미지원" 오류를 보여 줍니다.

## upstream 업데이트

`ts/`, `stylesheets/`, `images/` 등은 upstream 그대로입니다. `preload.js`가 바뀌면 `web/preload.ts`도,
`ts/webworker/worker_interface.ts`가 바뀌면 `web/overrides/worker_interface.ts`도 맞춰야 합니다.

라이선스: upstream은 GPL-3.0 (`LICENSE.session-desktop`).
