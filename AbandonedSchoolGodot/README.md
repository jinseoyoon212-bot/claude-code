# 폐교 탈출 (Godot 4.3 버전)

Windows exe로 바로 배포할 수 있는 Godot 4.3 버전입니다. 게임 내용은 Unity 버전(`../AbandonedSchool`)과 같습니다.

- 에셋: [Poly Haven](https://polyhaven.com) CC0 3D 모델 46종 + PBR 텍스처 9종 (출처: `CREDITS.md`)
- 렌더러: GL Compatibility (구형 GPU에서도 실행)
- 실행: Godot 4.3 에디터로 이 폴더를 열고 F5
- exe 내보내기: `godot --headless --export-release "Windows Desktop" ../dist/AbandonedSchool.exe`
  (Export Templates 4.3 설치 필요)
- 조작: WASD 이동 · 마우스 시점 · Shift 달리기 · E 상호작용 · F 손전등 · B 건전지 · R 재시작
- 목표: 손전등 → 사물함(칠판의 졸업 연도) → 과학실 열쇠 → 약품장의 교무실 열쇠(귀신 각성) → 서랍의 정문 열쇠 → 정문 탈출

## 구성
- `main.gd`: 레벨 생성(모델 배치, 재질), 플레이어, 귀신 AI, UI, 합성 사운드, 공포 연출(비네트/그레인)
- `assets/models`, `assets/textures`: CC0 에셋 (모델 텍스처는 512px로 축소)
