const { chromium } = require('playwright');
const URL = process.env.URL || 'http://localhost:8080/';
const SP = process.env.SP || '.';
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function newUser(browser, name) {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const page = await ctx.newPage(); const logs = [];
  page.on('console', m => logs.push(m.text().slice(0, 400)));
  page.on('pageerror', e => logs.push('[pageerror] ' + String(e).slice(0, 400)));
  await page.goto(URL);
  await page.getByText('Create account').click({ timeout: 40000 });
  await page.waitForTimeout(2000); await page.locator('input').first().fill(name);
  await page.getByText('Continue').click(); await page.waitForTimeout(6000);
  const keys = await page.evaluate(() => window.getUserKeys());
  return { page, logs, id: keys.id, name };
}
const lookup = (u, id) => u.page.evaluate((id) => { const c = window.inboxStore?.getState?.().conversations.conversationLookup[id]; return c ? { name: c.displayNameInProfile, approved: c.isApproved, members: c.members?.length ?? null, last: c.lastMessage?.text ?? null, kicked: c.isKickedFromGroup ?? null } : null; }, id);
async function waitFor(label, fn, tries = 36, step = 5000) { for (let i = 0; i < tries; i++) { const r = await fn(); if (r) { console.log(`  [${label}] after ${i * step / 1000}s:`, JSON.stringify(r)); return r; } await sleep(step); } console.log(`  [${label}] TIMEOUT`); return null; }
const shot = (u, n) => u.page.screenshot({ path: `${SP}/carol-${u.name}-${n}.png` });
async function dm(from, to, text) {
  await from.page.mouse.click(346, 34); await from.page.waitForTimeout(800);
  await from.page.getByText('New Message').click(); await from.page.waitForTimeout(800);
  await from.page.locator('input, textarea').first().fill(to.id); await from.page.getByText('Next').click(); await from.page.waitForTimeout(4000);
  await from.page.locator('[data-testid="message-input-text-area"]').first().click({ timeout: 15000 });
  await from.page.keyboard.type(text); await from.page.keyboard.press('Enter');
}
async function acceptFirstRequest(u, label) {
  await u.page.getByText('Message Requests').first().click({ timeout: 15000 }); await u.page.waitForTimeout(1500);
  await u.page.getByText(label).first().click({ timeout: 10000 }); await u.page.waitForTimeout(2500);
  await u.page.getByText(/^Accept$/).first().click(); await u.page.waitForTimeout(6000);
}
(async () => {
  const browser = await chromium.launch({ args: ['--disable-web-security'] });
  const alice = await newUser(browser, 'Alice'), bob = await newUser(browser, 'Bob'), carol = await newUser(browser, 'Carol');
  console.log('users ready');
  await dm(alice, bob, 'hi bob'); await waitFor('bob got dm', () => lookup(bob, alice.id), 24);
  await dm(alice, carol, 'hi carol'); await waitFor('carol got dm', () => lookup(carol, alice.id), 24);
  // group with bob only
  await alice.page.mouse.click(346, 34); await alice.page.waitForTimeout(800);
  await alice.page.getByText('Create Group').click(); await alice.page.waitForTimeout(1500);
  await alice.page.locator('[data-testid="new-closed-group-name"]').fill('Trio', { timeout: 10000 });
  await alice.page.locator('[data-testid="select-contact"]').first().click({ timeout: 8000 }); await alice.page.waitForTimeout(500);
  await alice.page.getByText(/^Create$/).last().click();
  const ag = await waitFor('alice group', async () => { const ids = await alice.page.evaluate(() => Object.keys(window.inboxStore.getState().conversations.conversationLookup).filter(k => k.startsWith('03'))); return ids[0] ? { id: ids[0] } : null; }, 24);
  if (!ag) { await browser.close(); return; }
  const gid = ag.id;
  const hasInvite = u => u.page.evaluate(() => Object.keys(window.inboxStore.getState().conversations.conversationLookup).some(k => k.startsWith('03')));
  let first = null, late = null;
  for (let i = 0; i < 36 && !first; i++) { if (await hasInvite(bob)) first = bob; else if (await hasInvite(carol)) first = carol; else await sleep(5000); }
  if (!first) { console.log('  nobody got the invite'); await browser.close(); return; }
  late = first === bob ? carol : bob;
  console.log('  first invited:', first.name, '| to invite later:', late.name);
  await acceptFirstRequest(first, 'Trio');
  await waitFor(first.name + ' approved', async () => { const s = await lookup(first, gid); return s?.approved ? s : null; }, 12);
  // a message BEFORE late member joins
  await alice.page.getByText('Trio').first().click({ timeout: 10000 }).catch(() => {}); await alice.page.waitForTimeout(1500);
  await alice.page.locator('[data-testid="message-input-text-area"]').first().click({ timeout: 15000 });
  await alice.page.keyboard.type('BEFORE late member'); await alice.page.keyboard.press('Enter'); await alice.page.waitForTimeout(8000);
  // invite carol
  await alice.page.locator('[data-testid="conversation-options-avatar"]').first().click(); await alice.page.waitForTimeout(1500);
  await alice.page.locator('[data-testid="invite-contacts-menu-option"]').click({ timeout: 8000 }); await alice.page.waitForTimeout(2500); await shot(alice, 'i1');
  console.log('  invite dialog testids:', await alice.page.evaluate(() => [...document.querySelectorAll('[data-testid]')].map(e => e.getAttribute('data-testid')).filter(t => /invite|history|contact|confirm|member/i.test(t)).join(', ')));
  await alice.page.locator('[data-testid="select-contact"]').first().click({ timeout: 8000 }); await alice.page.waitForTimeout(800); await shot(alice, 'i2');
  await alice.page.getByRole('button', { name: /invite|Invite/ }).last().click({ timeout: 5000 }).catch(async () => { await alice.page.getByText(/^Invite$|^Confirm$|^OK$/).last().click({ timeout: 4000 }).catch(() => console.log('  (no invite button found)')); });
  await alice.page.waitForTimeout(3000); await shot(alice, 'i3');
  const histBtn = alice.page.getByText(/with history|Share (message )?history|include/i).first();
  if (await histBtn.count()) { console.log('  history option present'); }
  await alice.page.getByRole('button', { name: /^(Invite|Confirm|OK)/ }).last().click({ timeout: 3000 }).catch(() => {});
  await alice.page.waitForTimeout(6000); await shot(alice, 'i4');
  const ci = await waitFor(late.name + ' got invite', async () => (await hasInvite(late)) ? { ok: true } : null, 36);
  if (ci) {
    await acceptFirstRequest(late, 'Trio');
    await waitFor(late.name + ' approved', async () => { const s = await lookup(late, gid); return s?.approved ? s : null; }, 12);
    for (let i = 0; i < 4; i++) { await alice.page.keyboard.press('Escape'); await alice.page.waitForTimeout(500); }
    await alice.page.mouse.click(768, 80).catch(() => {});
    await alice.page.locator('[data-testid="message-input-text-area"]').first().click({ timeout: 15000 }).catch(() => console.log('  (composer blocked)'));
    await alice.page.keyboard.type('AFTER late member joined'); await alice.page.keyboard.press('Enter');
    await waitFor(late.name + ' reads AFTER', async () => { const s = await lookup(late, gid); return s?.last && /AFTER late member joined/.test(s.last) ? s : null; }, 30);
    await waitFor(first.name + ' reads AFTER', async () => { const s = await lookup(first, gid); return s?.last && /AFTER late member joined/.test(s.last) ? s : null; }, 30);
    await shot(late, 'c1');
  }
  console.log([alice, bob, carol].map(u => u.name + ' errors: ' + [...new Set(u.logs.filter(l => /^ERROR|pageerror/.test(l) && !/Pro is not available|UpdateProRevocation|AbortError/.test(l)).map(l => l.replace(/^ERROR \S+ /, '').slice(0, 110)))].slice(0, 4).join(' || ')).join('\n'));
  await browser.close();
})();
