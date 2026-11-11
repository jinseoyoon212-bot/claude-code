# 폐교 탈출 (Abandoned School Escape)

Unity 2022.3 LTS 기반 1인칭 공포 탈출 게임입니다. 외부 에셋 없이 코드와 기본 도형만으로 만들어져 있어서 **프로젝트를 열면 바로 플레이**할 수 있습니다.

## 실행 방법

1. Unity Hub → **Add project from disk** → 이 `AbandonedSchool` 폴더 선택 (Unity 2022.3 LTS 이상, 3D Built-in 렌더 파이프라인)
2. 프로젝트가 열리면 `Assets/Scenes/AbandonedSchool.unity` 씬이 **자동 생성**됩니다.
   - 자동 생성이 안 되면 메뉴 **Tools → 폐교 탈출 → 씬 생성 (Build Scene)** 을 실행하세요.
3. ▶ Play 버튼을 누르면 시작됩니다.
4. 실행 파일이 필요하면 **Tools → 폐교 탈출 → Windows 빌드** (결과: `Builds/AbandonedSchool/`)

> 한글 UI는 OS에 설치된 폰트(맑은 고딕, Apple SD Gothic Neo, Noto Sans CJK KR 등)를 사용합니다.
> Input Handling은 기본값(Input Manager)을 사용합니다. Unity 6 등에서 Input System 전용으로 되어 있으면
> `Project Settings → Player → Active Input Handling`을 **Both**로 바꿔 주세요.

## 조작

| 키 | 동작 |
|---|---|
| WASD / 마우스 | 이동 / 시점 |
| Shift | 달리기 (스태미나 5초) |
| E | 상호작용 (줍기, 문, 쪽지, 서랍) |
| F | 손전등 켜기/끄기 |
| B | 손전등 건전지 교체 |
| Esc | 쪽지/자물쇠 닫기 |
| R | (게임 오버/클리어 후) 다시 시작 |

## 게임 흐름

```
교실 ─ 손전등 획득 → 쪽지 + 칠판으로 사물함 번호 추리 → 과학실 열쇠
과학실 ─ 약품장에서 교무실 열쇠 (⚠ 이때 복도의 귀신이 깨어남)
교무실 ─ 교장 책상 서랍에서 정문 열쇠
복도 끝 정문 ─ 문을 열고 밖으로 나가면 탈출!
```

### 귀신 AI
- 열쇠(교무실 열쇠)를 얻는 순간 복도를 순찰하기 시작합니다.
- **손전등을 켜거나 달리면** 더 멀리서 발견당합니다 (손전등 ON 14m / OFF 5m, 달리면 +4m).
- 벽/닫힌 문 뒤로 시선이 끊기고 4초가 지나면 추격을 포기합니다.
- 가까이 오면 심장 박동 소리가 커집니다. 잡히면 게임 오버.

## 구조

```
Assets/
├─ Scripts/
│  ├─ GameManager.cs      상태, 인벤토리, 메시지
│  ├─ PlayerController.cs 이동/시점/상호작용/스태미나
│  ├─ Flashlight.cs       손전등 + 배터리
│  ├─ Interactable.cs     상호작용 기반 클래스
│  ├─ PickupItem.cs / NoteItem.cs / Door.cs / LootContainer.cs
│  ├─ GhostAI.cs          순찰/추격 귀신
│  ├─ LightFlicker.cs     깜빡이는 조명
│  ├─ AtmosphereAudio.cs  코드로 생성한 환경음/심장 박동
│  ├─ ExitZone.cs         탈출 판정
│  └─ GameHud.cs          IMGUI HUD
└─ Editor/
   └─ SchoolSceneBuilder.cs  씬 자동 생성 (건물, 퍼즐, 귀신 배치)
```

## 커스터마이징

- 퍼즐 번호/아이템/문 설정은 `SchoolSceneBuilder.cs`에서 바꾸고 **씬 생성**을 다시 실행하면 됩니다.
  (사물함 번호: `loot.code = "1993"` ↔ 칠판 `GRADUATION\n1993.02.17`)
- 귀신 속도/시야는 `GhostAI` 인스펙터 값으로 조절합니다.
- 더 좋은 분위기를 원하면 폐교/학교 에셋 팩으로 `Box(...)` 호출 부분을 프리팹 배치로 교체하세요.
