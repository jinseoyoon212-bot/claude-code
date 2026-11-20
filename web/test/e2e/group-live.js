/**
 * End-to-end test on the REAL Session network, with two web clients (Alice and Bob):
 * 1:1 message, group creation, invite, accept, group messages both ways.
 *
 *   URL=https://<your-site>/ SP=/some/dir node web/test/e2e/group-live.js     (needs `npm i -g playwright`)
 *
 * Runs Chromium with --disable-web-security only so that a locally served build can talk to the
 * relay (CORS). Against the deployed site that flag isn't needed.
 */
const { chromium } = require('playwright');
const URL = process.env.URL || 'http://localhost:8080/';
const SP = process.env.SP || '.';
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function newUser(browser, name) {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', m => logs.push(m.text().slice(0, 400)));
  page.on('pageerror', e => logs.push('[pageerror] ' + String(e).slice(0, 400)));
  await page.goto(URL);
  await page.getByText('Create account').click({ timeout: 40000 });
  await page.waitForTimeout(2000);
  await page.locator('input').first().fill(name);
  await page.getByText('Continue').click();
  await page.waitForTimeout(6000);
  const keys = await page.evaluate(() => window.getUserKeys());
  return { page, logs, id: keys.id, name };
}
const state = (u, id) => u.page.evaluate((id) => { const c = window.inboxStore?.getState?.().conversations.conversationLookup[id];
  return c ? { type: c.type, name: c.displayNameInProfile || c.nickname || null, last: c.lastMessage?.text ?? null, unread: c.unreadCount, approved: c.isApproved, members: c.members?.length } : null; }, id);
async function waitFor(label, fn, tries = 36, step = 5000) {
  for (let i = 0; i < tries; i++) { const r = await fn(); if (r) { console.log(`  [${label}] after ${i * step / 1000}s:`, JSON.stringify(r)); return r; } await sleep(step); }
  console.log(`  [${label}] TIMEOUT`); return null;
}
const shot = (u, n) => u.page.screenshot({ path: `${SP}/grp-${u.name}-${n}.png` });
(async () => {
  const browser = await chromium.launch({ args: ['--disable-web-security'] });
  const alice = await newUser(browser, 'Alice');
  const bob = await newUser(browser, 'Bob');
  console.log('alice', alice.id.slice(0, 10), 'bob', bob.id.slice(0, 10));
  // 1) contact: alice -> bob 1:1
  await alice.page.mouse.click(346, 34); await alice.page.waitForTimeout(800);
  await alice.page.getByText('New Message').click(); await alice.page.waitForTimeout(800);
  await alice.page.locator('input, textarea').first().fill(bob.id);
  await alice.page.getByText('Next').click(); await alice.page.waitForTimeout(4000);
  await alice.page.locator('[data-testid="message-input-text-area"]').first().click({ timeout: 15000 });
  await alice.page.keyboard.type('hi bob'); await alice.page.keyboard.press('Enter');
  console.log('1) 1:1 sent');
  await waitFor('bob got 1:1', () => state(bob, alice.id));
  // 2) alice creates a group with bob
  await alice.page.mouse.click(346, 34); await alice.page.waitForTimeout(800);
  await alice.page.getByText('Create Group').click(); await alice.page.waitForTimeout(1500);
  await alice.page.locator('[data-testid="new-closed-group-name"]').fill('Web group', { timeout: 10000 });
  await shot(alice, 'g1');
  await alice.page.mouse.click(356, 287); await alice.page.waitForTimeout(800); // select the first contact (bob)
  await shot(alice, 'g2');
  await alice.page.getByText(/^Create$/).last().click();
  console.log('2) group create clicked');
  const aliceGroup = await waitFor('alice group exists', async () => { const ids = await alice.page.evaluate(() => Object.keys(window.inboxStore.getState().conversations.conversationLookup).filter(k => k.startsWith('03'))); return ids[0] ? { id: ids[0] } : null; }, 24);
  await shot(alice, 'g3');
  if (!aliceGroup) { console.log(alice.logs.filter(l => /group|error/i.test(l)).slice(-8).join('\n')); await browser.close(); return; }
  // 3) bob gets the invite
  const bobInvite = await waitFor('bob got group invite', async () => { const ids = await bob.page.evaluate(() => Object.keys(window.inboxStore.getState().conversations.conversationLookup).filter(k => k.startsWith('03'))); return ids[0] ? { id: ids[0], st: await state(bob, ids[0]) } : null; }, 36);
  await shot(bob, 'g4');
  // 4) bob opens the group and accepts the invite
  const gid = aliceGroup.id;
  const gState = u => u.page.evaluate((id) => { const c = window.inboxStore.getState().conversations.conversationLookup[id];
    return c ? { name: c.displayNameInProfile, approved: c.isApproved, members: c.members?.length ?? null, last: c.lastMessage?.text ?? null, unread: c.unreadCount, kicked: c.isKickedFromGroup ?? null } : null; }, gid);
  await bob.page.evaluate((id) => window.inboxStore && window.getConversationController().get(id) && 0, gid);
  // bob's group invite sits in "Message Requests"
  await bob.page.getByText('Message Requests').first().click({ timeout: 10000 }); await bob.page.waitForTimeout(2000); await shot(bob, 'g5');
  await bob.page.getByText('Web group').first().click({ timeout: 10000 }).catch(() => console.log('  (could not click the group request)'));
  await bob.page.waitForTimeout(3000); await shot(bob, 'g5b');
  const accept = bob.page.getByText(/^Accept$/);
  if (await accept.count()) { await accept.first().click(); console.log('4) bob clicked Accept'); } else console.log('4) no Accept button visible (see screenshot g5b)');
  await bob.page.waitForTimeout(6000); await shot(bob, 'g6');
  await waitFor('bob approved group', async () => { const s = await gState(bob); return s && s.approved ? s : null; }, 12);
  // 5) alice sends a group message, bob should receive it
  await alice.page.getByText('Web group').first().click({ timeout: 10000 }).catch(() => {});
  await alice.page.waitForTimeout(2000);
  await alice.page.locator('[data-testid="message-input-text-area"]').first().click({ timeout: 15000 });
  await alice.page.keyboard.type('hello group, from alice'); await alice.page.keyboard.press('Enter');
  console.log('5) alice sent a group message');
  await waitFor('bob got group msg', async () => { const s = await gState(bob); return s && s.last && /hello group/.test(s.last) ? s : null; }, 30);
  // 6) bob replies
  await bob.page.locator('[data-testid="message-input-text-area"]').first().click({ timeout: 15000 }).catch(() => console.log('  (bob has no composer)'));
  await bob.page.keyboard.type('hi alice, bob here'); await bob.page.keyboard.press('Enter');
  console.log('6) bob replied');
  await waitFor('alice got reply', async () => { const s = await gState(alice); return s && s.last && /bob here/.test(s.last) ? s : null; }, 30);
  await shot(alice, 'g7'); await shot(bob, 'g7');
  const errs = [alice, bob].map(u => u.name + ' errors: ' + [...new Set(u.logs.filter(l => /^ERROR|pageerror/.test(l) && !/Pro is not available|UpdateProRevocation/.test(l)).map(l => l.replace(/^ERROR \S+ /, '').slice(0, 140)))].slice(0, 5).join(' || '));
  console.log(errs.join('\n'));
  await browser.close();
})();
