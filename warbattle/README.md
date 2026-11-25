# Warbattle

Kestrel Island에서 벌어지는 30인 배틀로얄 게임입니다. three.js로 만들었고 웹, Windows(.exe), Android(.apk)로 실행됩니다.

## 게임 구성
- **맵**: 1.6km × 1.6km 섬, 마을 10곳(군사기지 Ridgeback Base 포함), 도로, 숲, 산악 지형
- **흐름**: 수송기 강하 → 자유낙하 → 낙하산 → 파밍 → 6단계로 좁아지는 화염 폭풍 → 최후의 1인
- **무기**: KR-9 Carbine, VX-45 SMG, Halden M62(4배율 볼트액션), P-11 Sidearm, 막대 수류탄
- **탄도**: 탄속, 중력 낙차, 거리별 데미지 감소, 헤드샷 배율, 방탄복/헬멧 감쇠
- **봇 29명**: 문으로 건물 진입, 무기 우선 파밍, 시야 판정, 리드샷, 자기장 회피
- **그래픽**: HDRI 하늘 조명, PBR 텍스처 지형 블렌딩, 실시간 그림자, GPU 풀, 바람에 흔들리는 나무, 블룸, SMAA
- **사운드**: 녹음 파일 없이 합성한 3D 총성, 발소리, 탄환 스침음, 바람, 엔진음

## 조작
| 키 | 동작 |
|---|---|
| WASD / Shift | 이동 / 달리기 |
| 마우스 좌 / 우 | 사격 / 조준 |
| F | 강하, 낙하산, 줍기 |
| R / C / Space | 재장전 / 앉기 / 점프 |
| Q / E | 기울이기 |
| 1 2 3 / 휠 | 무기 교체 |
| G / H | 수류탄 / 치료 |
| V / M | 1·3인칭 전환 / 지도 |

모바일은 화면 왼쪽 조이스틱, 오른쪽 드래그 시점, 버튼으로 조작합니다.

## 실행과 빌드
```bash
# 웹 (dist/web 생성 후 아무 정적 서버로 실행)
node scripts/build-web.mjs
cd dist/web && python3 -m http.server 8000

# Windows 포터블 exe
cd desktop && npm install && npm run dist:win     # dist/desktop/Warbattle-1.0.0-portable.exe

# Android apk (Android SDK, JDK 17+ 필요)
cd mobile && npm install && npm run apk:debug     # mobile/android/app/build/outputs/apk/debug/app-debug.apk
```
`.github/workflows/warbattle.yml`이 push 때마다 exe와 apk를 빌드해 Actions 아티팩트로 올립니다.

## 에셋 출처
- **캐릭터**: three.js 예제 저장소의 `Soldier.glb`(Mixamo 캐릭터, Idle/Walk/Run/TPose 애니메이션 포함). Mixamo 이용 약관에 따라 게임 안에 포함해 쓰는 용도입니다. 조준 자세와 앉기는 IK로 코드에서 만듭니다.
- **나무, 풀, 관목, 바위, 가구, 소품, 볼트액션 소총, 권총, 수류탄, PBR 텍스처, HDRI 하늘**: [Poly Haven](https://polyhaven.com), CC0. 원본 나무는 잎만 수백만 삼각형이라, 빌드할 때 잎 카드를 골라 남기고 줄기를 단순화해 그루당 약 3만 삼각형으로 줄였습니다. 먼 나무는 같은 모델을 렌더링한 임포스터로 그립니다.
- **엔진**: [three.js](https://threejs.org), MIT
- **직접 만든 것**: 맵 생성, 건물, KR-9 소총과 VX-45 SMG 모델, 수송기, 낙하산, UI, 사운드. 실사 무료 모델을 구할 수 없어서 이 항목들은 코드로 만들었습니다.
