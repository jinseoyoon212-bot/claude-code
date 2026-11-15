# 빛과 어둠의 마법 전쟁 (Godot 4.3, 3D)

대마법사가 되어 빛의 기사단과 함께 해골 군단을 막는 3D 액션 디펜스 게임.

## 콘텐츠
- **인트로 시네마틱**: 해골 군단 진격 → 빛의 군단 앞에서 대치 → 대마법사와 어둠의 군주가 도약해 공중에서 무기 충돌 → 타이틀 (터치/키로 건너뛰기)
- **스테이지 5개 + 끝없는 밤**: 스테이지마다 다른 환경(낮·달밤·불·얼음·어둠)과 보스
  - 해골 장군 그림클로 / 망령왕 베일 / 그림자 암살자 녹스 / 서리 거인 하임 / 어둠의 군주 모르가스
  - 보스는 체력 40% 이하에서 분노(빨라짐·패턴 강화)
  - 별 3개 평가(수정 체력 기준), 첫 클리어 보상
- **적 5종 + 정예 변이**, **아군 4종**(대마법사·기사·견습 마법사·궁수)
- **상점**: 강화 6종, 스킬 7종(레벨 5), 물약 3종
- **업적 12개**(골드 보상), **설정**(음량·그림자·피해 숫자·화면 흔들림·인트로 다시 보기·초기화)
- **개발자 치트 메뉴**: 타이틀의 [개발자] 버튼 또는 로고 5번 연타 → 비밀번호 입력 (`save.gd`의 `DEV_PASSWORD`)

## 웹 버전
- 주소: https://jinseoyoon212-bot.github.io/claude-code/ (`gh-pages` 브랜치)
- 기기를 자동 인식: 휴대폰·태블릿은 터치 버튼과 조이스틱, PC는 화면 아래 단축키 바만 표시
- 터치 노트북처럼 둘 다 되는 기기는 실제로 손가락을 쓰면 터치 UI, 키보드를 누르면 단축키 바로 바뀜
- 휴대폰을 세로로 들면 "가로로 돌려주세요" 안내와 함께 자동 일시정지
- 웹 빌드·배포:
  ```bash
  godot --headless --path . --export-release "Web" build/web/index.html
  python3 tools/package_web.py build/web build/web_deploy   # wasm을 4조각으로 분할 + wrangler 설정 생성
  # build/web_deploy 안의 파일을 gh-pages 브랜치 루트에 올린다
  ```
- 엔진 파일(`index.wasm`, 약 35MB)은 Cloudflare의 파일당 25MiB 제한 때문에 4조각(`index.partN.wasm`)으로 나눠 올린다. 확장자를 `.wasm`으로 둔 것은 호스팅이 압축해서 보내게 하려는 것(`.bin`은 압축되지 않아 전송량이 5배가 됨).
  브라우저에서는 `export_presets.cfg`의 `head_include` 스크립트가 `index.wasm` 요청을 조각 요청으로 바꿔 이어 붙인다.
  (`.assetsignore`가 원본 `index.wasm`을 Cloudflare 업로드에서 제외)
- **멀티스레드 웹 빌드**(`Web Threads` 프리셋, `build/web_mt`): 소리를 별도 스레드에서 처리해 화면이 밀려도 소리가 끊기지 않게 한다.
  `python3 tools/package_web.py build/web_mt build/web_mt_deploy --isolate`로 패키징하면 교차 출처 격리 헤더(`_headers`)가 같이 생성된다.
  헤더를 줄 수 없는 호스팅(GitHub Pages 등)에서는 실행되지 않으므로 Cloudflare Pages(`cf-pages` 브랜치)에만 올리고,
  Netlify·Workers(`gh-pages` 브랜치)는 기존 단일 스레드 빌드를 유지한다.
- Cloudflare Workers Builds: Production branch=`gh-pages`, Build command 비움, Deploy command=`npx wrangler deploy`

## 개발자 전용 스킬: 아스트라 유디키움
- 개발자 모드(비밀번호)를 켠 뒤에만 쓸 수 있다. 전투 화면에 별빛 아이콘 버튼(T 키)이 나타나고, 치트 메뉴(전투 중)에서도 발동할 수 있다.
- 컷씬: 주인공이 지팡이를 들고 → 지팡이에서 **빛줄기가 하늘로 솟아** → 닿은 하늘이 갈라지며 **거대한 두 겹의 마법진**이 열리고(번개) →
  마법진에서 **유성(별)이 잇달아 쏟아져** 적이 있는 곳마다 한 발씩 정화하고(적마다 9999 피해) → 마지막에 **하늘에서 거대한 빛기둥**이 전장 한가운데로 내리꽂혀 남은 적을 모두 쓸어낸 뒤 금빛 가루가 하늘로 오른다.
- 대기시간 30초. 컷씬 중에는 입력이 막히고(무적), 아무 키/터치로 건너뛸 수 있다 (피해는 그대로 들어간다).
- 구현: `judge.gd` (연출·타임라인·카메라), `shaders/star_beam.gdshader`(빛줄기·빛기둥), `shaders/fire_ribbon.gdshader`(유성 꼬리·번개 튜브), `shaders/magic_circle.gdshader`(마법진), 효과음은 `tools/gen_audio.py judge`.

## 조작
| PC | 모바일 | 동작 |
|---|---|---|
| WASD / 방향키 | 왼쪽 화면 드래그 | 이동 |
| Space / 클릭 유지 | 공격 버튼 | 공격 (자동 조준, 15% 치명타) |
| Shift | 대시 버튼 | 순간 돌진 (무적) |
| Q E R F | 스킬 버튼 | 장착 스킬 4개 |
| 1 2 3 | 물약 버튼 | 치유 · 마력 · 수정의 정수 |
| Esc / P | 일시정지 버튼 | 일시정지 메뉴 |

## 구조
- `main.gd` 전장·스테이지 환경·인트로·웨이브·영웅·스킬·투사체·카메라
- `unit.gd` 모든 유닛의 AI, 애니메이션, 보스 패턴, 정예
- `ui_base.gd` UI 그리기 도우미 / `hud.gd` 전투 UI / `menu.gd` 모든 메뉴 화면
- `save.gd` (자동 로드 `Save`) 저장·상점·스테이지·업적·치트 데이터
- `audio.gd` (자동 로드 `Sfx`) 효과음·배경음악
- `tools/gen_audio.py` 효과음 23종(ogg)과 배경음악 3곡(wav)을 합성하는 스크립트 (`python3 tools/gen_audio.py`, 음악만: `python3 tools/gen_audio.py music`)
  - 음악은 WAV(IMA-ADPCM)이고, 반복은 엔진 반복을 끄고 `audio.gd`가 곡 끝 직전에 같은 곡을 박자 단위로 겹쳐 시작하는 방식이다.
    엔진 자체 반복은 되돌아가는 순간 소리가 잠깐 비고(게임이 바쁘면 0.1~0.3초), 웹에서는 `get_playback_position()`이 항상 0이라 위치를 실제 시계로 잰다.

## 에셋 출처
- 캐릭터·무기 3D 모델: KayKit Adventurers / Skeletons by Kay Lousberg — CC0 (`models/LICENSE-*.txt`)
- 배경·건물·나무·수정 등 모든 환경 모델: KayKit Medieval Hexagon / Halloween Bits / Dungeon Remastered, OpenGameArt LowPoly Crystals — 모두 CC0 (`models/env/SOURCES.md`)
- 아이콘: game-icons.net — CC BY 3.0 (`icons/CREDITS.txt`)
- 음악·효과음: 직접 합성 (`tools/gen_audio.py`)
- 폰트: Noto Sans KR, Gowun Batang — SIL OFL (`fonts/OFL.txt`), 완성형 한글 2350자 + 게임 텍스트로 서브셋
