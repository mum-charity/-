# 善款簿 (Dana Ledger)

**App link:** https://mum.franklee.asia/

**Demo with made-up sample data:** https://mum.franklee.asia/?demo. The demo keeps its data separately, so trying things there never touches the real records. Tap 重来 to reset it or 离开示范 to leave.

The same app is also on GitHub Pages at https://mum-charity.github.io/dana-ledger/. Each address keeps its own records, so she should use only one of them. To move records from one to the other, save a backup at the old address and restore it at the new one.

A small offline web app (PWA) for keeping a monthly donation book. It works like a paper book:

- Each **fund** (项目) has a numbered list of people. Each person gives a set amount every month, or a different amount each time.
- **Month page (每月):** tap the box next to a name to tick that month as paid. Undo appears for a few seconds. One payment can cover several months (e.g. 已付全年).
- **Money handed over (交钱 / 支出):** record the date, amount and who it went to. Small spending like 做茶点 goes here too.
- **Year table (全年表):** a Jan–Dec grid with monthly totals, money handed over, dates and running balance. It can be printed or saved as a PDF, or exported to Excel (CSV).
- **Backup:** save a backup file or restore from one. A WhatsApp text summary of the month is also available.

The interface is Simplified Chinese with large text, and amounts are in RM (you can change the currency in 设置).

## Current status

Last checked on 7 Nov 2026.

**The live app is ahead of this repo.** https://mum.franklee.asia/ runs version 1.4.0, while `dev` and `main` are at 1.1.1. The 1.4.0 source isn't in git, and the rest of this README describes 1.1.1.

| Copy | Version | Backup |
|---|---|---|
| https://mum.franklee.asia/ | 1.4.0 | Automatic, to the family's backup server |
| GitHub Pages | 1.1.1 | Manual backup file |
| This repo (`dev`, `main`) | 1.1.1 | Manual backup file |

In 1.4.0, `app.js` sends records to the backup server by itself whenever there is signal, and the 保存备份文件 button is gone. The other app files match this repo, apart from the version number in `sw.js` and line endings.

Still to do:

- Get the 1.4.0 source into git. It may still be on another machine. If it isn't, `app.js` and `sw.js` can be rebuilt from the live site.
- Find the backup server's source, which isn't in this repo.
- Confirm that records reach the backup server. Its health check passes, but that doesn't show backups are arriving.
- Run the unit and end-to-end tests on 1.4.0.
- Update this README for 1.4.0, and decide whether GitHub Pages should move to it too.

## Where the data lives

This section describes 1.1.1. The live app (1.4.0) also sends records to the backup server. See [Current status](#current-status).

Records are stored **only on the phone**, in the browser's localStorage for this site. Nothing is sent anywhere. The hosted site only serves the app's code.

This means:

- If the browser data is cleared or the phone is lost, the records are lost unless there is a backup.
- The app shows a reminder when it hasn't been backed up for 14 days. Encourage her to tap **保存备份文件** and send the file to you on WhatsApp.
- To move to a new phone, install the app there, then open **设置 → 从备份文件恢复**.

## Run locally

Any static file server works. The service worker needs `localhost` or HTTPS, so opening `file://` won't work.

```sh
npx http-server -c-1 .     # then open http://localhost:8080
npm test                   # unit tests for the money/balance rules
npm install && npm run test:e2e   # drives the real app in Edge on a phone-sized screen
```

The end-to-end test fixes the date to 6 Nov 2026. It creates a fund, ticks people as paid, prepays a year, records a payout, and checks the year table's balances against hand-worked numbers. It also checks offline use, backup, wipe-and-restore and the CSV export. Screenshots go to `.e2e-out/`.

## Deploy (Cloudflare)

**Don't deploy from this repo yet.** `npm run deploy` would replace 1.4.0 with 1.1.1 and stop the automatic backups. See [Current status](#current-status).

The app at https://mum.franklee.asia/ is a static-assets-only Cloudflare Worker, set up in `wrangler.jsonc`.

```sh
npx wrangler@4.158.0 login   # first time only: approve in the browser within about 2 minutes
npm run deploy               # copies the app's files into dist/, then uploads them
```

`npm run deploy` uploads only the files listed in `ASSETS` in `sw.js`, plus `index.html` and `sw.js`, so the README, tests and `node_modules` stay private. Cloudflare redirects `/index.html` to `/`, so the service worker caches the page as `./`. The end-to-end test's server does the same redirect.

## Deploy (GitHub Pages)

1. Push this folder to a GitHub repo.
2. In the repo, go to **Settings → Pages**. Set **Source: Deploy from a branch** and **Branch: main / (root)**.
3. The app will be at `https://<owner>.github.io/<repo>/`.

All paths are relative, so it works from a sub-path.

**Every time you change a file:** bump `VERSION` in `sw.js` and `APP_VERSION` in `app.js`. Otherwise phones keep the cached old version. The next time she opens the app it updates and shows 「善款簿已更新」.

## Files

| File | What it does |
| --- | --- |
| `index.html` | Page shell and PWA meta tags |
| `model.js` | All data rules (money in integer cents, months as `YYYY-MM`). Has no DOM code and is unit-tested in Node |
| `app.js` | Screens, forms, backup, sharing |
| `style.css` | Styles: large text, dark mode and print layout for the year table |
| `sw.js` | Offline cache (app files only, never the records) |
| `manifest.webmanifest`, `icons/` | Home-screen install |
| `tests/model.test.js` | Unit tests for balances, prepayments, import and CSV |
| `tests/e2e.js` | End-to-end test in Edge on a phone-sized screen |
| `wrangler.jsonc`, `scripts/build.js` | Cloudflare deploy: settings, and the copy of the app's files into `dist/` |

## First-time setup for mum

**Install it on her phone first, then set it up from the home-screen icon.** On iPhone, the home-screen app has its own storage, separate from the Safari tab. Anything entered in Safari *before* installing won't show up in the installed app. If that happens, open 设置 → 保存备份文件 in Safari, then 设置 → 从备份文件恢复 in the installed app. Android Chrome shares storage, so this only affects iPhone.

1. Install it (steps below), then open 「善款簿」 from the home screen.
2. Tap **＋ 新增项目**, e.g. 「Bhante 医疗费用」. Enter the money already on hand as 「开始时手上已有的钱」.
3. Tap **名单 → 一次添加多人** and paste one person per line, with the monthly amount at the end:
   ```
   陈美玲 10
   林志明、黄淑芬 20
   Tan Ah Kow 合家 10
   王小华
   ```
   Leave the amount off for people who give a different amount each month.
4. **「从哪个月开始」:** to start recording from now, keep the current month. If you pick an earlier month (e.g. January), those months show red (unpaid) until you fill them in from the paper book. To do that, open **全年表** and tap each cell.
5. Repeat for the other fund (e.g. 「Dana Parami」).
6. Make a first backup: 设置 → 保存备份文件. On Android the file goes to the **Download** folder. Send it on WhatsApp via 附件 → 文件.

### 安装到手机（给妈妈）

**Android（Chrome）：** 用 Chrome 打开链接 → 点右上角 ⋮ → 「安装应用」或「添加到主屏幕」 → 主屏幕会出现「善款簿」图标。

**iPhone（一定要用 Safari）：** 用 Safari 打开链接 → 点下面的「分享」按钮（方框加箭头）→ 往下找「添加到主屏幕」→ 点「添加」。

以后从主屏幕的「善款簿」图标打开就可以，不用上网也能用。

**每个月：** 收到钱后，在「每月」页点名字右边的方格打勾。交钱给 Bhante 后，点「＋ 记录交钱 / 支出」。

**常常备份：** 设置 → 保存备份文件 → 发给家人的 WhatsApp。
