# Aurora Web / APK — PC 앱과 같은 기능
웹·APK는 PC의 Aurora 브리지 서버에 연결해 **PC의 명령 실행·파일 읽기/쓰기/편집·시스템 정보**를 똑같이 씁니다.

## 연결 방법
1. PC 앱(exe) ⚙ 설정 → "폰·웹에서 이 PC 원격 사용 허용" 체크 → 저장. 접속 주소(`http://PC주소:8765/?token=...`)가 표시됩니다.
2. 폰/다른 PC 브라우저에서 그 주소를 열면 끝 (토큰 자동 저장). 같은 Wi-Fi여야 합니다. 외출 중이면 Tailscale 같은 VPN 권장.
3. APK는 ⚙ 설정에 "PC 서버 주소"와 "토큰"을 입력.
- PC 없이 앱만 쓰면 API 키로 대화만 가능(직접 모드).
- 창 없이 서버만: `cd aurora-agent && AURORA_API_KEY=sk-ant-... npm run bridge`

## 보안
- 서버는 토큰이 없으면 모든 API를 거부합니다. 토큰은 PC 앱이 자동 생성합니다. 주소를 아무에게나 공유하지 마세요.
- 기본값은 명령/파일 쓰기마다 승인 창(원격이면 폰 화면에 뜸). "자동 실행"은 PC 앱에서만 켤 수 있습니다.
- 인터넷에 직접 포트를 열지 마세요(http, 암호화 없음).

## 빌드
- 웹: `npm run sync` 후 `www/` 배포 (GitHub Pages 워크플로 포함). 단, https 페이지에서는 http PC 서버로 연결이 막히므로 PC가 직접 서빙하는 주소를 쓰세요.
- APK: Actions `Build Android APK` → `AuroraAgent-apk`.
