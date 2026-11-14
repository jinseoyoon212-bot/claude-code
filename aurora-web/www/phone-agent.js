// 폰 자체를 제어하는 에이전트 루프 (APK 안에서 실행). Anthropic API + 네이티브 AuroraDevice 플러그인
(() => {
  const MOODS = ['neutral', 'happy', 'sad', 'angry', 'surprised', 'thinking', 'sleepy', 'love', 'laugh'];
  const dev = () => window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.AuroraDevice;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clip = (s, n = 20000) => (s.length > n ? s.slice(0, n) + `\n...[${s.length - n}자 생략]` : s);

  const SYSTEM = (screen) => `당신은 "오로라"라는 귀여운 AI 에이전트이고, 지금 사용자의 안드로이드 폰 안에서 직접 동작합니다.
규칙:
1. 단순한 질문·대화는 도구 없이 짧게 바로 답합니다. 폰 조작이 필요할 때만 도구를 씁니다.
2. 한국어로 친근하고 간결하게 답합니다. 모든 답변의 맨 첫 줄에 기분 태그: [기분:${MOODS.join('|')}]
3. 파일: 공유 저장소는 /sdcard (다운로드 /sdcard/Download, 사진 /sdcard/DCIM, 문서 /sdcard/Documents). 권한 오류가 나면 request_all_files_access를 호출해 사용자가 허용하게 안내합니다.
4. run_command는 안드로이드 sh(toybox)이고 앱 권한으로 실행됩니다. 루트가 아니므로 다른 앱의 내부 데이터(/data/data)와 시스템 영역은 못 만집니다. 이 한계는 솔직히 알려줍니다.
${screen ? `5. 앱 실행은 launch_app에 name(앱 이름)만 주면 한 번에 됩니다(list_apps 불필요). 이후 screen_read로 화면 확인 → screen_click_text / screen_tap / screen_type / screen_swipe → 필요할 때만 screen_read로 결과 확인. 좌표는 screen_read의 @x,y를 씁니다.
   속도가 중요합니다: 도구 호출 횟수를 최소화하고, 서로 독립적인 호출은 한 번에 여러 개 요청하세요.` : `5. 화면 직접 조작(탭·스와이프·화면 읽기)은 꺼져 있습니다. 화면을 눌러서 하는 방식은 쓰지 말고, 명령 한 번으로 끝나는 방식만 쓰세요: run_command, adb_command(Shizuku, 예: svc wifi enable, am start, pm list packages, settings put), launch_app(name=앱 이름), open_intent, 파일 도구. adb_command로도 input tap/swipe/uiautomator 같은 화면 조작은 하지 마세요. 명령으로 안 되는 일은 솔직히 안 된다고 알리고, 사용자가 원하면 설정에서 '화면 직접 조작'을 켜야 한다고 안내하세요.`}
${screen ? `6. 화면 조작이 "접근성 서비스 꺼짐"이면 사용자에게 설정의 [Shizuku로 접근성 켜기]를 안내하세요(Shizuku가 실행 중이면 접근성 없이도 화면 조작이 됩니다).
` : ''}7. 결제·송금·삭제·메시지 전송처럼 되돌리기 어려운 동작은 실행 전에 사용자에게 한 번 더 말로 확인합니다.
8. 작업을 마치면 무엇을 했는지 한두 문장으로 요약합니다.`;

  const S = (props, req = []) => ({ type: 'object', properties: props, required: req });
  const TOOLS = [
    { name: 'run_command', description: '폰에서 셸 명령 실행(앱 권한). stdout/stderr와 종료코드 반환.', input_schema: S({ command: { type: 'string' }, cwd: { type: 'string' } }, ['command']) },
    { name: 'read_file', description: '텍스트 파일 읽기', input_schema: S({ path: { type: 'string' } }, ['path']) },
    { name: 'write_file', description: '파일 생성/덮어쓰기(append=true면 이어쓰기). 상위 폴더 자동 생성.', input_schema: S({ path: { type: 'string' }, content: { type: 'string' }, append: { type: 'boolean' } }, ['path', 'content']) },
    { name: 'list_dir', description: '폴더 목록', input_schema: S({ path: { type: 'string' } }, ['path']) },
    { name: 'device_info', description: '기기 모델/안드로이드 버전/배터리/저장공간/화면크기/권한 상태', input_schema: S({}) },
    { name: 'list_apps', description: '설치된 앱 목록(이름=패키지). query로 이름 검색 가능. 앱 실행만 할 거면 불필요.', input_schema: S({ query: { type: 'string' } }) },
    { name: 'launch_app', description: '앱 실행. name(앱 이름, 예: 네이버) 또는 package 중 하나만 주면 됨.', input_schema: S({ name: { type: 'string' }, package: { type: 'string' } }) },
    { name: 'open_intent', description: '인텐트로 열기. 예: {uri:"https://..."}, {action:"android.intent.action.DIAL",uri:"tel:010..."}, {action:"android.settings.SETTINGS"}', input_schema: S({ action: { type: 'string' }, uri: { type: 'string' }, mimeType: { type: 'string' }, package: { type: 'string' } }) },
    { name: 'screen_read', description: '현재 화면의 글자/버튼/입력칸 목록(좌표 포함). 접근성 서비스 필요.', input_schema: S({}) },
    { name: 'screen_click_text', description: '화면에서 글자로 버튼을 찾아 클릭', input_schema: S({ text: { type: 'string' }, exact: { type: 'boolean' } }, ['text']) },
    { name: 'screen_tap', description: '화면 좌표 탭', input_schema: S({ x: { type: 'number' }, y: { type: 'number' } }, ['x', 'y']) },
    { name: 'screen_swipe', description: '스와이프/스크롤. 아래로 스크롤하려면 y1>y2', input_schema: S({ x1: { type: 'number' }, y1: { type: 'number' }, x2: { type: 'number' }, y2: { type: 'number' }, durationMs: { type: 'number' } }, ['x1', 'y1', 'x2', 'y2']) },
    { name: 'screen_type', description: '포커스된(없으면 첫 번째) 입력칸에 글자 입력', input_schema: S({ text: { type: 'string' } }, ['text']) },
    { name: 'screen_global', description: '전역 버튼: back, home, recents, notifications, quick_settings', input_schema: S({ action: { type: 'string', enum: ['back', 'home', 'recents', 'notifications', 'quick_settings'] } }, ['action']) },
    { name: 'adb_command', description: 'Shizuku(adb 권한)로 시스템 명령 실행. 예: input tap X Y, input swipe, input text, am start, pm list packages, settings put. Shizuku가 연결돼 있어야 함.', input_schema: S({ command: { type: 'string' } }, ['command']) },
    { name: 'wait', description: '잠시 대기(초, 최대 10)', input_schema: S({ seconds: { type: 'number' } }, ['seconds']) },
    { name: 'request_all_files_access', description: '모든 파일 접근 권한 설정 화면을 연다', input_schema: S({}) },
    { name: 'open_accessibility_settings', description: '접근성 설정 화면을 연다', input_schema: S({}) },
  ];
  const UI = new Set(['launch_app', 'open_intent', 'screen_click_text', 'screen_tap', 'screen_swipe', 'screen_type', 'screen_global']);
  const SHELL = new Set(['run_command', 'write_file', 'adb_command']);


  // ---- 접근성이 막힌 기기용: Shizuku(adb 권한)로 화면 읽기/탭/스와이프/입력 ----
  const sh = async (c) => ((await dev().shizukuShell({ command: c })).output || '').trim();
  const dec = (s) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#10;/g, ' ').replace(/&amp;/g, '&');
  function parseUi(raw) {
    const nodes = [];
    for (const line of raw.split('\n')) {
      const g = (k) => { const m = line.match(new RegExp('(?:^|[\\s<])' + k + '="([^"]*)"')); return m ? dec(m[1]) : ''; };
      const b = line.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/); if (!b) continue;
      const [l, t, r, bt] = b.slice(1).map(Number); if (r <= l || bt <= t) continue;
      nodes.push({ text: g('text'), desc: g('content-desc'), id: g('resource-id'), pkg: g('package'), click: g('clickable') === 'true', edit: /EditText/.test(g('class')), x: (l + r) >> 1, y: (t + bt) >> 1 });
    }
    return nodes;
  }
  async function uiDump() {
    const raw = await sh("uiautomator dump /data/local/tmp/au.xml >/dev/null 2>&1; cat /data/local/tmp/au.xml | sed 's/></>\\n</g' | grep 'bounds=' | grep -E ' text=\"[^\"]+\"| content-desc=\"[^\"]+\"| clickable=\"true\"| class=\"android.widget.EditText\"'");
    return parseUi(raw);
  }
  const keyOf = { back: 4, home: 3, recents: 187 };
  async function shzScreen(name, i) {
    switch (name) {
      case 'screen_read': {
        const n = await uiDump(); if (!n.length) return '화면 정보를 읽지 못했어요(보안 화면이거나 전환 중일 수 있어요). 잠시 후 다시 시도하세요.';
        return clip(`앱: ${n[0].pkg} (요소 ${n.length}개)\n` + n.slice(0, 120).map((e) => `${e.text || e.desc || e.id || '(이름없음)'}${e.click ? ' [클릭]' : ''}${e.edit ? ' [입력]' : ''} @${e.x},${e.y}`).join('\n'));
      }
      case 'screen_click_text': {
        const q = String(i.text).toLowerCase(), n = await uiDump(); const nm = (e) => (e.text || e.desc).toLowerCase();
        const hit = n.find((e) => nm(e) === q) || (i.exact ? null : n.find((e) => nm(e).includes(q)));
        if (!hit) return JSON.stringify({ ok: false, reason: '화면에서 못 찾았어요: ' + i.text });
        await sh(`input tap ${hit.x} ${hit.y}`); return JSON.stringify({ ok: true, tapped: hit.text || hit.desc });
      }
      case 'screen_tap': await sh(`input tap ${Math.round(i.x)} ${Math.round(i.y)}`); return '{"ok":true}';
      case 'screen_swipe': await sh(`input swipe ${Math.round(i.x1)} ${Math.round(i.y1)} ${Math.round(i.x2)} ${Math.round(i.y2)} ${Math.round(i.durationMs || 350)}`); return '{"ok":true}';
      case 'screen_global':
        if (keyOf[i.action]) await sh(`input keyevent ${keyOf[i.action]}`);
        else await sh(i.action === 'notifications' ? 'cmd statusbar expand-notifications' : 'cmd statusbar expand-settings');
        return '{"ok":true}';
      case 'screen_type': {
        try { await dev().setClipboard({ text: i.text }); await sh('input keyevent 279'); return '{"ok":true,"method":"paste"}'; }
        catch (e) {
          if (/^[\x20-\x7e]+$/.test(i.text)) { await sh(`input text '${i.text.replace(/'/g, '').replace(/ /g, '%s')}'`); return '{"ok":true,"method":"input"}'; }
          return '{"ok":false,"reason":"한글 입력은 클립보드 권한이 필요해요"}';
        }
      }
    }
  }


  // ---- 즉시 실행: 단순한 명령은 AI를 거치지 않고 바로 처리 (0초 대기) ----
  const TOGGLES = [
    [/와이파이|wi-?fi|와이 파이/i, 'Wi-Fi', (on) => `svc wifi ${on ? 'enable' : 'disable'}`],
    [/블루투스|bluetooth/i, '블루투스', (on) => `svc bluetooth ${on ? 'enable' : 'disable'}`],
    [/모바일 ?데이터|데이터 ?(통신|연결)?/, '모바일 데이터', (on) => `svc data ${on ? 'enable' : 'disable'}`],
    [/비행기 ?모드/, '비행기 모드', (on) => `cmd connectivity airplane-mode ${on ? 'enable' : 'disable'}`],
  ];
  const eulReul = (w) => { const c = w.charCodeAt(w.length - 1) - 0xac00; return (c >= 0 && c <= 11171 ? c % 28 !== 0 : /[013678]$/.test(w) || /[lmnrLMNR]$/.test(w)) ? '을' : '를'; };
  async function quickRoute(text, D, ask, notify) {
    const t = text.trim().replace(/\s+/g, ' ');
    if (t.length > 40 || /[?？]|있어|가능|할 수|될까|어떻게|왜|뭐|알려|설명/.test(t)) return null;   // 질문/복잡한 말은 AI에게
    const on = /(켜|켜줘|켜라|켜봐|활성|on\b)/i.test(t) ? true : /(꺼|꺼줘|꺼라|끄|끄기|비활성|off\b)/i.test(t) ? false : null;
    const run = async (cmd, shown) => {
      let s; try { s = await D.shizukuStatus(); } catch { s = {}; }
      if (!s.granted) return { text: 'Shizuku가 실행 중이어야 이 명령을 쓸 수 있어요. ⚙ 설정의 [Shizuku 상태]를 확인해 주세요.', mood: 'sad' };
      if (!(await ask('명령 실행', cmd))) return { text: '알겠어요, 실행하지 않았어요.', mood: 'neutral' };
      notify({ type: 'tool', name: 'adb_command', input: { command: cmd } });
      const out = (await D.shizukuShell({ command: cmd })).output || '';
      return /error|exception|denied|unknown/i.test(out) ? { text: `실행했는데 오류가 났어요: ${out.slice(0, 200)}`, mood: 'sad' } : { text: shown, mood: 'happy' };
    };
    for (const [re, label, cmd] of TOGGLES) if (re.test(t) && on !== null) return run(cmd(on), `${label}${eulReul(label)} ${on ? '켰' : '껐'}어요 ✅`);
    if (/(볼륨|소리).*(올려|높여|키워|크게)/.test(t)) return run('input keyevent 24', '볼륨을 올렸어요 🔊');
    if (/(볼륨|소리).*(내려|낮춰|줄여|작게)/.test(t)) return run('input keyevent 25', '볼륨을 내렸어요 🔉');
    if (/음소거|무음/.test(t)) return run('input keyevent 164', '음소거 했어요 🔇');
    if (/^(배터리|충전)/.test(t) || /배터리 (몇|잔량|상태)/.test(t)) { const d = await D.deviceInfo(); return { text: `배터리 ${d.batteryPercent}%예요 🔋`, mood: 'neutral' }; }
    if (/^(저장 ?공간|용량)/.test(t)) { const d = await D.deviceInfo(); return { text: `저장공간 ${d.storageFreeGB}GB 남았어요 (전체 ${d.storageTotalGB}GB)`, mood: 'neutral' }; }
    const m = t.match(/^(.{1,20}?)\s*(?:앱|어플|어플리케이션)?\s*(?:을|를)?\s*(?:좀\s*)?(?:열어|켜|실행|띄워|시작)/);
    if (m) {
      const name = m[1].replace(/(을|를)$/, '').trim(); if (!name) return null;
      const f = filterApps((await D.listApps()).apps, name); const q = name.toLowerCase();
      const hit = f.find((a) => a.name.toLowerCase() === q) || f[0]; if (!hit) return null;
      if (!(await ask('앱 실행', `${hit.name} (${hit.package})`))) return { text: '알겠어요, 실행하지 않았어요.', mood: 'neutral' };
      notify({ type: 'tool', name: 'launch_app', input: { name: hit.name } });
      await D.launchApp({ package: hit.package }); return { text: `${hit.name}${eulReul(hit.name)} 열었어요 📱`, mood: 'happy', stay: true };
    }
    return null;
  }

  const filterApps = (apps, q) => { q = String(q || '').toLowerCase(); return q ? apps.filter((a) => a.name.toLowerCase().includes(q) || a.package.toLowerCase().includes(q)) : apps; };

  async function runPhoneAgent({ settings, history, notify }) {
    const D = dev();
    if (!D) return { error: '이 기능은 Aurora Agent APK 앱 안에서만 쓸 수 있어요.' };
    if (LLM.needsKey(settings.provider) && !settings.apiKey) return { error: 'API 키가 없어요. ⚙ 설정에서 AI 제공자와 API 키를 입력해 주세요.' };
    const messages = history.map((m) => ({ role: m.role, content: m.content }));
    const lastUser = String(history[history.length - 1].content).slice(0, 200);
    let uiGranted = !!settings.phoneAuto, uiUsed = false;
    const quickAsk = async (title, detail) => settings.phoneAuto ? true : window.confirm(title + '\n\n' + detail + '\n\n허용할까요?');
    try { const q = await quickRoute(String(history[history.length - 1].content), D, quickAsk, notify); if (q) return q; } catch (e) { /* 실패하면 AI에게 맡김 */ }

    const front = async () => { if (uiUsed && ctrl !== 'none') { await comeBack(); await sleep(700); } };
    const ask = async (title, detail) => { if (settings.phoneAuto) return true; await front(); return window.confirm(title + '\n\n' + detail + '\n\n허용할까요?'); };

    const toolList = TOOLS.filter((t) => settings.screenControl || !(t.name.startsWith('screen_') || t.name === 'open_accessibility_settings'));
    let ctrl = null;
    async function controlMode() {
      if (ctrl) return ctrl;
      try { if ((await D.a11yDiagnose()).connected) return (ctrl = 'a11y'); } catch {}
      try { if ((await D.shizukuStatus()).granted) return (ctrl = 'shizuku'); } catch {}
      return null;
    }
    const comeBack = async () => { try { await D.bringToFront(); } catch {} if (ctrl === 'shizuku') { try { await sh('monkey -p com.aurora.agent -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1'); } catch {} } };

    async function tool(name, i) {
      if (SHELL.has(name) && !(await ask(name === 'write_file' ? '파일 쓰기' : '명령 실행', name !== 'write_file' ? i.command : i.path + '\n\n' + String(i.content).slice(0, 500)))) return '사용자가 거부했습니다.';
      if (UI.has(name) && !uiGranted) {
        if (!(await ask('앱·화면 조작 허용', `이번 요청 동안 앱을 열고 화면을 탭/입력하는 것을 허용할까요?\n\n요청: ${lastUser}`))) return '사용자가 앱·화면 조작을 거부했습니다.';
        uiGranted = true;
      }
      if (UI.has(name)) uiUsed = true;
      const j = (o) => clip(JSON.stringify(o));
      if (name.startsWith('screen_') && !settings.screenControl) return '화면 직접 조작은 꺼져 있어요. 명령(run_command/adb_command)이나 launch_app으로 처리하세요.';
      if (name.startsWith('screen_')) {
        const m = await controlMode();
        if (m === 'shizuku') return await shzScreen(name, i);
        if (m === null) return '화면 조작 수단이 없어요. 앱 설정의 [Shizuku로 접근성 켜기] 또는 Shizuku 실행(무선 디버깅)이 필요하다고 사용자에게 안내하세요.';
      }
      switch (name) {
        case 'run_command': { const r = await D.runCommand({ command: i.command, cwd: i.cwd }); return clip(`${r.output || '(출력 없음)'}\n[종료코드 ${r.exitCode}${r.timedOut ? ', 시간초과' : ''}]`); }
        case 'read_file': return (await D.readFile({ path: i.path })).content;
        case 'write_file': return j(await D.writeFile({ path: i.path, content: i.content, append: !!i.append }));
        case 'list_dir': { const r = await D.listDir({ path: i.path }); return clip(`${r.path} (총 ${r.total}개)\n` + r.entries.slice(0, 200).map((e) => e.name + (e.dir ? '/' : '')).join('\n')); }
        case 'device_info': return j(await D.deviceInfo());
        case 'list_apps': { const f = filterApps((await D.listApps()).apps, i.query); return f.slice(0, 60).map((a) => `${a.name}=${a.package}`).join('\n') + (f.length > 60 ? `\n...외 ${f.length - 60}개 (query로 검색하세요)` : '') || '(없음)'; }
        case 'launch_app': {
          let pkg = i.package;
          if (!pkg) {
            const f = filterApps((await D.listApps()).apps, i.name || ''); const q = String(i.name || '').toLowerCase();
            const hit = f.find((a) => a.name.toLowerCase() === q) || f[0];
            if (!hit) return `앱을 찾지 못했어요: ${i.name}`; pkg = hit.package;
          }
          return j(await D.launchApp({ package: pkg }));
        }
        case 'open_intent': return j(await D.openIntent(i));
        case 'screen_read': {
          const r = await D.screenRead(); if (r.error) return r.error;
          return clip(`앱: ${r.package} (요소 ${r.count}개)\n` + (r.nodes || []).slice(0, 120).map((n) => `${n.text || n.desc || n.id || '(이름없음)'}${n.click ? ' [클릭]' : ''}${n.edit ? ' [입력]' : ''} @${n.x},${n.y}`).join('\n'));
        }
        case 'screen_click_text': return j(await D.screenClickText({ text: i.text, exact: !!i.exact }));
        case 'screen_tap': return j(await D.screenTap({ x: i.x, y: i.y }));
        case 'screen_swipe': return j(await D.screenSwipe(i));
        case 'screen_type': return j(await D.screenType({ text: i.text }));
        case 'screen_global': return j(await D.screenGlobal({ action: i.action }));
        case 'adb_command': return clip((await D.shizukuShell({ command: i.command })).output || '(출력 없음)');
        case 'wait': await sleep(Math.min(10, Math.max(0, i.seconds || 1)) * 1000); return '대기 완료';
        case 'request_all_files_access': return j(await D.requestAllFilesAccess());
        case 'open_accessibility_settings': return j(await D.openAccessibilitySettings());
        default: return '알 수 없는 도구';
      }
    }

    for (let n = 0; n < 30; n++) {
      let data;
      try { data = await LLM.call({ provider: settings.provider, apiKey: settings.apiKey, model: settings.model, system: SYSTEM(!!settings.screenControl), tools: toolList, messages, onWait: (s) => notify({ type: 'wait', seconds: s }) }); }
      catch (e) { return { error: String(e.message || e) }; }
      messages.push({ role: 'assistant', content: data.content });
      if (data.stop_reason !== 'tool_use') {
        let text = data.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
        let mood = 'neutral'; const m = text.match(/^\s*\[기분:([a-z]+)\]\s*/);
        if (m) { if (MOODS.includes(m[1])) mood = m[1]; text = text.slice(m[0].length); }
        if (uiUsed && settings.screenControl) await comeBack();
        return { text, mood };
      }
      const results = [];
      for (const b of data.content.filter((x) => x.type === 'tool_use')) {
        notify({ type: 'tool', name: b.name, input: b.input });
        let out; try { out = await tool(b.name, b.input); } catch (e) { out = '오류: ' + (e && e.message ? e.message : e); }
        results.push({ type: 'tool_result', tool_use_id: b.id, content: String(out) });
      }
      messages.push({ role: 'user', content: results });
    }
    if (uiUsed && settings.screenControl) await comeBack();
    return { text: '작업이 너무 길어져서 여기서 멈췄어요. 이어서 말씀해 주세요.', mood: 'surprised' };
  }
  window.PhoneAgent = { run: runPhoneAgent, available: () => !!dev() };
})();
