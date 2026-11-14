#!/usr/bin/env python3
"""웹 빌드를 배포용 폴더로 패키징한다.

Cloudflare는 파일 하나를 25MiB까지만 받으므로 index.wasm(약 35MB)을 조각으로 나눈다.
브라우저에서는 export_presets.cfg의 head_include 스크립트가 index.wasm 요청을
조각 요청으로 바꿔 이어 붙인 응답을 돌려준다.

사용:  python3 tools/package_web.py build/web build/web_deploy
"""
import math
import os
import shutil
import sys

CHUNKS = 4  # head_include 스크립트의 N 과 같아야 한다

src, dst = sys.argv[1], sys.argv[2]
if os.path.exists(dst):
    shutil.rmtree(dst)
shutil.copytree(src, dst)

wasm = os.path.join(dst, "index.wasm")
data = open(wasm, "rb").read()
size = math.ceil(len(data) / CHUNKS)
for i in range(CHUNKS):
    part = data[i * size:(i + 1) * size]
    open(os.path.join(dst, f"index.part{i}.wasm"), "wb").write(part)
    print(f"index.part{i}.wasm  {len(part) / 1048576:.1f} MiB")

open(os.path.join(dst, ".nojekyll"), "w").close()
# Cloudflare(Workers Builds)에 올리지 않을 파일: 원본 wasm(25MiB 초과)과 설정 파일들
open(os.path.join(dst, ".assetsignore"), "w").write("index.wasm\nwrangler.jsonc\n.assetsignore\n.nojekyll\n.git\nREADME.md\n")
open(os.path.join(dst, "wrangler.jsonc"), "w").write("""{
  "name": "claude-code",
  "compatibility_date": "2025-01-01",
  "assets": { "directory": "./" }
}
""")
big = [f for f in os.listdir(dst) if os.path.getsize(os.path.join(dst, f)) > 25 * 1048576 and f != "index.wasm"]
print("25MiB 초과(업로드 대상):", big or "없음")
