/**
 * End-to-end test on the REAL Session network: Alice sends a photo to Bob (image processing,
 * attachment encryption, file server upload/download through onion requests).
 *   URL=http://localhost:8080/ SP=/some/dir node web/test/e2e/attachment-live.js   (needs `npm i -g playwright`)
 * Note: the check for the rendered image looks for a >= 300x200 <img>; read the screenshot att-3.png.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const URL = process.env.URL || 'http://localhost:8080/';
const SP = process.env.SP || '.';
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function newUser(browser, name) {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const page = await ctx.newPage(); const logs = [];
  page.on('console', m => logs.push(m.text().slice(0, 500)));
  page.on('pageerror', e => logs.push('[pageerror] ' + String(e).slice(0, 500)));
  await page.goto(URL); await page.getByText('Create account').click({ timeout: 40000 });
  await page.waitForTimeout(2000); await page.locator('input').first().fill(name);
  await page.getByText('Continue').click(); await page.waitForTimeout(6000);
  const keys = await page.evaluate(() => window.getUserKeys());
  return { page, logs, id: keys.id, name };
}
const lookup = (u, id) => u.page.evaluate((id) => { const c = window.inboxStore?.getState?.().conversations.conversationLookup[id]; return c ? { last: c.lastMessage?.text ?? null, approved: c.isApproved } : null; }, id);
async function waitFor(label, fn, tries = 30, step = 5000) { for (let i = 0; i < tries; i++) { const r = await fn(); if (r) { console.log(`  [${label}] after ${i * step / 1000}s:`, JSON.stringify(r)); return r; } await sleep(step); } console.log(`  [${label}] TIMEOUT`); return null; }
(async () => {
  const browser = await chromium.launch({ args: ['--disable-web-security'] });
  const alice = await newUser(browser, 'Alice'), bob = await newUser(browser, 'Bob');
  // a real photo-like PNG made in the page
  const png = await alice.page.evaluate(async () => { const c = document.createElement('canvas'); c.width = 640; c.height = 400; const g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 640, 400); gr.addColorStop(0, '#ff7a00'); gr.addColorStop(1, '#0066ff'); g.fillStyle = gr; g.fillRect(0, 0, 640, 400);
    g.fillStyle = '#fff'; g.font = '48px sans-serif'; g.fillText('web attachment', 120, 210);
    const b = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.9)); return Array.from(new Uint8Array(await b.arrayBuffer())); });
  fs.writeFileSync(SP + '/test-photo.jpg', Buffer.from(png));
  console.log('photo bytes', png.length);
  // 1:1 hello, bob accepts
  await alice.page.mouse.click(346, 34); await alice.page.waitForTimeout(800);
  await alice.page.getByText('New Message').click(); await alice.page.waitForTimeout(800);
  await alice.page.locator('input, textarea').first().fill(bob.id); await alice.page.getByText('Next').click(); await alice.page.waitForTimeout(4000);
  await alice.page.locator('[data-testid="message-input-text-area"]').first().click({ timeout: 15000 });
  await alice.page.keyboard.type('hello'); await alice.page.keyboard.press('Enter');
  await waitFor('bob got hello', () => lookup(bob, alice.id), 24);
  await bob.page.getByText('Message Requests').first().click({ timeout: 15000 }); await bob.page.waitForTimeout(1500);
  await bob.page.getByText('Alice').first().click({ timeout: 10000 }); await bob.page.waitForTimeout(2500);
  await bob.page.getByText(/^Accept$/).first().click(); await bob.page.waitForTimeout(6000);
  // alice attaches the photo
  await waitFor('alice sees bob accepted', async () => { const c = await lookup(alice, bob.id); return c?.approved ? c : null; }, 30);
  for (let i = 0; i < 3; i++) { await alice.page.keyboard.press('Escape'); await alice.page.waitForTimeout(400); }
  await alice.page.getByText('Bob').first().click({ timeout: 8000 }).catch(() => {}); await alice.page.waitForTimeout(1500);
  // the + button may open a menu first; try to reach a file input directly
  await alice.page.mouse.click(418, 768); await alice.page.waitForTimeout(1500); await alice.page.screenshot({ path: SP + '/att-0.png' });
  console.log('  inputs on page:', await alice.page.evaluate(() => [...document.querySelectorAll('input[type=file]')].map(i => i.accept || '*').join(' | ') || '(none)'));
  let chooser = { setFiles: async (f) => { await alice.page.locator('input[type=file]').first().setInputFiles(f); } };
  if (!(await alice.page.locator('input[type=file]').count())) chooser = null;
  if (!chooser) { console.log('no file chooser opened'); await alice.page.screenshot({ path: SP + '/att-1.png' }); await browser.close(); return; }
  await chooser.setFiles(SP + '/test-photo.jpg'); await alice.page.waitForTimeout(4000);
  await alice.page.screenshot({ path: SP + '/att-1.png' });
  const mark = alice.logs.length;
  await alice.page.locator('[data-testid="message-input-text-area"]').first().click({ timeout: 10000 }); await alice.page.keyboard.type('a photo'); await alice.page.keyboard.press('Enter');
  console.log('alice sent the photo');
  const sendStatus = () => alice.page.evaluate((id) => { const c = window.inboxStore.getState().conversations; const msgs = c.messages || []; const m = msgs.filter(x => x.propsForMessage?.attachments?.length).pop(); return m ? { status: m.propsForMessage.status, attachments: m.propsForMessage.attachments.length } : null; }, bob.id);
  for (let i = 0; i < 24; i++) { const st = await sendStatus(); if (st && st.status && st.status !== 'sending') { console.log('  photo message status:', JSON.stringify(st), 'after', i * 5, 's'); break; } if (i === 23) console.log('  photo still', JSON.stringify(st)); await sleep(5000); }
  await alice.page.screenshot({ path: SP + '/att-2.png' });
  // bob: close any modal, open the conversation, then wait for the attachment to be downloaded
  for (let i = 0; i < 4; i++) { await bob.page.keyboard.press('Escape'); await bob.page.waitForTimeout(400); }
  await bob.page.locator('[data-testid="module-conversation__user__profile-name"]').first().click({ timeout: 8000 }).catch(() => console.log('  (could not open the conversation list item)'));
  await bob.page.waitForTimeout(2500);
  let img = null;
  await bob.page.getByText('Click to download media').first().click({ timeout: 60000 }).then(() => console.log('  bob clicked "Click to download media"')).catch(() => console.log('  (no download button)'));
  await bob.page.getByText(/^Yes$/).first().click({ timeout: 8000 }).then(() => console.log('  bob chose Yes (auto download)')).catch(() => console.log('  (no auto-download dialog)'));
  for (let i = 0; i < 30 && !img; i++) {
    img = await bob.page.evaluate(() => { const el = [...document.querySelectorAll('img')].find(e => e.naturalWidth >= 300 && e.naturalHeight >= 200); return el ? { w: el.naturalWidth, h: el.naturalHeight } : null; });
    if (!img) await sleep(4000);
  }
  console.log('bob sees the image:', JSON.stringify(img));
  await bob.page.screenshot({ path: SP + '/att-3.png' });
  console.log('--- alice WARN/ERROR after send:'); console.log([...new Set(alice.logs.slice(mark).filter(l => /^(WARN|ERROR)|rror/.test(l) && !/non-serializable|redux/i.test(l)).map(l => l.slice(0, 380)))].slice(0, 12).join('\n'));
  console.log('--- alice upload related:'); console.log([...new Set(alice.logs.filter(l => /pload|ttachment|ile ?server|filev2|failed to send|Failed to send|staged|encrypt/i.test(l) && !/retrieve-us|batch/.test(l)).map(l => l.slice(0, 320)))].slice(0, 16).join('\n'));
  const e = [...new Set([alice, bob].flatMap(u => u.logs.filter(l => /^ERROR|pageerror/.test(l) && !/Pro is not available|UpdateProRevocation|AbortError/.test(l)).map(l => u.name + ': ' + l.replace(/^ERROR \S+ /, '').slice(0, 140))))].slice(0, 8);
  console.log('errors:', e.length ? '\n  ' + e.join('\n  ') : '(none)');
  await browser.close();
})();
