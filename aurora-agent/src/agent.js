const LLM = require('./llm');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { exec } = require('child_process');

const MOODS = ['neutral', 'happy', 'sad', 'angry', 'surprised', 'thinking', 'sleepy', 'love', 'laugh'];

const SYSTEM = () => `당신은 "오로라"라는 귀여운 AI 에이전트입니다. 사용자의 컴퓨터(${os.platform()}, 홈: ${os.homedir()}, 현재 시각: ${new Date().toLocaleString()})에서 직접 동작합니다.
규칙:
1. 단순한 질문·대화는 도구 없이 짧고 명확하게 바로 답합니다.
2. 파일 읽기/쓰기/탐색, 프로그램 실행, 시스템 정보 확인 같은 작업이 필요할 때만 도구를 씁니다.
3. 항상 한국어로, 친근하지만 간결하게 답합니다.
4. 모든 답변의 맨 첫 줄에 현재 기분 태그를 하나 붙입니다: [기분:${MOODS.join('|')}]. 예: "[기분:happy] 안녕하세요!"
5. 작업 후에는 무엇을 했는지 한두 문장으로 요약합니다.`;

const TOOLS = [
  { name: 'run_command', description: '컴퓨터에서 셸 명령을 실행하고 출력(stdout/stderr)을 반환한다. Windows는 cmd/PowerShell, 그 외는 sh.', input_schema: { type: 'object', properties: { command: { type: 'string' }, cwd: { type: 'string', description: '작업 폴더(선택)' } }, required: ['command'] } },
  { name: 'read_file', description: '텍스트 파일 내용을 읽는다.', input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
  { name: 'write_file', description: '파일을 만들거나 전체 내용을 덮어쓴다. 상위 폴더는 자동 생성.', input_schema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } },
  { name: 'list_dir', description: '폴더의 파일/폴더 목록을 반환한다.', input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
  { name: 'system_info', description: 'OS, CPU, 메모리, 사용자, 호스트 정보를 반환한다.', input_schema: { type: 'object', properties: {} } },
];

const clip = (s, n = 20000) => (s.length > n ? s.slice(0, n) + `\n...[${s.length - n}자 생략]` : s);
const resolve = (p) => path.resolve(p.replace(/^~(?=$|[\\/])/, os.homedir()));

async function runTool(name, input, confirm) {
  switch (name) {
    case 'run_command': {
      if (!(await confirm('명령 실행', input.command))) return '사용자가 실행을 거부했습니다.';
      return new Promise((res) => exec(input.command, { cwd: input.cwd ? resolve(input.cwd) : os.homedir(), timeout: 120000, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
        res(clip(`${stdout || ''}${stderr ? '\n[stderr]\n' + stderr : ''}${err ? '\n[오류] ' + err.message : ''}`.trim() || '(출력 없음)'));
      }));
    }
    case 'read_file': return clip(fs.readFileSync(resolve(input.path), 'utf8'));
    case 'write_file': {
      const p = resolve(input.path);
      if (!(await confirm('파일 쓰기', `${p}\n\n${input.content.slice(0, 600)}`))) return '사용자가 쓰기를 거부했습니다.';
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, input.content);
      return `저장 완료: ${p}`;
    }
    case 'list_dir': return fs.readdirSync(resolve(input.path), { withFileTypes: true }).map((d) => (d.isDirectory() ? d.name + '/' : d.name)).join('\n') || '(비어 있음)';
    case 'system_info': return JSON.stringify({ platform: os.platform(), release: os.release(), arch: os.arch(), cpus: os.cpus().length, totalMemGB: +(os.totalmem() / 2 ** 30).toFixed(1), freeMemGB: +(os.freemem() / 2 ** 30).toFixed(1), user: os.userInfo().username, host: os.hostname(), home: os.homedir() }, null, 2);
    default: return '알 수 없는 도구';
  }
}

async function runAgent({ settings, history, confirm, notify }) {
  const messages = history.map((m) => ({ role: m.role, content: m.content }));
  for (let i = 0; i < 25; i++) {
    const r = await LLM.call({ provider: settings.provider, apiKey: settings.apiKey, model: settings.model, baseUrl: settings.baseUrl, system: SYSTEM(), tools: TOOLS, messages, onWait: (s) => notify({ type: 'wait', seconds: s }) });
    messages.push({ role: 'assistant', content: r.content });
    if (r.stop_reason !== 'tool_use') {
      let text = r.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
      let mood = 'neutral';
      const m = text.match(/^\s*\[기분:([a-z]+)\]\s*/);
      if (m) { if (MOODS.includes(m[1])) mood = m[1]; text = text.slice(m[0].length); }
      return { text, mood };
    }
    const results = [];
    for (const b of r.content.filter((x) => x.type === 'tool_use')) {
      notify({ type: 'tool', name: b.name, input: b.input });
      let out;
      try { out = await runTool(b.name, b.input, confirm); } catch (e) { out = '오류: ' + e.message; }
      results.push({ type: 'tool_result', tool_use_id: b.id, content: out });
    }
    messages.push({ role: 'user', content: results });
  }
  return { text: '작업이 너무 길어져서 여기서 멈췄어요. 이어서 말씀해 주세요.', mood: 'surprised' };
}

module.exports = { runAgent };
