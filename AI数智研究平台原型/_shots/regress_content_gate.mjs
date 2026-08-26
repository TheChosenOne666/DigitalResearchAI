import { chromium } from 'playwright';

const results = [];
const log = (name, ok, extra = '') => {
  results.push({ name, ok, extra });
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name}${extra ? ' | ' + extra : ''}`);
};

const SHOTS = 'D:/PM/智库/AI数智研究平台原型/_shots/';
const browser = await chromium.launch();
const URL = 'http://127.0.0.1:8123/index.html';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// helper: fresh context + page with error capture
async function newPage() {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForSelector('#appShell', { state: 'visible', timeout: 10000 });
  await sleep(500);
  return { ctx, page, errors };
}
const vis = (page, sel) => page.evaluate(s => {
  const el = document.querySelector(s);
  if (!el) return 'MISSING';
  return getComputedStyle(el).display !== 'none' && el.offsetParent !== null;
}, sel);

// ---------- A. Guest fresh state ----------
{
  const { ctx, page, errors } = await newPage();

  const navSt = await page.evaluate(() => {
    const el = s => { const n = document.querySelector(s); return n ? { d: getComputedStyle(n).display, op: n.offsetParent !== null } : null; };
    return {
      hasUser: document.body.classList.contains('has-user'),
      home: el('.tn-item[data-tn="home"]'),
      kb: el('.tn-item[data-tn="kb"]'),
      hist: el('#tnHistDrop .tn-hist-trigger'),
      loginBtn: el('#tnLoginBtn'),
      bell: el('.tn-icon[title="消息通知"]'),
      dot: el('.tn-icon .tn-dot')
    };
  });
  log('A1 guest: no has-user', navSt.hasUser === false);
  log('A2 guest: nav 首页 visible', !!navSt.home && navSt.home.d !== 'none' && navSt.home.op, JSON.stringify(navSt.home));
  log('A3 guest: nav 知识库 visible', !!navSt.kb && navSt.kb.d !== 'none' && navSt.kb.op, JSON.stringify(navSt.kb));
  log('A4 guest: nav 历史记录 visible', !!navSt.hist && navSt.hist.d !== 'none' && navSt.hist.op, JSON.stringify(navSt.hist));
  log('A5 guest: login btn visible', !!navSt.loginBtn && navSt.loginBtn.d !== 'none' && navSt.loginBtn.op, JSON.stringify(navSt.loginBtn));
  log('A6 guest: 消息通知 bell visible', !!navSt.bell && navSt.bell.d !== 'none' && navSt.bell.op, JSON.stringify(navSt.bell));
log('A6b guest: bell red-dot hidden', !!navSt.dot && navSt.dot.d === 'none' && !navSt.dot.op, JSON.stringify(navSt.dot));

  // open notification drawer
  await page.click('.tn-icon[title="消息通知"]');
  await page.waitForSelector('#notifDrawer.show', { timeout: 3000 });
  const notif = await page.evaluate(() => ({
    maskShow: document.getElementById('notifMask').classList.contains('show'),
    items: document.querySelectorAll('#notifDrawer .notif-item').length,
    title: (document.querySelector('#notifDrawer .notif-head h3') || {}).textContent || '',
    gateTitle: ((document.querySelector('#notifDrawer .guest-gate .gg-title') || {}).textContent || '').trim(),
    gateDesc: ((document.querySelector('#notifDrawer .guest-gate .gg-desc') || {}).textContent || '').trim()
  }));
  log('A7 guest: drawer opens with login gate, 0 items', notif.maskShow && notif.items === 0 && notif.title === '消息通知' && notif.gateTitle === '登录后查看消息通知' && !!notif.gateDesc, JSON.stringify(notif));
  await page.screenshot({ path: SHOTS + 'notif_drawer_guest.png' });
  await page.click('#notifDrawer .notif-head .icon-btn');
  await sleep(250);
  const notifClosed = await page.evaluate(() => !document.getElementById('notifDrawer').classList.contains('show'));
  log('A8 guest: drawer closes', notifClosed === true);

  // go to KB as guest: page navigates, no login modal
  await page.evaluate(() => go('kb'));
  await sleep(400);
  const kbNav = await page.evaluate(() => ({
    modalShow: document.getElementById('loginModal').classList.contains('show'),
    kbActive: !document.getElementById('view-kb').hasAttribute('hidden')
  }));
  log('A9 guest go(kb): kb view opens, no login modal', kbNav.kbActive && !kbNav.modalShow, JSON.stringify(kbNav));

  const kbGate = await page.evaluate(() => {
    const txt = el => (el ? (el.textContent || '').trim() : '');
    const table = document.querySelector('#kbDocTable .kb-table');
    return {
      gateTitle: txt(document.querySelector('#kbDocTable .guest-gate .gg-title')),
      rows: table ? table.querySelectorAll('tbody tr').length : 0,
      addDisplay: (() => { const aw = document.querySelector('#view-kb .kb-add-wrap'); return aw ? getComputedStyle(aw).display : 'MISSING'; })(),
      groupsGate: !!document.querySelector('#kbGroupList .kb-groups-gate'),
      groupCount: document.querySelectorAll('#kbGroupList .kb-group').length,
      statsText: txt(document.getElementById('kbStats'))
    };
  });
  log('A10 guest kb docs: gate title', kbGate.gateTitle === '登录后查看文档内容', kbGate.gateTitle);
  log('A11 guest kb docs: no rows', kbGate.rows === 0, 'rows=' + kbGate.rows);
  log('A12 guest kb docs: add hidden', kbGate.addDisplay === 'none', kbGate.addDisplay);
  log('A13 guest kb groups: gate shown, no groups', kbGate.groupsGate === true && kbGate.groupCount === 0, 'groups=' + kbGate.groupCount);
  log('A14 guest kb stats: gate text', kbGate.statsText.indexOf('登录后查看文档统计') >= 0, kbGate.statsText);
  await page.screenshot({ path: SHOTS + 'gate_kb_docs_guest.png', fullPage: true });

  // AI成果 tab as guest
  await page.click('.kb-tab[data-kbtab="ach"]');
  await sleep(300);
  const achGate = await page.evaluate(() => ({
    gateTitle: ((document.querySelector('#kbAchCards .guest-gate .gg-title') || {}).textContent || '').trim(),
    cards: document.querySelectorAll('#kbAchCards .ach-card').length,
    statsHtml: (document.getElementById('kbAchStats').innerHTML || '').trim(),
    statsCount: document.querySelectorAll('#kbAchStats .v3-stat').length
  }));
  log('A15 guest kb AI成果: gate title', achGate.gateTitle === '登录后查看 AI 成果', achGate.gateTitle);
  log('A16 guest kb AI成果: no cards, stats empty', achGate.cards === 0 && achGate.statsHtml === '' && achGate.statsCount === 0, 'cards=' + achGate.cards + ' stats=' + achGate.statsCount);
  await page.screenshot({ path: SHOTS + 'gate_kb_ach_guest.png', fullPage: true });

  // home sidebar history gate
  await page.evaluate(() => go('home'));
  await sleep(400);
  const sideGate = await page.evaluate(() => ({
    gateTitle: ((document.querySelector('#ssHistList .guest-gate .gg-title') || {}).textContent || '').trim(),
    histCount: document.querySelectorAll('#ssHistList .ss-hist').length,
    hasSearch: !!document.getElementById('ssHistSearch'),
    hasFoot: !!document.querySelector('.ss-sb-foot')
  }));
  log('A17 guest home sidebar: gate title', sideGate.gateTitle === '登录后查看历史记录', sideGate.gateTitle);
  log('A18 guest home sidebar: no search/foot', sideGate.hasSearch === false && sideGate.hasFoot === false, JSON.stringify(sideGate));
  await page.screenshot({ path: SHOTS + 'gate_home_hist_guest.png', fullPage: true });

  // top history dropdown as guest
  await page.click('#tnHistDrop .tn-hist-trigger');
  await sleep(300);
  const topHist = await page.evaluate(() => ({
    text: (document.getElementById('tnHistMenu').textContent || '').replace(/\s+/g, ' ').trim(),
    items: document.querySelectorAll('#tnHistMenu .th-item').length,
    loginBtn: !!document.querySelector('#tnHistMenu button')
  }));
  log('A19 guest top history: gate + no items', topHist.items === 0 && topHist.text.indexOf('登录后查看历史记录') >= 0 && topHist.loginBtn, topHist.text);
  await page.screenshot({ path: SHOTS + 'tn_hist_guest.png' });
  await page.click('.tn-brand');
  await sleep(200);

  // guest gate register button opens reg tab
  await page.evaluate(() => go('kb'));
  await sleep(400);
  await page.click('#kbDocTable .guest-gate .gg-ops button:nth-child(2)');
  await page.waitForSelector('#loginModal.show', { timeout: 3000 });
  const regTab = await page.evaluate(() => ({
    regPane: !document.getElementById('lmPaneReg').hidden,
    submit: (document.querySelector('.lm-submit') || {}).textContent || ''
  }));
  log('A20 guest gate 注册账号 -> reg tab', regTab.regPane && regTab.submit === '注 册', JSON.stringify(regTab));
  await page.click('.lm-close');
  await sleep(200);

  log('A21 guest: 0 console/page errors', errors.length === 0, errors.join(' | ') || '');
  await ctx.close();
}

console.log('---- guest done ----');

// ---------- B. Login user/user123 ----------
{
  const { ctx, page, errors } = await newPage();
  await page.click('#tnLoginBtn');
  await page.waitForSelector('#loginModal.show', { timeout: 5000 });
  await page.click('.lm-tab[data-lgtab="pwd"]');
  await page.fill('#lgUser', 'user');
  await page.fill('#lgPass', 'user123');
  await page.click('.lm-submit');
  await page.waitForFunction(() => document.body.classList.contains('has-user'), null, { timeout: 6000 });
  await sleep(600);

  const navSt = await page.evaluate(() => {
    const el = s => { const n = document.querySelector(s); return n ? getComputedStyle(n).display !== 'none' && n.offsetParent !== null : false; };
    return { hasUser: document.body.classList.contains('has-user'), home: el('.tn-item[data-tn="home"]'), kb: el('.tn-item[data-tn="kb"]'), hist: el('#tnHistDrop .tn-hist-trigger'), bell: el('.tn-icon[title="消息通知"]'), userChip: el('#tnUser .nav-user') };
  });
  log('B1 user login: has-user', navSt.hasUser === true);
  log('B2 user login: nav still visible', navSt.home && navSt.kb && navSt.hist, JSON.stringify(navSt));
  log('B3 user login: bell still visible', navSt.bell === true);
  log('B4 user login: user chip shown', navSt.userChip === true);

  // notification drawer should show real announcements when logged in
  await page.click('.tn-icon[title="消息通知"]');
  await page.waitForSelector('#notifDrawer.show', { timeout: 3000 });
  const notifB = await page.evaluate(() => ({
    items: document.querySelectorAll('#notifDrawer .notif-item').length,
    gate: !!document.querySelector('#notifDrawer .guest-gate'),
    dotHidden: (() => { const d = document.querySelector('.tn-icon .tn-dot'); return !d || getComputedStyle(d).display === 'none'; })()
  }));
  log('B4a login: drawer shows 4 real announcements, no gate', notifB.items === 4 && notifB.gate === false, JSON.stringify(notifB));
  log('B4b login: bell red-dot visible', notifB.dotHidden === false, 'dotHidden=' + notifB.dotHidden);
  await page.screenshot({ path: SHOTS + 'notif_drawer_loggedin.png' });
  await page.click('#notifDrawer .notif-head .icon-btn');
  await sleep(250);

  // home sidebar should now be real history (fix regression)
  const side = await page.evaluate(() => ({
    histCount: document.querySelectorAll('#ssHistList .ss-hist').length,
    hasSearch: !!document.getElementById('ssHistSearch'),
    hasFoot: !!document.querySelector('.ss-sb-foot'),
    count: ((document.getElementById('ssHistCount') || {}).textContent || ''),
    gate: !!document.querySelector('#ssHistList .guest-gate')
  }));
  log('B5 login: sidebar history 4 items', side.histCount === 4 && side.gate === false, JSON.stringify(side));
  log('B6 login: sidebar search+foot restored', side.hasSearch && side.hasFoot && side.count === '4', JSON.stringify(side));

  // top history dropdown
  await page.click('#tnHistDrop .tn-hist-trigger');
  await sleep(300);
  const topHist = await page.evaluate(() => document.querySelectorAll('#tnHistMenu .th-item').length);
  log('B7 login: top history 4 items', topHist === 4, 'items=' + topHist);
  await page.click('.tn-brand');
  await sleep(200);

  // KB docs
  await page.evaluate(() => go('kb'));
  await sleep(400);
  const kb = await page.evaluate(() => ({
    rows: document.querySelectorAll('#kbDocTable .kb-table tbody tr').length,
    addDisplay: (() => { const aw = document.querySelector('#view-kb .kb-add-wrap'); return aw ? getComputedStyle(aw).display : 'MISSING'; })(),
    groups: document.querySelectorAll('#kbGroupList .kb-group').length,
    statsText: (document.getElementById('kbStats').textContent || '').replace(/\s+/g, ' ').trim()
  }));
  log('B8 login: kb rows >= 10', kb.rows >= 10, 'rows=' + kb.rows);
  log('B9 login: add content visible', kb.addDisplay !== 'none', kb.addDisplay);
  log('B10 login: kb groups 6', kb.groups === 6, 'groups=' + kb.groups);
  log('B11 login: kb stats numbers', kb.statsText.indexOf('文档') >= 0, kb.statsText);
  await page.screenshot({ path: SHOTS + 'kb_docs_loggedin.png', fullPage: true });

  // AI成果
  await page.click('.kb-tab[data-kbtab="ach"]');
  await sleep(300);
  const ach = await page.evaluate(() => ({
    cards: document.querySelectorAll('#kbAchCards .ach-card').length,
    stats: document.querySelectorAll('#kbAchStats .v3-stat').length,
    gate: !!document.querySelector('#kbAchCards .guest-gate')
  }));
  log('B12 login: AI成果 5 cards, stats 3', ach.cards === 5 && ach.stats === 3 && ach.gate === false, JSON.stringify(ach));

  log('B13 user login: 0 errors', errors.length === 0, errors.join(' | ') || '');
  await ctx.close();
}

console.log('---- user login done ----');

// ---------- C. Logout ----------
{
  const { ctx, page, errors } = await newPage();
  await page.click('#tnLoginBtn');
  await page.waitForSelector('#loginModal.show', { timeout: 5000 });
  await page.click('.lm-tab[data-lgtab="pwd"]');
  await page.fill('#lgUser', 'user');
  await page.fill('#lgPass', 'user123');
  await page.click('.lm-submit');
  await page.waitForFunction(() => document.body.classList.contains('has-user'), null, { timeout: 6000 });
  await sleep(400);

  await page.click('#tnUser .nav-user');
  await sleep(250);
  await page.click('#tnUser .nav-drop .danger');
  await sleep(500);

  const st = await page.evaluate(() => {
    const el = s => { const n = document.querySelector(s); return n ? getComputedStyle(n).display !== 'none' && n.offsetParent !== null : false; };
    return {
      hasUser: document.body.classList.contains('has-user'),
      home: el('.tn-item[data-tn="home"]'), kb: el('.tn-item[data-tn="kb"]'), hist: el('#tnHistDrop .tn-hist-trigger'),
      loginBtn: el('#tnLoginBtn'), bell: el('.tn-icon[title="消息通知"]')
    };
  });
  log('C1 logout: has-user removed', st.hasUser === false);
  log('C2 logout: nav still visible', st.home && st.kb && st.hist, JSON.stringify(st));
  log('C3 logout: login btn + bell visible', st.loginBtn === true && st.bell === true);

  // notification drawer gated again after logout
  await page.click('.tn-icon[title="消息通知"]');
  await page.waitForSelector('#notifDrawer.show', { timeout: 3000 });
  const notifC = await page.evaluate(() => ({
    items: document.querySelectorAll('#notifDrawer .notif-item').length,
    gateTitle: ((document.querySelector('#notifDrawer .guest-gate .gg-title') || {}).textContent || '').trim(),
    dotHidden: (() => { const d = document.querySelector('.tn-icon .tn-dot'); return !d || getComputedStyle(d).display === 'none'; })()
  }));
  log('C3a logout: drawer gate back, 0 items', notifC.items === 0 && notifC.gateTitle === '登录后查看消息通知', JSON.stringify(notifC));
  log('C3b logout: bell red-dot hidden again', notifC.dotHidden === true, 'dotHidden=' + notifC.dotHidden);
  await page.click('#notifDrawer .notif-head .icon-btn');
  await sleep(250);

  // sidebar gate back
  const side = await page.evaluate(() => ({
    gate: !!document.querySelector('#ssHistList .guest-gate'),
    hasSearch: !!document.getElementById('ssHistSearch'),
    hasFoot: !!document.querySelector('.ss-sb-foot')
  }));
  log('C4 logout: sidebar gate back, no search/foot', side.gate === true && side.hasSearch === false && side.hasFoot === false, JSON.stringify(side));

  // kb gate back
  await page.evaluate(() => go('kb'));
  await sleep(400);
  const kb = await page.evaluate(() => ({
    gateTitle: ((document.querySelector('#kbDocTable .guest-gate .gg-title') || {}).textContent || '').trim(),
    rows: document.querySelectorAll('#kbDocTable .kb-table tbody tr').length,
    addDisplay: (() => { const aw = document.querySelector('#view-kb .kb-add-wrap'); return aw ? getComputedStyle(aw).display : 'MISSING'; })()
  }));
  log('C5 logout: kb gate back, no rows, add hidden', kb.gateTitle === '登录后查看文档内容' && kb.rows === 0 && kb.addDisplay === 'none', JSON.stringify(kb));

  log('C6 logout: 0 errors', errors.length === 0, errors.join(' | ') || '');
  await ctx.close();
}

console.log('---- logout done ----');

// ---------- D. Register ----------
{
  const { ctx, page, errors } = await newPage();
  await page.click('#tnLoginBtn');
  await page.waitForSelector('#loginModal.show', { timeout: 5000 });
  await page.click('.lm-tab[data-lgtab="reg"]');
  await page.fill('#rgPhone', '13912345678');
  await page.click('#rgSendBtn');
  await sleep(400);
  const code = await page.evaluate(() => SMS_CODES['13912345678']);
  log('D1 register: sms code generated', !!code, 'code=' + (code || 'N/A'));
  await page.fill('#rgCode', code || '000000');
  await page.fill('#rgName', '测试注册用户');
  await page.fill('#rgPass', 'Test123456');
  await page.fill('#rgPass2', 'Test123456');
  await page.click('.lm-submit');
  await page.waitForFunction(() => document.body.classList.contains('has-user'), null, { timeout: 6000 });
  await sleep(500);

  const st = await page.evaluate(() => ({
    modalClosed: !document.getElementById('loginModal').classList.contains('show'),
    hasUser: document.body.classList.contains('has-user'),
    name: ((document.querySelector('#tnUser .nu-name') || {}).textContent || ''),
    navKb: (() => { const n = document.querySelector('.tn-item[data-tn="kb"]'); return n ? getComputedStyle(n).display !== 'none' && n.offsetParent !== null : false; })(),
    bell: !!document.querySelector('.tn-icon[title="消息通知"]')
  }));
  log('D2 register: modal closed + has-user', st.modalClosed === true && st.hasUser === true, JSON.stringify(st));
  log('D3 register: name shown', st.name === '测试注册用户', st.name);
  log('D4 register: nav + bell visible', st.navKb === true && st.bell === true);
  log('D5 register: 0 errors', errors.length === 0, errors.join(' | ') || '');
  await ctx.close();
}

console.log('---- register done ----');

// ---------- E. Phone login ----------
{
  const { ctx, page, errors } = await newPage();
  await page.click('#tnLoginBtn');
  await page.waitForSelector('#loginModal.show', { timeout: 5000 });
  const defaultPhone = await page.evaluate(() => !document.getElementById('lmPanePhone').hidden);
  log('E1 phone login: phone tab default', defaultPhone === true);
  await page.fill('#lgPhone', '13812345678');
  await page.click('#lgSendBtn');
  await sleep(400);
  const code = await page.evaluate(() => SMS_CODES['13812345678']);
  log('E2 phone login: sms code generated', !!code, 'code=' + (code || 'N/A'));
  await page.fill('#lgCode', code || '000000');
  await page.click('.lm-submit');
  await page.waitForFunction(() => document.body.classList.contains('has-user'), null, { timeout: 6000 });
  await sleep(500);
  const st = await page.evaluate(() => ({
    modalClosed: !document.getElementById('loginModal').classList.contains('show'),
    hasUser: document.body.classList.contains('has-user'),
    name: ((document.querySelector('#tnUser .nu-name') || {}).textContent || '')
  }));
  log('E3 phone login: success', st.modalClosed === true && st.hasUser === true && st.name === '用户5678', JSON.stringify(st));
  log('E4 phone login: 0 errors', errors.length === 0, errors.join(' | ') || '');
  await ctx.close();
}

console.log('---- phone login done ----');

// ---------- F. z-index topmost ----------
{
  const { ctx, page, errors } = await newPage();
  await page.click('#tnLoginBtn');
  await page.waitForSelector('#loginModal.show', { timeout: 5000 });
  const z = await page.evaluate(() => {
    const zi = sel => { const el = document.querySelector(sel); return el ? parseInt(getComputedStyle(el).zIndex, 10) || 0 : -1; };
    return {
      loginModal: zi('#loginModal'),
      toast: zi('.toast-wrap') >= 0 ? zi('.toast-wrap') : zi('.toast-box'),
      notifMask: zi('#notifMask'),
      notifDrawer: zi('#notifDrawer')
    };
  });
  log('F1 login modal z-index >= 200 (above frosted glass)', z.loginModal >= 200, 'z=' + z.loginModal);
  log('F2 toast z-index > login modal (验证码提示最上层)', z.toast > z.loginModal, 'toast=' + z.toast + ' login=' + z.loginModal);
  log('F3 notif drawer z-index < toast', z.notifDrawer < z.toast, 'drawer=' + z.notifDrawer + ' toast=' + z.toast);
  log('F4 z-index check: 0 errors', errors.length === 0, errors.join(' | ') || '');
  await ctx.close();
}

// ---------- G. 用户端支付：无回调异常 + 账单无发票 ----------
{
  const { ctx, page, errors } = await newPage();
  await page.click('#tnLoginBtn');
  await page.waitForSelector('#loginModal.show', { timeout: 5000 });
  await page.click('.lm-tab[data-lgtab="pwd"]');
  await page.fill('#lgUser', 'user');
  await page.fill('#lgPass', 'user123');
  await page.click('.lm-submit');
  await page.waitForFunction(() => document.body.classList.contains('has-user'), null, { timeout: 6000 });
  await sleep(600);

  // 结算支付：历史订单不应出现「回调异常」
  await page.evaluate(() => go('pay'));
  await sleep(400);
  const pay = await page.evaluate(() => {
    const txt = sel => { const el = document.querySelector(sel); return el ? (el.textContent || '').trim() : ''; };
    const rows = Array.from(document.querySelectorAll('#v3-pay-tbody tr')).map(r => r.textContent);
    return {
      visible: !document.getElementById('view-pay').hasAttribute('hidden'),
      rowCount: rows.length,
      hasCallbackExc: rows.some(t => t.includes('回调异常')),
      subtitle: txt('#view-pay .panel .sub')
    };
  });
  log('G1 pay view: no 回调异常 in 历史订单', pay.visible && pay.rowCount === 2 && pay.hasCallbackExc === false, JSON.stringify(pay));
  log('G2 pay view: subtitle 无支付回调后端术语', pay.subtitle === '订单状态实时更新', pay.subtitle);

  // 账单查询：仅 订单列表/支付流水，无「消费明细（发票）」
  await page.evaluate(() => go('billing'));
  await sleep(400);
  const bill = await page.evaluate(() => {
    const tabs = Array.from(document.querySelectorAll('#view-billing .tabs .tab')).map(b => b.textContent.trim());
    const rows = Array.from(document.querySelectorAll('#v3-bill-orders tr')).map(r => r.textContent);
    return {
      visible: !document.getElementById('view-billing').hasAttribute('hidden'),
      tabs,
      hasInvoiceTab: tabs.some(t => t.includes('消费明细')),
      invoiceDiv: !!document.getElementById('tab-b-invoices'),
      hasCallbackExc: rows.some(t => t.includes('回调异常')),
      rowCount: rows.length
    };
  });
  log('G3 billing: tabs 仅 订单列表/支付流水，无消费明细', bill.visible && bill.tabs.length === 2 && bill.hasInvoiceTab === false && bill.invoiceDiv === false, JSON.stringify(bill.tabs));
  log('G4 billing: 订单列表无回调异常', bill.hasCallbackExc === false, 'rows=' + bill.rowCount);

  // 支付流程：确认支付后订单转已支付、不生成发票、toast 不含发票
  const invoicesBefore = await page.evaluate(() => (DB.invoices || []).length);
  await page.evaluate(() => go('pay'));
  await sleep(300);
  await page.click('#view-pay .pay-order .btn');
  await page.waitForSelector('#modalMask.show', { timeout: 3000 });
  const modalBody = await page.evaluate(() => (document.getElementById('modalBody') || {}).textContent || '');
  log('G5 pay confirm modal: 金额/订单号取自待支付订单', modalBody.includes('ORD202608100001') && modalBody.includes('499'), modalBody.trim().slice(0, 90));
  await page.click('#modalOK');
  await sleep(700);
  const after = await page.evaluate(() => ({
    toastText: (() => { const t = document.querySelector('#toastBox .toast:last-child span'); return t ? t.textContent : ''; })(),
    invoices: (DB.invoices || []).length,
    pendingStatus: (() => { const o = (DB.orders || []).find(x => x.id === 'ORD202608100001'); return o ? o.status : 'MISSING'; })()
  }));
  log('G6 pay success: 订单转已支付，未生成发票', after.pendingStatus === '已支付' && after.invoices === invoicesBefore, JSON.stringify(after));
  log('G7 pay toast: 支付成功且不再提发票', after.toastText.includes('支付成功') && !after.toastText.includes('发票'), after.toastText);

  log('G8 pay/billing: 0 errors', errors.length === 0, errors.join(' | ') || '');
  await ctx.close();
}

await browser.close();
const fails = results.filter(r => !r.ok);
console.log('========================================');
console.log('TOTAL: ' + results.length + ' | PASS: ' + (results.length - fails.length) + ' | FAIL: ' + fails.length);
if (fails.length) console.log('FAILED: ' + fails.map(f => f.name).join(', '));