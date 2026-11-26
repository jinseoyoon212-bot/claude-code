# Warbattle (Godot 4.3)

Kestrel Island에서 벌어지는 30인 배틀로얄입니다. three.js 웹 버전(`../warbattle`)을 Godot 4.3으로 다시 만든 버전입니다.

## 렌더러별 화질
| 플랫폼 | 렌더러 | 켜지는 기능 |
|---|---|---|
| Windows (High/Ultra) | Forward+ (Vulkan/D3D12) | SDFGI 실시간 전역 조명, SSAO, SSIL, 볼류메트릭 안개, 4단 그림자(최대 450m), TAA, 글로우 |
| Windows (Medium) | Forward+ | SSAO, 4단 그림자(160m), FSR2 업스케일 |
| Android | Mobile (Vulkan) | 4단 그림자, 글로우, MSAA |
| 웹 | Compatibility (WebGL 2) | 그림자, 글로우, 안개, MSAA |

## 실행
```bash
godot --path warbattle-godot                # 에디터에서 열기
godot --path warbattle-godot -- --autoplay  # 메뉴 없이 바로 매치 시작
```

## 내보내기
```bash
cd warbattle-godot
godot --headless --export-release "Windows Desktop" build/windows/Warbattle.exe
godot --headless --export-release "Android" build/android/Warbattle.apk   # Android SDK + 디버그 키 필요
godot --headless --export-release "Web" build/web/index.html
python3 tools/postprocess_web.py build/web                                # 25MiB 넘는 파일 분할
```

## 웹 배포 (Cloudflare Pages)
`build/web`가 이 브랜치에 커밋되어 있습니다. Cloudflare 대시보드에서 다음과 같이 연결하면 됩니다.

1. **Workers & Pages → Create → Pages → Connect to Git**에서 이 저장소를 고릅니다.
2. **Production branch**: 이 작업 브랜치 이름
3. **Framework preset**: None
4. **Build command**: 비워 둠
5. **Build output directory**: `warbattle-godot/build/web`

Cloudflare Pages는 파일 하나당 25MiB까지만 받습니다. Godot 엔진(`index.wasm`, 35MB)과 게임 데이터(`index.pck`)는 `tools/postprocess_web.py`가 24MB 조각(`.part0`, `.part1`…)으로 나눕니다. `index.html` 맨 앞의 작은 스크립트가 조각을 받아 이어 붙인 뒤 Godot에 넘기므로, 엔진은 원본 파일을 받은 것과 똑같이 동작합니다. 스레드를 쓰지 않는 빌드라 COOP/COEP 헤더 설정도 필요 없습니다.

## 조작
WASD 이동 · Shift 달리기 · 마우스 조준/사격 · 우클릭 정조준 · F 강하/낙하산/줍기 · R 재장전 · C 앉기 · Q/E 기울이기 · 1~3 무기 · G 수류탄 · T 연막 · H 치료 · V 시점 · M 지도. 모바일은 왼쪽 조이스틱, 오른쪽 드래그, 화면 버튼.

## 에셋
- 캐릭터: three.js 예제의 Mixamo 캐릭터(`soldier.glb`, Idle/Walk/Run/TPose)
- 나무·풀·관목·바위·가구·소품·볼트액션 소총·권총·수류탄·텍스처·HDRI: [Poly Haven](https://polyhaven.com), CC0
- 글꼴: Barlow, Barlow Condensed (SIL OFL, `assets/fonts/OFL.txt`)
- 직접 만든 것: 섬 생성, 건물, KR-9/VX-45 총기, 연막탄, 수송기, 낙하산, UI, 합성 사운드
