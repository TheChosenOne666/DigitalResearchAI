import { chromium } from 'playwright';

const results = [];
const log = (name, ok, extra = '') => {
  results.push({ name, ok, extra });
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name}${extra ? ' | ' + extra : ''}`);
};

const browser = await chromium.launch();
const URL = 'http://127.0.0.1:8123/index.html';

// ---------- A. Guest fresh state ----------
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForSelector('#appShell', { state: 'visible', timeout: 8000 });

  const guest = await page.evaluate(() => {
    const cs = el => el ? getComputedStyle(el).display : 'MISSING';
    const kb = document.querySelector('.tn-item[data-tn="kb"]');
    const hist = document.getElementById('tnHistDrop');
    const home = document.querySelector('.tn-item[data-tn="home"]');
    const loginBtn = document.getElementById('tnLoginBtn');
    return {
      hasUser: document.body.classList.contains('has-user'),
      kbDisplay: cs(kb),
      histDisplay: cs(hist),
      homeDisplay: cs(home),
      loginBtnDisplay: cs(loginBtn),
      bell: !!document.querySelector('[title="消息通知"]'),
      notifMask: !!document.getElementById('notifMask'),
      notifDrawer: !!document.getElementById('notifDrawer'),
      tnNavVisible: Array.from(document.querySelectorAll('#topnav .tn-item')).filter(el => el.offsetParent !== null).length
    };
  });
  log('A1 guest: no has-user', guest.hasUser === false);
  log('A2 guest: kb hidden', guest.kbDisplay === 'none', 'display=' + guest.kbDisplay);
  log('A3 guest: history hidden', guest.histDisplay === 'none', 'display=' + guest.histDisplay);
  log('A4 guest: home visible', guest.homeDisplay !== 'none', 'display=' + guest.homeDisplay);
  log('A5 guest: login btn visible', guest.loginBtnDisplay !== 'none', 'display=' + guest.loginBtnDisplay);
  log('A6 no bell', guest.bell === false && guest.notifMask === false && guest.notifDrawer === false);
  log('A7 guest: only home visible in nav', guest.tnNavVisible === 1, 'visible=' + guest.tnNavVisible);

  await page.evaluate(() => { go('kb'); });
  await page.waitForTimeout(400);
  const guard = await page.evaluate(() => {
    const m = document.getElementById('loginModal');
    const kbView = document.getElementById('view-kb');
    return {
      modalShow: m ? m.classList.contains('show') : false,
      kbActive: kbView ? !kbView.hasAttribute('hidden') : false
    };
  });
  log('A8 guest go(kb) -> login modal opens', guard.modalShow === true);
  log('A9 guest go(kb) -> kb view NOT shown', guard.kbActive === false);

  await page.evaluate(() => closeLoginModal());
  await page.waitForTimeout(200);
  log('A10 guest: 0 console/page errors', errors.length === 0, errors.join(' | ') || '');
  await ctx.close();
}

console.log('---- guest done ----');

// ---------- B. Login as user/user123 ----------
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForSelector('#appShell', { state: 'visible' });

  await page.click('#tnLoginBtn');
  await page.waitForSelector('#loginModal.show', { timeout: 5000 });
  await page.click('.lm-tab[data-lgtab="pwd"]');
  await page.fill('#lgUser', 'user');
  await page.fill('#lgPass', 'user123');
  await page.click('.lm-submit');
  await page.waitForTimeout(500);

  const st = await page.evaluate(() => {
    const cs = el => el ? getComputedStyle(el).display : 'MISSING';
    const kb = document.querySelector('.tn-item[data-tn="kb"]');
    const hist = document.getElementById('tnHistDrop');
    return {
      hasUser: document.body.classList.contains('has-user'),
      kbDisplay: cs(kb),
      histDisplay: cs(hist),
      bell: !!document.querySelector('[title="消息通知"]'),
      userShown: !!document.querySelector('#tnUser .nav-user')
    };
  });
  log('B1 user login: has-user', st.hasUser === true);
  log('B2 user login: kb visible', st.kbDisplay !== 'none', 'display=' + st.kbDisplay);
  log('B3 user login: history visible', st.histDisplay !== 'none', 'display=' + st.histDisplay);
  log('B4 user login: no bell', st.bell === false);
  log('B5 user login: user chip shown', st.userShown === true);

  await page.click('.tn-item[data-tn="kb"]');
  await page.waitForTimeout(300);
  const kbAct = await page.evaluate(() => !document.getElementById('view-kb').hasAttribute('hidden'));
  log('B6 logged-in kb click navigates', kbAct === true);

  log('B7 user login: 0 errors', errors.length === 0, errors.join(' | ') || '');
  await ctx.close();
}

console.log('---- user login done ----');

// ---------- C. Logout hides again ----------
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForSelector('#appShell', { state: 'visible' });

  // login
  await page.click('#tnLoginBtn');
  await page.waitForSelector('#loginModal.show', { timeout: 5000 });
  await page.click('.lm-tab[data-lgtab="pwd"]');
  await page.fill('#lgUser', 'user');
  await page.fill('#lgPass', 'user123');
  await page.click('.lm-submit');
  await page.waitForTimeout(400);

  // open user dropdown, click logout
  await page.click('#tnUser .nav-user');
  await page.waitForSelector('#tnUser .nav-drop', { state: 'visible', timeout: 3000 });
  await page.click('#tnUser .nav-drop .danger');
  await page.waitForTimeout(400);

  const st = await page.evaluate(() => {
    const cs = el => el ? getComputedStyle(el).display : 'MISSING';
    return {
      hasUser: document.body.classList.contains('has-user'),
      kbDisplay: cs(document.querySelector('.tn-item[data-tn="kb"]')),
      histDisplay: cs(document.getElementById('tnHistDrop')),
      loginBtn: cs(document.getElementById('tnLoginBtn'))
    };
  });
  log('C1 logout: has-user removed', st.hasUser === false);
  log('C2 logout: kb hidden again', st.kbDisplay === 'none', 'display=' + st.kbDisplay);
  log('C3 logout: history hidden again', st.histDisplay === 'none', 'display=' + st.histDisplay);
  log('C4 logout: login btn back', st.loginBtn !== 'none', 'display=' + st.loginBtn);
  log('C5 logout: 0 errors', errors.length === 0, errors.join(' | ') || '');
  await ctx.close();
}

console.log('---- logout done ----');

// ---------- D. Registration flow ----------
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForSelector('#appShell', { state: 'visible' });

  await page.click('#tnLoginBtn');
  await page.waitForSelector('#loginModal.show', { timeout: 5000 });
  await page.click('.lm-tab[data-lgtab="reg"]');
  await page.fill('#rgPhone', '13912345678');
  await page.click('#rgSendBtn');
  await page.waitForTimeout(300);
  const code = await page.evaluate(() => SMS_CODES['13912345678']);
  log('D1 sms code generated', !!code, 'code=' + (code || 'N/A'));
  await page.fill('#rgCode', code || '000000');
  await page.fill('#rgName', '测试注册用户');
  await page.fill('#rgPass', 'Test123456');
  await page.fill('#rgPass2', 'Test123456');
  await page.click('.lm-submit');
  await page.waitForTimeout(600);

  const st = await page.evaluate(() => {
    const cs = el => el ? getComputedStyle(el).display : 'MISSING';
    return {
      hasUser: document.body.classList.contains('has-user'),
      kbDisplay: cs(document.querySelector('.tn-item[data-tn="kb"]')),
      histDisplay: cs(document.getElementById('tnHistDrop')),
      modalClosed: !document.getElementById('loginModal').classList.contains('show'),
      userName: (document.querySelector('#tnUser .nu-name') || {}).textContent || ''
    };
  });
  log('D2 register: modal closed', st.modalClosed === true);
  log('D3 register: has-user', st.hasUser === true);
  log('D4 register: kb visible', st.kbDisplay !== 'none', 'display=' + st.kbDisplay);
  log('D5 register: history visible', st.histDisplay !== 'none', 'display=' + st.histDisplay);
  log('D6 register: user name shown', st.userName === '测试注册用户', 'name=' + st.userName);
  log('D7 register: 0 errors', errors.length === 0, errors.join(' | ') || '');
  await ctx.close();
}

console.log('---- register done ----');

// ---------- E. Admin login quick check ----------
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForSelector('#appShell', { state: 'visible' });

  await page.click('#tnLoginBtn');
  await page.waitForSelector('#loginModal.show', { timeout: 5000 });
  await page.click('.lm-tab[data-lgtab="pwd"]');
  await page.fill('#lgUser', 'admin');
  await page.fill('#lgPass', 'admin123');
  await page.click('.lm-submit');
  await page.waitForTimeout(500);

  const st = await page.evaluate(() => {
    const topnav = document.getElementById('topnav');
    return {
      dataEnd: document.body.getAttribute('data-end'),
      topnavDisplay: getComputedStyle(topnav).display,
      sidebarVisible: getComputedStyle(document.getElementById('sidebar')).display !== 'none',
      hasUser: document.body.classList.contains('has-user')
    };
  });
  log('E1 admin: data-end=admin', st.dataEnd === 'admin', 'data-end=' + st.dataEnd);
  log('E2 admin: topnav hidden', st.topnavDisplay === 'none', 'display=' + st.topnavDisplay);
  log('E3 admin: sidebar visible', st.sidebarVisible === true);
  log('E4 admin: has-user true', st.hasUser === true);
  log('E5 admin: 0 errors', errors.length === 0, errors.join(' | ') || '');
  await ctx.close();
}

await browser.close();
const fails = results.filter(r => !r.ok);
console.log('========================================');
console.log('TOTAL: ' + results.length + ' | PASS: ' + (results.length - fails.length) + ' | FAIL: ' + fails.length);
if (fails.length) console.log('FAILED: ' + fails.map(f => f.name).join(', '));
if (typeof process !== 'undefined') process.exit(fails.length ? 1 : 0);


