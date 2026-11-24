// Aurora 웹사이트 빌드 → aurora-site/public (Cloudflare Pages 출력 폴더)
// 기기 조작 기능(폰/PC 제어, 어시스턴트 오버레이, 접근성, Shizuku)은 포함하지 않는다.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const root = __dirname, agent = path.join(root, '..', 'aurora-agent', 'src'), out = path.join(root, 'public');
const LIMIT = 25 * 1024 * 1024;               // Cloudflare Pages: 파일 하나당 최대 25 MiB
const read = (p) => fs.readFileSync(p, 'utf8');
const hash = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 10);

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'assets'), { recursive: true });

// 기기 조작용(안드로이드 네이티브/Shizuku 등) 코드는 웹 번들에서 걷어내고 안전한 대체 코드로 바꾼다
const STUBS = {
  dev: 'const dev = () => null;',
  wire: 'function wire() {}',
  recordNative: 'async function recordNative() { return { skip: true }; }',
  native: 'async function ensureMic() { return true; }\n  async function nativeFallback() { throw new Error("음성 인식을 쓸 수 없어요."); }',
};
const strip = (src) => src.replace(/\/\*NATIVE:BEGIN (\w+)\*\/[\s\S]*?\/\*NATIVE:END\*\//g, (_, k) => { if (!(k in STUBS)) throw new Error('알 수 없는 NATIVE 블록: ' + k); return STUBS[k]; })
                           .replace(/^const toolLabel = \{.*\};$/m, 'const toolLabel = {};');
// 스크립트: 한 파일로 합친다 (요청 수 감소). 순서가 중요: llm → voice → fx → site-api → face → renderer
const parts = [path.join(agent, 'llm.js'), path.join(agent, 'voice.js'), path.join(agent, 'fx.js'), path.join(root, 'src', 'site-api.js'), path.join(agent, 'face.js'), path.join(agent, 'renderer.js')];
const js = '/* Aurora web — 기기 조작 기능 없음 */\n' + parts.map((p) => `/* ${path.basename(p)} */\n${strip(read(p))}`).join('\n;\n');
const css = read(path.join(agent, 'style.css'));
const jsName = `assets/app.${hash(js)}.js`, cssName = `assets/style.${hash(css)}.css`;
try { new (require('vm').Script)(js, { filename: 'app.js' }); } catch (e) { console.error('❌ 번들 JavaScript 문법 오류:', e.message); process.exit(1); }   // 깨진 번들이 배포되지 않게
fs.writeFileSync(path.join(out, jsName), js); fs.writeFileSync(path.join(out, cssName), css);

fs.writeFileSync(path.join(out, 'index.html'), read(path.join(root, 'src', 'index.html')).replace('{{APP_JS}}', '/' + jsName).replace('{{APP_CSS}}', '/' + cssName));
for (const f of ['favicon.svg', 'manifest.webmanifest', 'robots.txt', '_headers']) fs.copyFileSync(path.join(root, 'src', f), path.join(out, f));

// 크기 검사: 25MiB를 넘는 파일이 있으면 배포가 거부되므로 여기서 실패시킨다
const files = []; (function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); e.isDirectory() ? walk(p) : files.push(p); } })(out);
let total = 0, big = [];
for (const f of files) { const n = fs.statSync(f).size; total += n; if (n > LIMIT) big.push([path.relative(out, f), n]); }
files.sort((a, b) => fs.statSync(b).size - fs.statSync(a).size).forEach((f) => console.log(String(fs.statSync(f).size).padStart(8) + ' B  ' + path.relative(out, f)));
console.log(`총 ${files.length}개 파일, ${(total / 1024).toFixed(1)} KB (파일당 한도 25 MiB = ${LIMIT} B)`);
if (big.length) { console.error('❌ 25MiB 초과 파일:', big); process.exit(1); }
console.log('✅ 모든 파일이 25MiB 이하');
