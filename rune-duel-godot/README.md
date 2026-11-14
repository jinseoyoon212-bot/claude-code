# 달빛 마법학교 룬 결투 (Godot 4.3)

룬(방향) 입력으로 성벽을 지키는 아케이드 게임. 그래픽은 전부 `main.gd`의 `_draw()`에서 도형으로 그린다.

## 조작
- 방향키 / WASD / 화면 하단 버튼: 룬 입력
- 스페이스 / 결계 폭발 버튼: 마력 100%일 때 화면 정리
- P / 일시정지 버튼: 일시정지

## 빌드
```bash
godot --headless --path . --import
godot --headless --path . --export-release "Windows Desktop" build/RuneDuel.exe
# Android: 에디터 설정에 Android SDK/JDK 경로 지정 후
GODOT_ANDROID_KEYSTORE_RELEASE_PATH=... GODOT_ANDROID_KEYSTORE_RELEASE_USER=... GODOT_ANDROID_KEYSTORE_RELEASE_PASSWORD=... \
godot --headless --path . --export-release "Android" build/RuneDuel.apk
```

폰트: Noto Sans KR, Gowun Batang (SIL Open Font License, `fonts/OFL.txt`).
