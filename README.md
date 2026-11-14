# 빛과 어둠의 마법 전쟁 — 웹 배포 브랜치

이 브랜치는 자동 생성된 웹 빌드입니다. 직접 수정하지 마세요.
소스와 빌드 방법은 `ccr-1355a82c-vzkrkz` 브랜치의 `wizard-war-3d/README.md`를 보세요.

- `index.wasm.N.bin`: 엔진 파일(`index.wasm`)을 4조각으로 나눈 것 (Cloudflare 파일당 25MiB 제한 때문)
- `.assetsignore`: Cloudflare에 올리지 않을 파일 (원본 `index.wasm` 등)
- `wrangler.jsonc`: Cloudflare Workers 정적 배포 설정 (Worker 이름 `claude-code`)
