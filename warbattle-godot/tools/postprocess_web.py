#!/usr/bin/env python3
"""Split large Godot web export files into <24 MB parts for Cloudflare Pages (25 MiB per-file limit).

The page gets a small fetch() wrapper that downloads the parts, joins them and hands Godot a
normal Response, so the engine loads index.wasm / index.pck exactly as if they were whole.
Usage: python3 tools/postprocess_web.py build/web
"""
import json, os, sys

LIMIT = 24 * 1024 * 1024
out = sys.argv[1] if len(sys.argv) > 1 else "build/web"
types = {".wasm": "application/wasm", ".pck": "application/octet-stream", ".js": "text/javascript"}
manifest = {}
for name in sorted(os.listdir(out)):
    path = os.path.join(out, name)
    if not os.path.isfile(path) or ".part" in name or name.endswith(".html"):
        continue
    size = os.path.getsize(path)
    if size <= LIMIT:
        continue
    with open(path, "rb") as f:
        data = f.read()
    n = (size + LIMIT - 1) // LIMIT
    for i in range(n):
        with open(f"{path}.part{i}", "wb") as f:
            f.write(data[i * LIMIT:(i + 1) * LIMIT])
    os.remove(path)
    manifest[name] = {"n": n, "size": size, "type": types.get(os.path.splitext(name)[1], "application/octet-stream")}
    print(f"split {name}: {size / 1e6:.1f} MB -> {n} parts")

loader = """<script>
// Reassemble files that were split for static hosting limits.
(function () {
  var parts = %s;
  var orig = window.fetch.bind(window);
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || String(input);
    var clean = url.split('?')[0].split('#')[0];
    var name = clean.substring(clean.lastIndexOf('/') + 1);
    var p = parts[name];
    if (!p) return orig(input, init);
    var jobs = [];
    for (var i = 0; i < p.n; i++) {
      jobs.push(orig(clean + '.part' + i).then(function (r) {
        if (!r.ok) throw new Error('Could not download ' + r.url + ' (' + r.status + ')');
        return r.arrayBuffer();
      }));
    }
    return Promise.all(jobs).then(function (bufs) {
      return new Response(new Blob(bufs, { type: p.type }), { status: 200, headers: { 'Content-Type': p.type, 'Content-Length': String(p.size) } });
    });
  };
})();
</script>
""" % json.dumps(manifest)

html_path = os.path.join(out, "index.html")
html = open(html_path, encoding="utf-8").read()
if "Reassemble files that were split" not in html:
    html = html.replace("<head>", "<head>\n" + loader, 1)
    open(html_path, "w", encoding="utf-8").write(html)
# Cloudflare Pages: cache the big immutable parts, never cache the page itself
with open(os.path.join(out, "_headers"), "w") as f:
    f.write("/*.part*\n  Cache-Control: public, max-age=86400\n  Content-Type: application/octet-stream\n/index.html\n  Cache-Control: no-cache\n")
print("manifest", json.dumps(manifest))
