// End-to-end check of 善款簿 on a phone-sized viewport using the installed Edge.
// Usage: npm install && npm run test:e2e   (uses the Microsoft Edge installed on this PC)
// The clock is fixed to 6 Nov 2026 so the month/balance assertions are stable.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const appDir = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const shotDir = path.resolve(process.argv[3] || path.join(__dirname, '..', '.e2e-out'));
fs.mkdirSync(shotDir, { recursive: true });

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  // Redirect /index.html to / as Cloudflare does, so a service worker that caches the redirect fails here too.
  if (p.endsWith('/index.html')) { res.writeHead(307, { Location: p.slice(0, -'index.html'.length) }); return res.end(); }
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(appDir, p);
  if (!file.startsWith(appDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('404'); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
});

let failures = 0;
function check(cond, msg) {
  console.log((cond ? '  ok   ' : '  FAIL ') + msg);
  if (!cond) failures++;
}

(async () => {
  await new Promise((r) => server.listen(0, r));
  const base = `http://localhost:${server.address().port}/`;
  const browser = await chromium.launch({ channel: 'msedge' });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'zh-CN', acceptDownloads: true });
  await context.clock.setFixedTime(new Date('2026-11-06T10:00:00'));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const shot = (name) => page.screenshot({ path: path.join(shotDir, name + '.png'), fullPage: true });
  const text = (sel) => page.locator(sel).first().innerText();

  await page.goto(base);
  await page.waitForSelector('.empty');
  await shot('01-home-empty');
  check(await page.locator('text=欢迎使用善款簿').isVisible(), 'empty home shows welcome');

  // --- create fund
  await page.click('text=＋ 新增项目');
  await page.fill('input[name=name]', 'Bhante 医疗费用');
  await page.fill('input[name=opening]', '50');
  await shot('02-fund-sheet');
  await page.click('.sheet button[type=submit]');
  await page.waitForSelector('.tab[aria-current=page]:has-text("名单")');
  check(page.url().includes('/p'), 'after creating fund, lands on 名单');

  // --- bulk add three people from January
  await page.click('text=一次添加多人');
  await page.fill('textarea[name=text]', '1 陈美玲 10\n2 林志明、黄淑芬 20\n王小华');
  await page.selectOption('select[name=startMonth]', '2026-01');
  check((await text('[data-role=bulk-submit]')) === '添加 3 人', 'bulk preview counts 3 people');
  await shot('03-bulk-sheet');
  await page.click('[data-role=bulk-submit]');
  await page.waitForSelector('.sheet', { state: 'detached' });

  // --- add one person Apr–Aug
  await page.click('text=＋ 添加一人');
  await page.fill('input[name=name]', 'Tan Ah Kow 合家');
  await page.fill('input[name=pledge]', '10');
  await page.selectOption('select[name=startMonth]', '2026-04');
  await page.selectOption('select[name=endMonth]', '2026-08');
  await page.click('.sheet button[type=submit]');
  await page.waitForSelector('.sheet', { state: 'detached' });
  check((await page.locator('.roster-item').count()) === 4, 'roster has 4 people');
  await shot('04-people');

  // --- month page (current month = Nov 2026 in this test run)
  await page.click('.tab:has-text("每月")');
  await page.waitForSelector('.people');
  const month = await text('.period-title');
  console.log('  month page:', month);
  check((await page.locator('.person').count()) === 3, 'Tan Ah Kow (Apr–Aug) not listed in Nov');

  // quick pay + undo
  const row1 = page.locator('.person', { hasText: '陈美玲' });
  await row1.locator('.tick').click();
  await page.waitForSelector('#toast.show');
  check(await row1.locator('.tick.is-paid').isVisible(), 'one tap marks 陈美玲 paid');
  await page.click('.toast-btn');
  check(!(await page.locator('.person', { hasText: '陈美玲' }).locator('.tick.is-paid').count()), 'undo removes the tick');
  await page.locator('.person', { hasText: '陈美玲' }).locator('.tick').click();

  // variable amount person opens sheet
  await page.locator('.person', { hasText: '王小华' }).locator('.tick').click();
  await page.waitForSelector('.sheet input[name=amount]');
  await page.fill('.sheet input[name=amount]', '29');
  await page.click('.sheet button[type=submit]');
  await page.waitForSelector('.sheet', { state: 'detached' });

  // payout
  await page.click('text=＋ 记录交钱 / 支出');
  await page.waitForSelector('.sheet [data-role=month-hint]');
  check((await text('.sheet [data-role=month-hint]')).includes('RM 39'), 'payout sheet shows month received RM 39');
  await page.fill('.sheet input[name=amount]', '30');
  await page.fill('.sheet input[name=note]', '交给 Bhante');
  await shot('05-payout-sheet');
  await page.click('.sheet button[type=submit]');
  await page.waitForSelector('.sheet', { state: 'detached' });

  // back button closes a sheet without leaving the page
  await page.locator('.person', { hasText: '陈美玲' }).locator('.person-main').click();
  await page.waitForSelector('.sheet');
  await shot('06-receipt-edit-sheet');
  await page.goBack();
  await page.waitForSelector('.sheet', { state: 'detached' });
  check(page.url().includes('/m/'), 'phone back button closes the sheet and stays on month page');

  // prepay a full year for 林志明 starting January
  await page.click('.period-btn[aria-label=上个月]');
  for (let i = 0; i < 9; i++) await page.click('.period-btn[aria-label=上个月]');
  check((await text('.period-title')) === '2026年1月', 'navigated to Jan 2026');
  await page.locator('.person', { hasText: '林志明' }).locator('.person-main').click();
  await page.waitForSelector('.sheet .stepper');
  for (let i = 0; i < 11; i++) await page.click('.sheet .step[data-d="1"]');
  const hint = await text('.sheet [data-role=count-hint]');
  console.log('  prepay hint:', hint);
  check(hint.includes('共 12 个月') && hint.includes('RM 240'), 'prepay hint shows 12 months, RM 240');
  await page.fill('.sheet input[name=note]', '已付全年');
  await shot('07-prepay-sheet');
  await page.click('.sheet button[type=submit]');
  await page.waitForSelector('.sheet', { state: 'detached' });
  await page.click('text=回到本月');

  const summary = await text('.summary');
  console.log('  Nov summary:', summary.replace(/\s+/g, ' '));
  check(summary.includes('RM 59') && summary.includes('3 / 3 人'), 'Nov received RM 59 from 3/3');
  check(summary.includes('RM 250') && summary.includes('RM 279'), 'Nov opening RM 250, closing RM 279');
  check(summary.includes('RM 20 是预先付了'), 'prepaid Dec RM 20 noted');
  await shot('08-month');

  // --- year grid
  await page.click('.tab:has-text("全年表")');
  await page.waitForSelector('.grid');
  const balRow = await page.locator('.bal-row td').allInnerTexts();
  console.log('  balance row:', balRow.join(' | '));
  check(JSON.stringify(balRow.slice(0, 12)) === JSON.stringify(['70', '90', '110', '130', '150', '170', '190', '210', '230', '250', '279', '']), 'year 结余 row matches hand calculation');
  const sumRow = await page.locator('.sum-row td').allInnerTexts();
  check(sumRow[10] === '59' && sumRow[12] === '279', 'Nov total 59, year total 279');
  const chinRow = await page.locator('tbody tr', { hasText: 'Tan Ah Kow' }).locator('td').allInnerTexts();
  check(chinRow[0] === '–' && chinRow[3] === '' && chinRow[8] === '–', 'Tan Ah Kow: – before Apr and after Aug');
  const yt = await text('.year-totals');
  check(yt.includes('RM 299'), 'year-end balance RM 299');
  await shot('09-year');

  // CSV export downloads. Desktop Edge can "share" CSV files, which hangs headless,
  // so force the download fallback that phones without file sharing use.
  await page.evaluate(() => { navigator.canShare = () => false; });
  const [csvDl] = await Promise.all([page.waitForEvent('download', { timeout: 5000 }).catch(() => null), page.click('text=导出 Excel 表格')]);
  if (csvDl) {
    const csvPath = path.join(shotDir, 'export.csv');
    await csvDl.saveAs(csvPath);
    const csv = fs.readFileSync(csvPath, 'utf8');
    check(csv.charCodeAt(0) === 0xfeff && csv.includes('陈美玲'), 'CSV download has BOM and names');
  } else check(false, 'CSV download happened');

  // --- home
  await page.click('text=返回');
  await page.waitForSelector('.fund-card');
  const card = await text('.fund-card');
  check(card.includes('RM 299'), 'home card shows cash on hand RM 299');
  check(card.includes('3') && card.includes('/ 3 人'), 'home card shows 3/3 paid');
  await shot('10-home');

  // --- reload: data persists, service worker controls the page
  await page.reload();
  await page.waitForSelector('.fund-card');
  check((await text('.fund-card')).includes('RM 299'), 'data persists after reload');
  await page.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller, null, { timeout: 10000 }).catch(() => {});
  check(await page.evaluate(() => !!(navigator.serviceWorker && navigator.serviceWorker.controller)), 'service worker controls the page');

  // offline
  await context.setOffline(true);
  await page.reload();
  await page.waitForSelector('.fund-card', { timeout: 5000 }).catch(() => {});
  check(await page.locator('.fund-card').isVisible(), 'app opens offline');
  await context.setOffline(false);

  // --- backup download
  await page.click('text=设置');
  await page.waitForSelector('text=保存备份文件');
  const [bk] = await Promise.all([page.waitForEvent('download', { timeout: 5000 }).catch(() => null), page.click('text=保存备份文件')]);
  if (bk) {
    const bkPath = path.join(shotDir, 'backup.json');
    await bk.saveAs(bkPath);
    const data = JSON.parse(fs.readFileSync(bkPath, 'utf8'));
    check(data.app === 'dana-ledger' && data.data.receipts.length === 14, 'backup file has 14 receipts');
    await shot('11-settings');

    // --- restore: wipe the phone, restore from the backup file, everything comes back
    await page.evaluate(() => localStorage.clear());
    await page.goto(base);
    await page.waitForSelector('text=欢迎使用善款簿');
    check(!(await page.locator('.fund-card').count()), 'wiped storage shows empty app');
    await page.setInputFiles('#restore-file', bkPath);
    await page.waitForSelector('.confirm');
    check((await text('.confirm')).includes('14 笔收款'), 'restore confirm shows what is in the backup');
    await page.click('[data-action=confirm-yes]');
    await page.waitForSelector('.fund-card');
    check((await text('.fund-card')).includes('RM 299'), 'restore brings back cash on hand RM 299');
    await page.reload();
    await page.waitForSelector('.fund-card');
    check((await text('.fund-card')).includes('RM 299'), 'restored data survives reload');
    await page.click('text=设置');
    await page.waitForSelector('text=保存备份文件');
  } else check(false, 'backup download happened');

  // --- font size: xlarge month page
  await page.click('[data-size=xlarge]');
  await page.click('text=返回');
  await page.click('.fund-card');
  await page.waitForSelector('.people');
  await shot('12-month-xlarge');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  check(!overflow, 'no horizontal page scroll at extra-large text');

  // --- dark mode
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.click('[data-size=large]').catch(() => {});
  await shot('13-month-dark');
  await page.emulateMedia({ colorScheme: 'light' });

  // --- demo mode: sample data, kept apart from the real records
  const realBefore = await page.evaluate(() => localStorage.getItem('dana-ledger:v1'));
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('dana-ledger:v1'));
    s.settings.fontSize = 'large';
    localStorage.setItem('dana-ledger:v1', JSON.stringify(s));
  });
  const realKept = await page.evaluate(() => localStorage.getItem('dana-ledger:v1'));
  await page.goto(base + '?demo');
  await page.waitForSelector('.demo-bar');
  check((await page.locator('.fund-card').count()) === 2, 'demo shows 2 sample funds');
  check((await text('.fund-card')).includes('Bhante 医疗费用'), 'demo first fund is the medical fund');
  await shot('20-demo-home');
  await page.locator('.fund-card').first().click();
  await page.waitForSelector('.people');
  const paidNow = await page.locator('.person.is-paid').count();
  const allNow = await page.locator('.person').count();
  check(paidNow > 0 && paidNow < allNow, `demo month is partly ticked (${paidNow}/${allNow})`);
  await shot('21-demo-month');
  await page.locator('.person:not(.is-paid) .tick').first().click();
  check((await page.locator('.person.is-paid').count()) === paidNow + 1, 'ticking works in demo');
  await page.click('.tab:has-text("全年表")');
  await page.waitForSelector('.grid');
  await shot('22-demo-year');
  await page.click('.tab:has-text("名单")');
  await page.waitForSelector('.roster');
  await shot('23-demo-people');
  check((await page.evaluate(() => localStorage.getItem('dana-ledger:v1'))) === realKept, 'demo never touches the real records');
  await page.click('[data-action=demo-exit]');
  await page.waitForSelector('.fund-card');
  check(!(await page.locator('.demo-bar').count()) && (await text('.fund-card')).includes('RM 299'), 'leaving demo returns to the real records');
  check(!!realBefore, 'real records existed before demo');

  check(errors.length === 0, 'no console errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await browser.close();
  server.close();
  console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
