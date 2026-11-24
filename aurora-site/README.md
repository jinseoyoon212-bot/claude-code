# Aurora 웹사이트 (Cloudflare Pages)

오로라 얼굴 + 리퀴드 글래스 UI + 대화 + 음성(얼굴 터치)만 있는 **웹 전용 버전**입니다.
기기 조작 기능(폰·PC 제어, 어시스턴트 오버레이, 접근성, Shizuku, 파일/명령 실행)은 **포함되어 있지 않습니다.**

## 배포 (Cloudflare Pages)
> ⚠️ **Root directory를 `aurora-site`로 지정**해야 `functions/`(AI 연결 함수)가 함께 배포됩니다. 함수 폴더는 "루트 디렉터리" 아래에서 찾기 때문입니다.

**방법 A — GitHub 연결 (추천)**
1. Cloudflare 대시보드 → Workers & Pages → Create → Pages → Connect to Git → 이 저장소 선택
2. 설정
   - Production branch: 배포할 브랜치
   - Framework preset: `None`
   - **Root directory: `aurora-site`**
   - Build command: *(비워 둠)* — `public/`이 이미 빌드되어 커밋돼 있습니다. 직접 빌드하려면 `node build.js`
   - **Build output directory: `public`**
3. Save and Deploy
4. **AI 연결 추가 (필수, 1분)**: 프로젝트 → Settings → **Bindings** → Add → **Workers AI** → Variable name을 정확히 `AI`로 → Save → 다시 배포(Retry deployment)
5. 확인: `https://<사이트>/api/health` 를 열어 `{"ok":true, "model": …, "sample": "안녕"}` 이 나오면 성공

**방법 B — 직접 업로드** (aurora-site 폴더에서)
```
node build.js
npx wrangler pages deploy public --project-name aurora
```
이후 위 4번(Bindings → Workers AI → `AI`)을 대시보드에서 추가하세요.

## 기본 AI ("Aurora 기본 AI") — 키 없이 무료
방문자는 API 키가 필요 없습니다. 브라우저 → 이 사이트의 `/api/v1/chat/completions`(Pages Function) → **Cloudflare Workers AI** 로 연결됩니다.

| 항목 | 값 |
|---|---|
| 요청 속도 한도 | 텍스트 생성 **분당 300회** (Cloudflare 공식 한도) → 분당 100회 사용 가능 |
| 사이트 자체 제한 | IP당 분당 100회(`RATE_PER_MIN`으로 변경), 대화 12개·글자 2000자·답변 600토큰까지 |
| **무료 사용량** | **하루 10,000 Neurons** (계정 전체 합산, 매일 00:00 UTC = 오전 9시 KST 초기화) |
| 초과 시 | 화면에 "오늘의 무료 AI 사용량을 모두 썼어요"가 뜹니다. Workers Paid(월 $5~)로 올리면 초과분이 $0.011/1,000 Neurons로 과금 |

짧은 답변(입력 ~400토큰 + 출력 ~120토큰) 기준 한 번에 약 7 Neurons → **무료로 하루 약 1,400번 안팎**입니다. 분당 100회를 계속 쓰면 무료 사용량은 약 14분 만에 소진됩니다.

### 응답이 느리거나 끊길 때 (두 번째 질문부터 멈춤 등)
- **원인 1 — 모델의 "생각"**: Gemma 4 같은 모델은 `chat_template_kwargs.enable_thinking` 기본값이 `true`라서 답하기 전에 길게 생각합니다(한 번에 10초 이상). 서버가 모든 요청에 `enable_thinking:false`를 보내 끕니다. 그 옵션을 못 받는 모델이면 옵션 없이 다시 시도합니다.
- **원인 2 — 무료 플랜 CPU 10ms 한도**: Pages Functions(무료)는 요청당 CPU 10ms입니다. 스트림 이벤트를 서버에서 하나씩 해석하면 이 한도를 넘어 응답이 중간에 끊깁니다(브라우저에는 `network error`). 그래서 **서버는 스트림을 가공 없이 그대로 통과**시키고, 해석·안전장치는 브라우저가 합니다.
- **브라우저 안전장치**: 모델이 생각만 길게 하면(약 1,500자/9초) 끊고 "생각 없이" 다시 요청 · 연결이 끊기면 한 번 더 요청(스트리밍 없이) · 첫 글자 25초/전체 60초를 넘으면 안내 후 중단.
- **점검**: `https://<사이트>/api/health?deep=1` — 대화가 이어진 두 번째 질문 상황을 시험합니다. `ms`가 작을수록(생각이 꺼지면 보통 1~3초) 좋고, `thinkDetected:true`면 그 모델이 아직 생각을 한다는 뜻입니다.

### 환경변수 (Pages → Settings → Variables and Secrets)
| 이름 | 설명 |
|---|---|
| `AI_MODEL` | 사용할 모델(쉼표로 여러 개 가능, 앞에서부터 시도). 기본: `@cf/google/gemma-4-26b-a4b-it` → `@cf/qwen/qwen3-30b-a3b-fp8` → `@cf/meta/llama-3.1-8b-instruct-fp8-fast` |
| `ALLOWED_ORIGINS` | 사이트 주소 외에 호출을 허용할 출처(쉼표 구분, 예: `https://my.domain.com`) |
| `RATE_PER_MIN` | IP당 분당 대화 요청 한도 (기본 100) |
| `SEARCH_PER_MIN` | IP당 분당 검색 요청 한도 (기본 30) |
| `SERPER_API_KEY` / `GEMINI_API_KEY` / `TAVILY_API_KEY` / `BRAVE_API_KEY` | (Secret) 구글·범용 웹 검색용. 위 "실시간 웹 검색" 참고 |

### 악용 방지 (키가 없는 공개 엔드포인트라서 꼭 권장)
- 같은 사이트가 아닌 출처의 호출은 거부합니다(`Origin` 확인). 다만 브라우저 밖에서는 헤더를 위조할 수 있으니,
- Cloudflare 대시보드 → Security → WAF → **Rate limiting rules**에 `/api/*` 경로를 IP당 분당 100~120회로 제한하는 규칙을 하나 추가하세요(무료 플랜 1개 포함).
- 사용량은 대시보드 → AI → Workers AI에서 확인할 수 있습니다.

## 🔍 실시간 웹 검색
최신 정보가 필요한 질문(날씨·뉴스·환율·가격·순위·"검색해줘" 등)이면 자동으로 검색하고, 그 결과를 AI에게 근거로 주어 답합니다. 답변 아래에 **출처 칩**(클릭하면 원문)이 붙습니다. ⚙ 설정 → "🔍 실시간 웹 검색"에서 자동/항상/끄기를 고를 수 있습니다.
브라우저 → `/api/search`(Pages Function) → 아래 소스. 키는 방문자가 아니라 **사이트 주인이 서버 비밀값으로** 한 번만 넣습니다.

| 소스 | 키 | 되는 것 |
|---|---|---|
| Open-Meteo | 필요 없음 | 도시별 **실시간 날씨**·3일 예보 (주요 한국/해외 도시는 좌표 표로 즉시 처리) |
| ExchangeRate-API | 필요 없음 | 원/달러·엔·유로·위안 **환율** |
| Google 뉴스 RSS | 필요 없음 | **뉴스·속보** (최신 기사 6건, 출처·시각 포함) |
| 위키백과 | 필요 없음 | 사실·개념 설명 (거절되거나 관련이 없으면 자동으로 버림) |
| **Tavily / Brave / Serper** | **사이트 주인이 1개만 추가** | **범용 웹 검색**(제품 가격, 맛집, 일반 정보 등 무엇이든) |

> ⚠️ **키가 없으면 범용 웹 검색은 안 됩니다.** 확인해 보니 DuckDuckGo(봇 차단 202), Google(자바스크립트 차단), Brave 웹/Mojeek/Yahoo(차단·오류), Bing RSS(엉뚱한 결과)는 키 없이는 믿을 수 없었습니다. 그래서 위 키 없는 소스만 쓰고, 일반 웹 검색을 하려면 아래처럼 키를 추가하세요.

### 구글 검색 켜기 (추천: Serper, 약 1초 · 무료 2,500회 · 카드 불필요)
**구글은 키 없이 긁어 갈 수 없습니다**(봇 차단). 진짜 구글 결과는 아래 둘 중 하나로만 가능합니다.
1. **Serper (추천)** — https://serper.dev 가입 → API Key 복사 → Cloudflare Pages → Settings → **Variables and Secrets** → 유형 **Secret**, 이름 `SERPER_API_KEY` → Save → 다시 배포. 구글의 "바로 답"·지식 패널·뉴스·일반 결과를 모두 씁니다.
2. **Gemini 구글 검색 연동** — 이미 Gemini 키가 있다면 Secret `GEMINI_API_KEY`로 추가(모델은 `GEMINI_SEARCH_MODEL`, 기본 gemini-2.5-flash). 구글 검색으로 근거를 찾아 요약해 줍니다.

그 밖에 `TAVILY_API_KEY`, `BRAVE_API_KEY`도 가능합니다. 여러 개를 넣으면 Serper → Gemini → Tavily → Brave 순으로 씁니다. 확인: `/api/health?search=1` (검색시간ms와 실패 이유가 나옵니다).

**속도:** 검색은 소스를 동시에 부르고 전체 4.5초(Gemini 6초) 안에 끝냅니다. 느린 소스는 버리고 받은 결과로 답하며, 화면에는 "검색 중… N초"와 "검색 0.4초 · Google" 같은 안내 칩이 나옵니다.

### 한도·비용·개인정보
- 검색은 IP당 분당 30회(`SEARCH_PER_MIN`), 같은 질의는 2~10분 캐시(날씨 5분, 뉴스 2분)
- 사용자의 질문(검색어)이 위 검색 서비스로 전송됩니다. 민감한 내용은 입력하지 마세요.
- 검색 결과 안의 문장은 "자료"로만 쓰도록 AI에게 지시하며(프롬프트 주입 방지), 링크는 http/https만 허용합니다.
- 무료 플랜 CPU 한도(요청당 10ms)에 맞춰 큰 응답은 앞부분만 읽고 가볍게 파싱합니다(뉴스 파싱 약 1ms).

## 수정 후 다시 만들기
```
node aurora-site/build.js      # aurora-site/public 생성 + 파일 크기 검사
```
`aurora-agent/src`(얼굴·UI·AI 연결·음성)와 `aurora-site/src`(사이트 전용 HTML/백엔드)를 합쳐 만듭니다. 빌드는 번들 JavaScript 문법도 검사합니다. 서버 함수 시험: `functions/`는 Pages Function이며 `npx wrangler pages functions build functions`로 컴파일 확인이 가능합니다.
기기 조작용 코드는 `/*NATIVE:BEGIN … END*/` 표시가 달린 부분을 빌드 때 자동으로 걷어냅니다.

## 파일 크기 (Cloudflare Pages: 파일당 25 MiB 한도)
빌드가 모든 파일을 검사하고 25 MiB를 넘는 파일이 있으면 **실패**합니다. 현재 가장 큰 파일은 약 57 KB(`assets/app.*.js`)이고 전체가 약 73 KB라서 쪼갤 필요가 없습니다.
나중에 큰 자산(이미지·모델 등)을 넣을 때 25 MiB를 넘으면 빌드가 막아 주니, 그때 분할하세요.

## 보안·개인정보
- 기본 AI는 이 사이트의 `/api`(Pages Function)를 거쳐 Cloudflare Workers AI로 갑니다. 다른 제공자(Gemini / Claude / Groq / OpenRouter / Pollinations)를 고르면 브라우저가 그쪽 API를 **직접** 호출합니다.
- API 키는 사용자의 브라우저(localStorage)에만 저장되고 이 사이트 서버로 전송되지 않습니다. **키를 코드에 넣지 마세요.**
- `_headers`로 CSP(허용 도메인 제한), 마이크 권한(자기 사이트만), 캐시 정책을 적용합니다.
- 대화 내용은 Cloudflare Workers AI(기본) 또는 사용자가 고른 제공자로 전송됩니다. 민감한 내용은 입력하지 마세요. 이 사이트는 대화를 저장하지 않습니다.
- 얼굴을 눌러 말하는 기능은 HTTPS 환경(Cloudflare Pages는 기본 HTTPS)에서 Gemini 키가 있을 때 동작합니다.
