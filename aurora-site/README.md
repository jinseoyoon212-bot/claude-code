# Aurora 웹사이트 (Cloudflare Pages)

오로라 얼굴 + 리퀴드 글래스 UI + 대화 + 음성(얼굴 터치)만 있는 **웹 전용 버전**입니다.
기기 조작 기능(폰·PC 제어, 어시스턴트 오버레이, 접근성, Shizuku, 파일/명령 실행)은 **포함되어 있지 않습니다.**

## 배포 (Cloudflare Pages)
**방법 A — GitHub 연결 (추천)**
1. Cloudflare 대시보드 → Workers & Pages → Create → Pages → Connect to Git → 이 저장소 선택
2. 설정
   - Production branch: 배포할 브랜치 (예: `main`)
   - Framework preset: `None`
   - Build command: *(비워 둠)* — `public/`이 이미 빌드되어 커밋돼 있습니다. 직접 빌드하려면 `node aurora-site/build.js`
   - Build output directory: `aurora-site/public`
3. Save and Deploy

**방법 B — 직접 업로드**
```
node aurora-site/build.js
npx wrangler pages deploy aurora-site/public --project-name aurora
```

## 수정 후 다시 만들기
```
node aurora-site/build.js      # aurora-site/public 생성 + 파일 크기 검사
```
`aurora-agent/src`(얼굴·UI·AI 연결·음성)와 `aurora-site/src`(사이트 전용 HTML/백엔드)를 합쳐 만듭니다.
기기 조작용 코드는 `/*NATIVE:BEGIN … END*/` 표시가 달린 부분을 빌드 때 자동으로 걷어냅니다.

## 파일 크기 (Cloudflare Pages: 파일당 25 MiB 한도)
빌드가 모든 파일을 검사하고 25 MiB를 넘는 파일이 있으면 **실패**합니다. 현재 가장 큰 파일은 약 57 KB(`assets/app.*.js`)이고 전체가 약 73 KB라서 쪼갤 필요가 없습니다.
나중에 큰 자산(이미지·모델 등)을 넣을 때 25 MiB를 넘으면 빌드가 막아 주니, 그때 분할하세요.

## 보안·개인정보
- 서버가 없습니다. 브라우저가 AI 제공자 API(Pollinations / Gemini / Claude / Groq / OpenRouter)를 **직접** 호출합니다.
- API 키는 사용자의 브라우저(localStorage)에만 저장되고 이 사이트 서버로 전송되지 않습니다. **키를 코드에 넣지 마세요.**
- `_headers`로 CSP(허용 도메인 제한), 마이크 권한(자기 사이트만), 캐시 정책을 적용합니다.
- 기본 제공자(Pollinations)는 키 없이 쓰는 공개 무료 서버입니다. 입력 내용이 제3자 서버로 가므로 민감한 내용은 피하세요.
- 얼굴을 눌러 말하는 기능은 HTTPS 환경(Cloudflare Pages는 기본 HTTPS)에서 Gemini 키가 있을 때 동작합니다.
