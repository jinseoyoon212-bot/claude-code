/**
 * End-to-end test on the REAL Session network: two web clients, group creation + invite + accept,
 * rename, remove a member (rekey) and check that the removed member cannot read what follows.
 *   URL=http://localhost:8080/ SP=/some/dir node web/test/e2e/group-manage-live.js   (needs `npm i -g playwright`)
 */
const { chromium } = require('playwright');
const URL = process.env.URL || 'http://localhost:8080/';
const SP = process.env.SP;
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
  const gid = aliceGroup.id;
  const gState = u => u.page.evaluate((id) => { const c = window.inboxStore.getState().conversations.conversationLookup[id];
    return c ? { name: c.displayNameInProfile, approved: c.isApproved, members: c.members?.length ?? null, last: c.lastMessage?.text ?? null, kicked: c.isKickedFromGroup ?? null } : null; }, gid);
  // bob accepts via Message Requests
  await bob.page.getByText('Message Requests').first().click({ timeout: 10000 }); await bob.page.waitForTimeout(1500);
  await bob.page.getByText('Web group').first().click({ timeout: 10000 }); await bob.page.waitForTimeout(2500);
  await bob.page.getByText(/^Accept$/).first().click(); await bob.page.waitForTimeout(6000);
  await waitFor('bob approved', async () => { const s = await gState(bob); return s && s.approved ? s : null; }, 12);
  // --- A) alice renames the group
  await alice.page.getByText('Web group').first().click({ timeout: 10000 }).catch(() => {}); await alice.page.waitForTimeout(1500);
  await alice.page.locator('[data-testid="conversation-options-avatar"]').first().click(); await alice.page.waitForTimeout(1500);
  await alice.page.locator('[data-testid="edit-group-name"]').click(); await alice.page.waitForTimeout(1500); await shot(alice, 'r1');
  const input = alice.page.locator('input, textarea').first();
  await input.fill('Renamed on web'); await alice.page.keyboard.press('Enter'); await alice.page.waitForTimeout(1500);
  await alice.page.getByText(/^(OK|Save|Done|Update)$/).first().click({ timeout: 3000 }).catch(() => {});
  await shot(alice, 'r2');
  console.log('A) alice renamed the group');
  await waitFor('bob sees the new name', async () => { const s = await gState(bob); return s && s.name === 'Renamed on web' ? s : null; }, 30);
  // --- B) alice opens Manage Members
  await alice.page.locator('[data-testid="manage-members-menu-option"]').click({ timeout: 8000 }).catch(async () => {
    await alice.page.locator('[data-testid="conversation-options-avatar"]').first().click(); await alice.page.waitForTimeout(1000);
    await alice.page.locator('[data-testid="manage-members-menu-option"]').click(); });
  await alice.page.waitForTimeout(2000); await shot(alice, 'm1');
  console.log(await alice.page.evaluate(() => [...document.querySelectorAll('[data-testid]')].map(e => e.getAttribute('data-testid')).filter(t => /member|remove|contact|promote|admin/i.test(t)).join(', ')));
  // --- C) alice removes bob, then writes something only the remaining members may read
  await alice.page.locator('[data-testid="select-contact"]').first().click({ timeout: 8000 }); await alice.page.waitForTimeout(800); await shot(alice, 'm2');
  await alice.page.getByText(/^Remove$/).last().click({ timeout: 5000 }); await alice.page.waitForTimeout(2500); await shot(alice, 'm3');
  // a confirmation may follow
  await alice.page.getByRole('button', { name: /^Remove|Confirm|OK$/ }).first().click({ timeout: 3000 }).catch(() => {});
  await alice.page.waitForTimeout(8000); await shot(alice, 'm4');
  console.log('C) alice removed bob');
  for (let i = 0; i < 4; i++) { await alice.page.keyboard.press('Escape'); await alice.page.waitForTimeout(600); }
  await alice.page.getByText(/^Cancel$/).first().click({ timeout: 1500 }).catch(() => {});
  await alice.page.locator('[data-testid="modal-close-button"], [aria-label="Close"]').first().click({ timeout: 1500 }).catch(() => {});
  await alice.page.mouse.click(768, 80).catch(() => {}); // the X of the settings panel
  await alice.page.waitForTimeout(1200); await shot(alice, 'm4b');
  const lastBefore = (await gState(bob))?.last;
  await alice.page.locator('[data-testid="message-input-text-area"]').first().click({ timeout: 15000 });
  await alice.page.keyboard.type('SECRET after bob was removed'); await alice.page.keyboard.press('Enter');
  console.log('   alice sent the secret message');
  await alice.page.waitForTimeout(45000);
  const bobNow = await gState(bob);
  const aliceNow = await gState(alice);
  console.log('   alice sees:', JSON.stringify(aliceNow));
  console.log('   bob sees:  ', JSON.stringify(bobNow));
  console.log('   RESULT: bob can read the secret message ->', /SECRET/.test(bobNow?.last || '') ? 'YES (BAD)' : 'no (good)');
  await shot(bob, 'm5');
  console.log('--- alice removal related logs:');
  console.log([...new Set(alice.logs.filter(l => /GroupPendingRemovals|evoke|rekey|Rekey|memberErase|sequence|removed|kick|Kick|401|403|sendEncryptedDataToSnode/i.test(l) && !/retrieve-us|batch/.test(l)).map(l => l.slice(0, 260)))].slice(0, 28).join('\n'));
  const errs = [alice, bob].map(u => u.name + ' errors: ' + [...new Set(u.logs.filter(l => /^ERROR|pageerror/.test(l) && !/Pro is not available|UpdateProRevocation/.test(l)).map(l => l.replace(/^ERROR \S+ /, '').slice(0, 140)))].slice(0, 5).join(' || '));
  console.log(errs.join('\n'));
  await browser.close();
})();
