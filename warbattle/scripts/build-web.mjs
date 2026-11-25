// Builds a standalone web bundle in dist/web (full HTML document, all assets local).
// Used for the desktop (.exe) and Android (.apk) packages and for self-hosting.
import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist', 'web');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const body = readFileSync(join(root, 'index.html'), 'utf8');
const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no">
<meta name="theme-color" content="#0e100d">
</head>
<body>
${body}
</body>
</html>
`;
writeFileSync(join(out, 'index.html'), html);
for (const d of ['src', 'vendor']) cpSync(join(root, d), join(out, d), { recursive: true });
cpSync(join(root, 'assets', 'tex'), join(out, 'assets', 'tex'), { recursive: true });
// Binary formats (.glb models, .hdr sky) ship as base64 inside .json so every host serves them,
// including static hosts that only allow common web file types.
const pack = (src, dst) => { mkdirSync(dirname(dst), { recursive: true }); writeFileSync(dst, JSON.stringify({ b64: readFileSync(src).toString('base64') })); };
for (const f of readdirSync(join(root, 'assets', 'models'))) if (f.endsWith('.glb')) pack(join(root, 'assets', 'models', f), join(out, 'assets', 'models', f.replace(/\.glb$/, '.json')));
pack(join(root, 'assets', 'hdri', 'sky.hdr'), join(out, 'assets', 'hdri', 'sky.json'));
console.log('Built', out);
