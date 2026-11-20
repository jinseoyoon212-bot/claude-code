const { chromium } = require('playwright');
const URL = process.env.URL || 'http://localhost:8080/';
const SP = process.env.SP || '.';
const COMMUNITY = 'https://open.getsession.org/session?public_key=a03c383cf63c3c4efe67acc52112a6dd734b3a946b9545f488aaa93da7991238';
(async () => {
  const browser = await chromium.launch({ args: ['--disable-web-security'] });
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const page = await ctx.newPage(); const logs = [];
  page.on('console', m => logs.push(m.text().slice(0, 400)));
  page.on('pageerror', e => logs.push('[pageerror] ' + String(e).slice(0, 400)));
  await page.goto(URL);
  await page.getByText('Create account').click({ timeout: 40000 });
  await page.waitForTimeout(2000); await page.locator('input').first().fill('Alice');
  await page.getByText('Continue').click(); await page.waitForTimeout(7000);
  await page.mouse.click(346, 34); await page.waitForTimeout(800);
  await page.getByText('Join Community').click(); await page.waitForTimeout(1500);
  await page.locator('input, textarea').first().fill(COMMUNITY);
  await page.screenshot({ path: SP + '/comm-1.png' });
  await page.getByText(/^(Join|Next|Continue)$/).last().click({ timeout: 8000 }).catch(() => console.log('(no join button)'));
  console.log('joining community...');
  let info = null;
  for (let i = 0; i < 24; i++) {
    info = await page.evaluate(() => { const l = window.inboxStore.getState().conversations.conversationLookup; const k = Object.keys(l).find(x => l[x].isPublic); const c = k && l[k];
      return c ? { id: k, name: c.displayNameInProfile, last: c.lastMessage?.text ?? null, unread: c.unreadCount } : null; });
    if (info && info.last) break; await page.waitForTimeout(5000);
  }
  console.log('community:', JSON.stringify(info));
  await page.waitForTimeout(8000);
  await page.screenshot({ path: SP + '/comm-2.png' });
  const att = logs.filter(l => /_runJob|attachment|Attachment|downloadAttachment|fileserver|file server|filev2/i.test(l)).slice(0, 8);
  console.log('attachment related:\n  ' + att.map(l => l.slice(0, 420)).join('\n  '));
  const errs = [...new Set(logs.filter(l => /^ERROR|pageerror|decryptForCommunity|Failed to decrypt/i.test(l) && !/Pro is not available|UpdateProRevocation|AbortError/.test(l)).map(l => l.replace(/^ERROR \S+ /, '').slice(0, 150)))].slice(0, 8);
  console.log('errors:', errs.length ? '\n  ' + errs.join('\n  ') : '(none)');
  await browser.close();
})();
