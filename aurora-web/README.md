# Aurora Web / APK
- 웹: `npm run serve` (또는 `www/` 폴더를 아무 정적 호스팅에 올리기). 첫 화면 ⚙에서 API 키 입력(브라우저 localStorage에만 저장).
- APK: GitHub Actions `Build Android APK` → Artifacts의 `AuroraAgent-apk` (debug APK, 설치 시 "출처를 알 수 없는 앱" 허용 필요).
- 얼굴/UI는 `aurora-agent/src`와 공유됩니다. 수정 후 `npm run sync`.
- 웹/APK는 기기 파일·명령 접근이 불가능합니다(보안 샌드박스). 그건 PC용 Electron 앱에서만 가능.
