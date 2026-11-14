// 창 없이 브리지 서버만 실행: AURORA_API_KEY=... node src/server-cli.js
const os = require('os'), path = require('path'), crypto = require('crypto');
const { createBridge } = require('./server');
const token = process.env.AURORA_TOKEN || crypto.randomBytes(16).toString('hex');
const port = +process.env.AURORA_PORT || 8765;
const settings = { provider: process.env.AURORA_PROVIDER || 'anthropic', apiKey: process.env.AURORA_API_KEY || '', model: process.env.AURORA_MODEL || 'claude-sonnet-5-5', autoApprove: process.env.AURORA_AUTO_APPROVE === '1' };
createBridge({ getSettings: () => settings, wwwDir: path.join(__dirname, 'www'), token }).start(port).then(() => {
  console.log('Aurora 브리지 실행 중');
  for (const l of Object.values(os.networkInterfaces()).flat()) if (l && l.family === 'IPv4' && !l.internal) console.log(`  http://${l.address}:${port}/?token=${token}`);
  console.log(`  http://127.0.0.1:${port}/?token=${token}`);
}).catch((e) => { console.error('시작 실패:', e.message); process.exit(1); });
