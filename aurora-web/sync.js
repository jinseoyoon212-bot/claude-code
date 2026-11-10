// aurora-agent/src 의 얼굴·UI 코드를 웹용으로 변환해 aurora-web/www 와 aurora-agent/src/www(브리지가 서빙) 에 복사
const fs = require('fs'), path = require('path');
const src = path.join(__dirname, '..', 'aurora-agent', 'src');
let html = fs.readFileSync(path.join(src, 'index.html'), 'utf8');
html = html
  .replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, `<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#0b0b1a"><meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self' 'unsafe-inline'; connect-src *">`)
  .replace('<script src="face.js">', '<script src="web-api.js"></script><script src="face.js">')
  .replace('</head>', '<style>[data-only=desktop]{display:none!important}[data-only=web]{display:block!important}html,body{height:100dvh}#form{padding-bottom:calc(12px + env(safe-area-inset-bottom))}#gear{top:calc(10px + env(safe-area-inset-top))}</style></head>');
for (const out of [path.join(__dirname, 'www'), path.join(src, 'www')]) {
  fs.mkdirSync(out, { recursive: true });
  for (const f of ['style.css', 'face.js', 'renderer.js']) fs.copyFileSync(path.join(src, f), path.join(out, f));
  fs.copyFileSync(path.join(__dirname, 'web-api.js'), path.join(out, 'web-api.js'));
  fs.writeFileSync(path.join(out, 'index.html'), html);
  console.log('synced ->', out);
}
