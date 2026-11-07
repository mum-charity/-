/* 善款簿 — user interface. Depends on model.js (window.Ledger). */
(function () {
  'use strict';

  const L = window.Ledger;
  const APP_VERSION = '1.1.1';
  // Demo mode (?demo) shows made-up sample data, saved under its own key so it
  // never mixes with the real records.
  const DEMO = new URLSearchParams(location.search).has('demo');
  const STORE_KEY = DEMO ? 'dana-ledger:demo' : 'dana-ledger:v1';
  const BACKUP_NAG_DAYS = 14;

  const app = document.getElementById('app');
  const sheetRoot = document.getElementById('sheet');
  const confirmRoot = document.getElementById('confirm');
  const toastRoot = document.getElementById('toast');
  const restoreInput = document.getElementById('restore-file');

  const esc = (v) =>
    String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  /** A named control inside a form (avoids clashes like form.name). */
  const field = (form, name) => form.elements.namedItem(name);

  // ================================================================ storage
  let storageOK = true;

  function loadState() {
    let raw = null;
    try {
      raw = localStorage.getItem(STORE_KEY);
    } catch (e) {
      storageOK = false;
      return L.emptyState();
    }
    if (!raw) return DEMO && window.LedgerDemo ? window.LedgerDemo.build(L) : L.emptyState();
    try {
      return L.normalizeState(JSON.parse(raw)).state;
    } catch (e) {
      console.error('Saved data could not be read', e);
      // Keep the unreadable copy so nothing is lost for good.
      try { localStorage.setItem(STORE_KEY + ':unreadable:' + Date.now(), raw); } catch (_) { /* ignore */ }
      return L.emptyState();
    }
  }

  let state = loadState();
  let askedPersist = false;

  function persist() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
      storageOK = true;
    } catch (e) {
      storageOK = false;
      showToast('⚠ 保存失败！请检查手机储存空间。', { ms: 10000 });
    }
  }
  /** Save after a change made by the user (counts toward the backup reminder). */
  function save() {
    state.settings.changesSinceBackup = (state.settings.changesSinceBackup || 0) + 1;
    persist();
    if (!askedPersist && navigator.storage && navigator.storage.persist) {
      askedPersist = true;
      navigator.storage.persist().catch(() => {});
    }
  }
  function mutate(fn) {
    const out = fn(state);
    save();
    render();
    return out;
  }

  // ================================================================ helpers
  const cur = () => state.settings.currency || '';
  const money = (c) => L.fmtMoney(c, cur());
  const thisYear = () => +L.currentMonth().slice(0, 4);

  function monthOptions(selected, { allowNone = false, noneLabel = '' } = {}) {
    const now = L.currentMonth();
    let from = `${thisYear() - 2}-01`;
    let to = `${thisYear() + 1}-12`;
    if (selected && selected < from) from = `${selected.slice(0, 4)}-01`;
    if (selected && selected > to) to = `${selected.slice(0, 4)}-12`;
    const opts = [];
    if (allowNone) opts.push(`<option value=""${!selected ? ' selected' : ''}>${esc(noneLabel)}</option>`);
    for (let m = from; m <= to; m = L.addMonths(m, 1)) {
      opts.push(`<option value="${m}"${m === selected ? ' selected' : ''}>${L.monthLabel(m)}${m === now ? '（本月）' : ''}</option>`);
    }
    return opts.join('');
  }

  function daysSince(ts) {
    return ts ? Math.floor((Date.now() - ts) / 86400000) : Infinity;
  }

  // ================================================================ routing
  // #/                    home
  // #/f/<id>/m/<YYYY-MM>  month page of a fund
  // #/f/<id>/y/<YYYY>     year table
  // #/f/<id>/p            people list
  // #/settings
  function route() {
    const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
    if (parts[0] === 'f' && parts[1]) {
      const fund = L.getFund(state, parts[1]);
      if (!fund) return { name: 'home' };
      if (parts[2] === 'y') return { name: 'year', fund, year: /^\d{4}$/.test(parts[3]) ? +parts[3] : thisYear() };
      if (parts[2] === 'p') return { name: 'people', fund };
      return { name: 'month', fund, month: L.isMonth(parts[3]) ? parts[3] : L.currentMonth() };
    }
    if (parts[0] === 'settings') return { name: 'settings' };
    return { name: 'home' };
  }

  function nav(hash, replace = false) {
    if (replace) history.replaceState(history.state, '', hash);
    else history.pushState({ d: ((history.state && history.state.d) || 0) + 1 }, '', hash);
    window.scrollTo(0, 0);
    render();
  }
  function goBack() {
    if (history.state && history.state.d > 0) history.back();
    else nav('#/', true);
  }

  window.addEventListener('popstate', () => {
    if (confirmOpen) closeConfirm(false);
    if (sheetOpen && !(history.state && history.state.sheet)) hideSheet();
    render();
  });
  window.addEventListener('hashchange', render);

  // ================================================================ views
  function topbar({ title, back = false, right = '' }) {
    return `<header class="topbar">
      ${back ? '<button class="topbar-btn" data-action="back"><span aria-hidden="true">‹</span> 返回</button>' : '<span></span>'}
      <h1 class="topbar-title">${esc(title)}</h1>
      ${right || '<span></span>'}
    </header>`;
  }

  function backupBanner() {
    const st = state.settings;
    if (DEMO || !state.funds.length || !st.changesSinceBackup) return '';
    const days = daysSince(st.lastBackupAt);
    if (days < BACKUP_NAG_DAYS && st.changesSinceBackup < 30) return '';
    const msg = st.lastBackupAt ? `已经 ${days} 天没有备份了` : '还没有备份过';
    return `<button class="banner banner-warn" data-action="backup">
      <span class="banner-text"><strong>${msg}</strong><span>记录只存在这部手机里。点这里保存一份备份。</span></span>
      <span class="banner-go" aria-hidden="true">›</span>
    </button>`;
  }

  function viewHome() {
    const month = L.currentMonth();
    let body = '';
    if (!storageOK) body += '<div class="banner banner-danger">⚠ 这个浏览器无法保存记录。请用 Chrome 或 Safari 的正常模式打开（不要用无痕模式）。</div>';
    body += backupBanner();
    if (!state.funds.length) {
      body += `<section class="card empty">
        <div class="empty-mark" aria-hidden="true">善</div>
        <h2>欢迎使用善款簿</h2>
        <p>先新增一个项目，例如「Bhante 医疗费用」或「Dana Parami」，再把捐款人的名单加进去。</p>
        <button class="btn btn-primary btn-block" data-action="fund-new">＋ 新增项目</button>
        <button class="btn btn-ghost btn-block" data-action="restore">从备份恢复</button>
        ${DEMO ? '' : '<button class="link-btn" data-action="demo-open">先看看示范（假资料）</button>'}
      </section>`;
    } else {
      body += `<p class="section-label">${L.monthLabel(month)}</p><div class="stack">`;
      for (const f of state.funds) {
        const s = L.monthSummary(state, f.id, month);
        const total = s.members.length;
        const pct = total ? Math.round((s.receivedCount / total) * 100) : 0;
        body += `<button class="card fund-card" data-action="go" data-to="#/f/${f.id}/m/${month}">
          <span class="fund-name">${esc(f.name)}</span>
          <span class="progress" aria-hidden="true"><span style="width:${pct}%"></span></span>
          <span class="fund-row"><span>本月已收 <b>${s.receivedCount}</b> / ${total} 人</span><b>${money(s.received)}</b></span>
          <span class="fund-row fund-row-strong"><span>手上应有</span><b>${money(L.cashOnHand(state, f.id))}</b></span>
        </button>`;
      }
      body += `</div><button class="btn btn-ghost btn-block" data-action="fund-new">＋ 新增项目</button>`;
    }
    return topbar({ title: '善款簿', right: '<button class="topbar-btn" data-action="go" data-to="#/settings">设置</button>' }) + `<main class="page">${body}</main>`;
  }

  function fundHeader(fund, tab, month) {
    const m = month || L.currentMonth();
    const tabs = [
      ['month', '每月', `#/f/${fund.id}/m/${m}`],
      ['year', '全年表', `#/f/${fund.id}/y/${m.slice(0, 4)}`],
      ['people', '名单', `#/f/${fund.id}/p`],
    ];
    return (
      topbar({ title: fund.name, back: true, right: `<button class="topbar-btn" data-action="fund-edit" data-id="${fund.id}">编辑</button>` }) +
      `<nav class="tabs" aria-label="页面">${tabs
        .map(([key, label, to]) => `<button class="tab" data-action="go-replace" data-to="${to}" aria-current="${key === tab ? 'page' : 'false'}">${label}</button>`)
        .join('')}</nav>`
    );
  }

  function viewMonth({ fund, month }) {
    const s = L.monthSummary(state, fund.id, month);
    const numbers = new Map(L.fundMembers(state, fund.id).map((m, i) => [m.id, i + 1]));
    const total = s.members.length;
    const pct = total ? Math.round((s.receivedCount / total) * 100) : 0;
    const isNow = month === L.currentMonth();
    const prepaid = L.prepaidAfter(state, fund.id, month);
    const note = (fund.monthNotes && fund.monthNotes[month]) || '';

    const people = total
      ? `<p class="hint hint-top">收到钱后，点右边的方格打勾 ✓</p>
         <ol class="people">${s.members.map((m) => personRow(m, month, numbers.get(m.id))).join('')}</ol>`
      : `<div class="card empty"><p>${L.monthLabel(month)}还没有名单。</p>
         <button class="btn btn-primary btn-block" data-action="go-replace" data-to="#/f/${fund.id}/p">去添加名单</button></div>`;

    const payoutList = s.payouts.length
      ? `<ul class="plist">${s.payouts
          .map(
            (p) => `<li><button class="prow" data-action="payout-edit" data-id="${p.id}">
              <span class="pdate">${L.shortDate(p.date)}</span>
              <span class="pnote">${esc(p.note || '交钱')}</span>
              <span class="pamt">−${money(p.amount)}</span></button></li>`
          )
          .join('')}</ul>`
      : '<p class="muted">这个月还没有交钱记录。</p>';

    return (
      fundHeader(fund, 'month', month) +
      `<main class="page">
        <div class="period-nav">
          <button class="period-btn" data-action="go-replace" data-to="#/f/${fund.id}/m/${L.addMonths(month, -1)}" aria-label="上个月">‹</button>
          <h2 class="period-title">${L.monthLabel(month)}</h2>
          <button class="period-btn" data-action="go-replace" data-to="#/f/${fund.id}/m/${L.addMonths(month, 1)}" aria-label="下个月">›</button>
        </div>
        ${isNow ? '' : `<button class="link-btn" data-action="go-replace" data-to="#/f/${fund.id}/m/${L.currentMonth()}">回到本月</button>`}

        <section class="card summary">
          <div class="summary-main">
            <span class="summary-label">本月已收</span>
            <span class="summary-big">${money(s.received)}</span>
            <span class="summary-count">${s.receivedCount} / ${total} 人</span>
          </div>
          <span class="progress" aria-hidden="true"><span style="width:${pct}%"></span></span>
          <dl class="summary-grid">
            <div><dt>上月结余</dt><dd>${money(s.opening)}</dd></div>
            <div><dt>本月交出</dt><dd>${s.paidOut ? '−' + money(s.paidOut) : money(0)}</dd></div>
            <div class="summary-total"><dt>本月结余</dt><dd>${money(s.closing)}</dd></div>
          </dl>
          ${prepaid ? `<p class="hint">另有 ${money(prepaid)} 是预先付了以后月份的。</p>` : ''}
        </section>

        ${people}

        <section class="card">
          <h3 class="card-title">交钱 / 支出</h3>
          ${payoutList}
          <button class="btn btn-ghost btn-block" data-action="payout-new" data-fund="${fund.id}" data-month="${month}">＋ 记录交钱 / 支出</button>
        </section>

        <section class="card">
          <h3 class="card-title">本月备注</h3>
          <button class="note-btn" data-action="note-edit" data-fund="${fund.id}" data-month="${month}">
            ${note ? `<span class="note-text">${esc(note)}</span>` : '<span class="muted">＋ 写备注（例如：Chiro 日期、谁出油钱）</span>'}
          </button>
        </section>

        <button class="btn btn-secondary btn-block" data-action="share-month" data-fund="${fund.id}" data-month="${month}">分享本月记录（WhatsApp）</button>
      </main>`
    );
  }

  function personRow(m, month, no) {
    const r = L.receiptOf(state, m.id, month);
    const sub = r
      ? `${L.shortDate(r.date)} 收到${r.amount !== m.pledge && m.pledge ? `（每月 ${L.fmtNum(m.pledge)}）` : ''}${r.note ? ' · ' + esc(r.note) : ''}`
      : m.pledge
        ? `每月 ${money(m.pledge)}`
        : '金额不固定';
    let tick;
    if (r) {
      tick = `<button class="tick is-paid" data-action="receipt" data-member="${m.id}" data-month="${month}" aria-label="${esc(m.name)} 已收 ${esc(money(r.amount))}，点击修改">
        <span class="tick-mark" aria-hidden="true">✓</span><span class="tick-amt">${L.fmtNum(r.amount)}</span></button>`;
    } else if (m.pledge) {
      tick = `<button class="tick" data-action="quick-pay" data-member="${m.id}" data-month="${month}" aria-label="把 ${esc(m.name)} 标记为已收 ${esc(money(m.pledge))}">
        <span class="tick-box" aria-hidden="true"></span><span class="tick-amt">未收</span></button>`;
    } else {
      tick = `<button class="tick" data-action="receipt" data-member="${m.id}" data-month="${month}" aria-label="记录 ${esc(m.name)} 的金额">
        <span class="tick-box" aria-hidden="true"></span><span class="tick-amt">记录</span></button>`;
    }
    return `<li class="person${r ? ' is-paid' : ''}">
      <button class="person-main" data-action="receipt" data-member="${m.id}" data-month="${month}">
        <span class="num">${no}</span>
        <span class="pinfo"><span class="pname">${esc(m.name)}</span><span class="psub">${sub}</span></span>
      </button>
      ${tick}
    </li>`;
  }

  function viewYear({ fund, year }) {
    const g = L.yearGrid(state, fund.id, year);
    const now = L.currentMonth();
    const head = g.months.map((m) => `<th scope="col">${+m.slice(5)}月</th>`).join('');
    const body = g.rows
      .map((r) => {
        const cells = r.cells
          .map((c) => {
            let cls = 'cell';
            let text = '';
            if (c.receipt) { cls += ' paid'; text = L.fmtNum(c.receipt.amount); }
            else if (!c.active) { cls += ' off'; text = '–'; }
            else if (c.month <= now) { cls += ' due'; }
            const label = `${r.member.name} ${L.monthLabel(c.month)}${c.receipt ? ' 已收 ' + L.fmtNum(c.receipt.amount) : ' 未收'}`;
            return `<td class="${cls}"><button data-action="receipt" data-member="${r.member.id}" data-month="${c.month}" aria-label="${esc(label)}">${text}</button></td>`;
          })
          .join('');
        const ended = r.member.endMonth && r.member.endMonth < now;
        return `<tr${ended ? ' class="ended"' : ''}><th scope="row" class="name-col"><span class="gnum">${r.no}</span><span class="gname">${esc(r.member.name)}</span>${
          r.member.pledge ? `<span class="gpledge">每月 ${L.fmtNum(r.member.pledge)}</span>` : ''
        }</th>${cells}<td class="total">${L.fmtNum(r.total)}</td></tr>`;
      })
      .join('');

    const foot = `
      <tr class="sum-row"><th scope="row" class="name-col">收到合计</th>${g.received.map((v) => `<td>${v ? L.fmtNum(v) : ''}</td>`).join('')}<td class="total">${L.fmtNum(g.totalReceived)}</td></tr>
      <tr class="out-row"><th scope="row" class="name-col">交出<span class="gpledge">交钱日期</span></th>${g.payouts
        .map((list, i) => {
          const amt = g.paidOut[i];
          const dates = list.map((p) => L.shortDate(p.date)).join(' ');
          return `<td><button data-action="go-replace" data-to="#/f/${fund.id}/m/${g.months[i]}" aria-label="${L.monthLabel(g.months[i])} 交出">${amt ? L.fmtNum(amt) : ''}${dates ? `<span class="gdate">${dates}</span>` : ''}</button></td>`;
        })
        .join('')}<td class="total">${L.fmtNum(g.totalPaidOut)}</td></tr>
      <tr class="bal-row"><th scope="row" class="name-col">结余</th>${g.balance.map((v, i) => `<td>${g.months[i] <= now ? L.fmtNum(v) : ''}</td>`).join('')}<td class="total"></td></tr>
      ${g.notes.some(Boolean) ? `<tr class="note-row"><th scope="row" class="name-col">备注</th>${g.notes.map((n) => `<td>${esc(n)}</td>`).join('')}<td></td></tr>` : ''}`;

    const table = g.rows.length
      ? `<div class="grid-wrap" tabindex="0" aria-label="${year}年 全年表，可以左右滑动">
          <table class="grid">
            <thead><tr><th scope="col" class="name-col">名字</th>${head}<th scope="col">合计</th></tr></thead>
            <tbody>${body}</tbody>
            <tfoot>${foot}</tfoot>
          </table></div>`
      : `<div class="card empty"><p>${year}年还没有名单。</p>
          <button class="btn btn-primary btn-block" data-action="go-replace" data-to="#/f/${fund.id}/p">去添加名单</button></div>`;

    return (
      fundHeader(fund, 'year', `${year}-${now.slice(5)}`) +
      `<main class="page page-wide">
        <div class="period-nav">
          <button class="period-btn" data-action="go-replace" data-to="#/f/${fund.id}/y/${year - 1}" aria-label="上一年">‹</button>
          <h2 class="period-title">${year}年</h2>
          <button class="period-btn" data-action="go-replace" data-to="#/f/${fund.id}/y/${year + 1}" aria-label="下一年">›</button>
        </div>
        <h2 class="print-title">${esc(fund.name)} · ${year}年</h2>
        <p class="hint no-print">表格可以左右滑动。点格子可以记录或修改。</p>
        ${table}
        <dl class="year-totals">
          <div><dt>上年结余</dt><dd>${money(g.opening)}</dd></div>
          <div><dt>全年收到</dt><dd>${money(g.totalReceived)}</dd></div>
          <div><dt>全年交出</dt><dd>${money(g.totalPaidOut)}</dd></div>
          <div class="summary-total"><dt>年底结余</dt><dd>${money(g.balance[11])}</dd></div>
        </dl>
        <div class="actions no-print">
          <button class="btn btn-secondary btn-block" data-action="print">打印 / 存成 PDF</button>
          <button class="btn btn-ghost btn-block" data-action="export-csv" data-fund="${fund.id}" data-year="${year}">导出 Excel 表格</button>
        </div>
      </main>`
    );
  }

  function viewPeople({ fund }) {
    const list = L.fundMembers(state, fund.id);
    const now = L.currentMonth();
    const rows = list
      .map((m, i) => {
        const ended = m.endMonth && m.endMonth < now;
        const range = `${L.monthLabel(m.startMonth)}起${m.endMonth ? ` · 到${L.monthLabel(m.endMonth)}` : ''}`;
        return `<li class="roster-item${ended ? ' ended' : ''}">
          <button class="roster-main" data-action="member-edit" data-id="${m.id}">
            <span class="num">${i + 1}</span>
            <span class="pinfo"><span class="pname">${esc(m.name)}${ended ? ' <span class="tag">已停止</span>' : ''}</span>
            <span class="psub">${m.pledge ? `每月 ${money(m.pledge)}` : '金额不固定'} · ${range}</span>
            ${m.note ? `<span class="psub">${esc(m.note)}</span>` : ''}</span>
          </button>
          <span class="order-btns">
            <button class="order-btn" data-action="move" data-id="${m.id}" data-dir="-1" aria-label="把 ${esc(m.name)} 往上移"${i === 0 ? ' disabled' : ''}>↑</button>
            <button class="order-btn" data-action="move" data-id="${m.id}" data-dir="1" aria-label="把 ${esc(m.name)} 往下移"${i === list.length - 1 ? ' disabled' : ''}>↓</button>
          </span>
        </li>`;
      })
      .join('');
    return (
      fundHeader(fund, 'people') +
      `<main class="page">
        <div class="btn-row">
          <button class="btn btn-primary" data-action="member-new" data-fund="${fund.id}">＋ 添加一人</button>
          <button class="btn btn-secondary" data-action="bulk" data-fund="${fund.id}">一次添加多人</button>
        </div>
        ${list.length ? `<p class="section-label">共 ${list.length} 人</p><ol class="roster">${rows}</ol>` : '<div class="card empty"><p>还没有名单。可以一个一个添加，或者一次贴上多人。</p></div>'}
      </main>`
    );
  }

  function viewSettings() {
    const st = state.settings;
    const sizes = [['normal', '标准'], ['large', '大'], ['xlarge', '特大']];
    const counts = `${state.funds.length} 个项目 · ${state.members.length} 人 · ${state.receipts.length} 笔收款 · ${state.payouts.length} 笔交出`;
    return (
      topbar({ title: '设置', back: true }) +
      `<main class="page">
        <section class="card">
          <h3 class="card-title">备份</h3>
          <p>所有记录只存在<strong>这部手机</strong>里。手机换了、坏了、或清除了浏览器资料，记录就会不见。请常常保存备份，并发一份给家人。</p>
          <p class="hint">Android 手机的备份会存到「下载」(Download) 文件夹。</p>
          <p class="muted">${st.lastBackupAt ? `上次备份：${new Date(st.lastBackupAt).toLocaleString('zh-CN')}` : '还没有备份过'}</p>
          <button class="btn btn-primary btn-block" data-action="backup">保存备份文件</button>
          <button class="btn btn-ghost btn-block" data-action="restore">从备份文件恢复</button>
          <p class="hint">${counts}</p>
        </section>
        <section class="card">
          <h3 class="card-title">字体大小</h3>
          <div class="segmented" role="radiogroup" aria-label="字体大小">
            ${sizes.map(([k, label]) => `<button role="radio" aria-checked="${st.fontSize === k}" data-action="font" data-size="${k}">${label}</button>`).join('')}
          </div>
        </section>
        <section class="card">
          <h3 class="card-title">货币</h3>
          <form data-form="currency" class="inline-form">
            <input class="input" name="currency" value="${esc(st.currency)}" maxlength="8" aria-label="货币符号">
            <button class="btn btn-secondary" type="submit">保存</button>
          </form>
        </section>
        <p class="about">善款簿 ${APP_VERSION} · 不需要上网也能用</p>
      </main>`
    );
  }

  let lastGridScroll = 0;
  function render() {
    document.documentElement.dataset.font = state.settings.fontSize || 'large';
    const wrap = app.querySelector('.grid-wrap');
    if (wrap) lastGridScroll = wrap.scrollLeft;
    const r = route();
    let html;
    if (r.name === 'month') html = viewMonth(r);
    else if (r.name === 'year') html = viewYear(r);
    else if (r.name === 'people') html = viewPeople(r);
    else if (r.name === 'settings') html = viewSettings();
    else html = viewHome();
    if (DEMO) {
      html =
        `<div class="demo-bar" role="note"><span class="demo-text"><strong>示范模式</strong>：全是假资料，可以随便点。</span>
          <button class="demo-btn" data-action="demo-reset">重来</button>
          <button class="demo-btn" data-action="demo-exit">离开示范</button></div>` + html;
    }
    app.innerHTML = html;
    document.title = (DEMO ? '示范 · ' : '') + (r.fund ? `${r.fund.name} · 善款簿` : '善款簿');
    const newWrap = app.querySelector('.grid-wrap');
    if (newWrap) newWrap.scrollLeft = lastGridScroll;
  }

  // ================================================================ sheets
  let sheetOpen = false;
  let sheet = null; // { onSubmit, onInput, ctx }
  let lastFocus = null;

  function openSheet({ title, sub = '', body, onSubmit, onInput, ctx = {} }) {
    lastFocus = document.activeElement;
    sheet = { onSubmit, onInput, ctx };
    sheetRoot.innerHTML = `<div class="sheet-backdrop" data-action="sheet-close"></div>
      <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
        <div class="sheet-head">
          <div><h2 id="sheet-title">${esc(title)}</h2>${sub ? `<p class="sheet-sub">${sub}</p>` : ''}</div>
          <button type="button" class="sheet-x" data-action="sheet-close" aria-label="关闭">✕</button>
        </div>
        <form class="sheet-form" novalidate>${body}<p class="form-error" role="alert"></p></form>
      </div>`;
    document.body.classList.add('has-sheet');
    if (!sheetOpen) history.pushState({ ...(history.state || {}), sheet: true }, '');
    sheetOpen = true;
    if (onInput) onInput(sheetForm());
    requestAnimationFrame(() => {
      sheetRoot.classList.add('open');
      const first = sheetRoot.querySelector('[autofocus]') || sheetRoot.querySelector('.sheet-x');
      if (first) first.focus({ preventScroll: true });
    });
  }
  const sheetForm = () => sheetRoot.querySelector('.sheet-form');
  function sheetError(msg) {
    const el = sheetRoot.querySelector('.form-error');
    if (el) el.textContent = msg || '';
  }
  let sheetClosedWaiters = [];
  function hideSheet() {
    sheetOpen = false;
    sheet = null;
    sheetRoot.classList.remove('open');
    sheetRoot.innerHTML = '';
    document.body.classList.remove('has-sheet');
    if (lastFocus && document.contains(lastFocus)) lastFocus.focus({ preventScroll: true });
    const waiters = sheetClosedWaiters;
    sheetClosedWaiters = [];
    waiters.forEach((w) => w());
  }
  /** Close the open sheet. Resolves once it is gone and history is back on the page entry. */
  function closeSheet() {
    if (!sheetOpen) return Promise.resolve();
    return new Promise((resolve) => {
      sheetClosedWaiters.push(resolve);
      if (history.state && history.state.sheet) history.back(); // popstate hides it
      else hideSheet();
    });
  }

  // ---------------------------------------------------------------- receipt sheet
  function openReceiptSheet(memberId, month) {
    const m = L.getMember(state, memberId);
    if (!m) return;
    const r = L.receiptOf(state, memberId, month);
    const amount = r ? r.amount : m.pledge;
    openSheet({
      title: m.name,
      sub: `${L.monthLabel(month)}${m.pledge ? ` · 每月 ${esc(money(m.pledge))}` : ''}`,
      ctx: { memberId, month, existing: r },
      body: `
        <label class="field"><span class="field-label" data-role="amount-label">金额（${esc(cur())}）</span>
          <input class="input input-money" name="amount" inputmode="decimal" autocomplete="off" value="${amount ? L.fmtPlain(amount) : ''}" placeholder="0"${amount ? '' : ' autofocus'}></label>
        <label class="field"><span class="field-label">收到日期</span>
          <input class="input" type="date" name="date" value="${r ? r.date : L.todayISO()}"></label>
        ${r ? '' : `<div class="field"><span class="field-label">这次付了几个月？</span>
          <div class="stepper">
            <button type="button" class="step" data-action="step" data-d="-1" aria-label="少一个月">−</button>
            <output class="step-val" data-role="count">1</output>
            <button type="button" class="step" data-action="step" data-d="1" aria-label="多一个月">＋</button>
          </div>
          <p class="hint" data-role="count-hint"></p></div>`}
        <label class="field"><span class="field-label">备注（可以不填）</span>
          <input class="input" name="note" value="${esc(r ? r.note : '')}" placeholder="例如：转账、已付全年" autocomplete="off"></label>
        <div class="sheet-actions">
          <button type="submit" class="btn btn-primary btn-block">${r ? '保存修改' : '✓ 确认收到'}</button>
          ${r ? '<button type="button" class="btn btn-danger btn-block" data-action="receipt-delete">取消这笔收款</button>' : ''}
        </div>`,
      onInput: (form) => {
        const out = form.querySelector('[data-role="count"]');
        if (!out) return;
        const n = +out.textContent;
        const months = L.nextUnpaidMonths(state, memberId, month, n);
        const each = L.parseAmount(field(form, 'amount').value);
        form.querySelector('[data-role="amount-label"]').textContent = n > 1 ? `每个月金额（${cur()}）` : `金额（${cur()}）`;
        const span = months.length > 1 ? `${L.monthLabel(months[0])} 到 ${L.monthLabel(months[months.length - 1])}` : L.monthLabel(months[0]);
        const skipped = months.length && months[months.length - 1] !== L.addMonths(month, n - 1) ? '（已付的月份会跳过）' : '';
        form.querySelector('[data-role="count-hint"]').textContent = n > 1 ? `${span}，共 ${n} 个月${each ? `，合计 ${money(each * n)}` : ''}${skipped}` : '';
      },
      onSubmit: (form) => {
        const amt = L.parseAmount(field(form, 'amount').value);
        if (!amt) return sheetError('请输入正确的金额，例如 10 或 10.50');
        const date = field(form, 'date').value;
        if (!L.isDate(date)) return sheetError('请选择收到的日期');
        const countEl = form.querySelector('[data-role="count"]');
        const n = countEl ? +countEl.textContent : 1;
        const note = field(form, 'note').value;
        if (r || n === 1) {
          mutate((s) => L.setReceipt(s, { memberId, month, amount: amt, date, note }));
          closeSheet();
          showToast(r ? '已修改' : `已记录：${m.name} ${L.monthShort(month)} ${money(amt)}`);
        } else {
          const made = mutate((s) => L.prepay(s, { memberId, fromMonth: month, count: n, amountEach: amt, date, note }));
          closeSheet();
          showToast(`已记录 ${made.length} 个月，合计 ${money(amt * made.length)}`, {
            actionLabel: '撤销',
            action: () => mutate((s) => made.forEach((x) => L.removeReceipt(s, x.memberId, x.month))),
          });
        }
      },
    });
  }

  function quickPay(memberId, month) {
    const m = L.getMember(state, memberId);
    if (!m || !m.pledge) return openReceiptSheet(memberId, month);
    mutate((s) => L.setReceipt(s, { memberId, month, amount: m.pledge, date: L.todayISO() }));
    showToast(`✓ ${m.name} ${L.monthShort(month)} ${money(m.pledge)}`, {
      actionLabel: '撤销',
      action: () => mutate((s) => L.removeReceipt(s, memberId, month)),
    });
  }

  // ---------------------------------------------------------------- payout sheet
  function openPayoutSheet({ fundId, id, month }) {
    const p = id ? L.getPayout(state, id) : null;
    const mo = p ? p.month : month;
    const notes = [...new Set(state.payouts.filter((x) => x.fundId === fundId && x.note).map((x) => x.note))].slice(-12);
    openSheet({
      title: p ? '修改交钱 / 支出' : '记录交钱 / 支出',
      ctx: { fundId, id },
      body: `
        <label class="field"><span class="field-label">属于哪个月</span>
          <select class="input" name="month">${monthOptions(mo)}</select></label>
        <label class="field"><span class="field-label">交钱日期</span>
          <input class="input" type="date" name="date" value="${p ? p.date : L.todayISO()}"></label>
        <label class="field"><span class="field-label">金额（${esc(cur())}）</span>
          <input class="input input-money" name="amount" inputmode="decimal" autocomplete="off" value="${p ? L.fmtPlain(p.amount) : ''}" placeholder="0"${p ? '' : ' autofocus'}></label>
        <p class="hint" data-role="month-hint"></p>
        <label class="field"><span class="field-label">交给谁 / 用在哪里</span>
          <input class="input" name="note" list="payout-notes" value="${esc(p ? p.note : '')}" placeholder="例如：交给 Bhante、做茶点" autocomplete="off"></label>
        <datalist id="payout-notes">${notes.map((n) => `<option value="${esc(n)}">`).join('')}</datalist>
        <div class="sheet-actions">
          <button type="submit" class="btn btn-primary btn-block">保存</button>
          ${p ? '<button type="button" class="btn btn-danger btn-block" data-action="payout-delete">删除这笔记录</button>' : ''}
        </div>`,
      onInput: (form) => {
        const sm = L.monthSummary(state, fundId, field(form, 'month').value);
        const left = sm.received - sm.paidOut + (p && p.month === field(form, 'month').value ? p.amount : 0);
        const hint = form.querySelector('[data-role="month-hint"]');
        hint.innerHTML = `${L.monthLabel(field(form, 'month').value)}已收 ${esc(money(sm.received))}${
          !p && left > 0 ? ` <button type="button" class="link-btn" data-action="fill-amount" data-value="${L.fmtPlain(left)}">填入 ${esc(money(left))}</button>` : ''
        }`;
      },
      onSubmit: (form) => {
        const amount = L.parseAmount(field(form, 'amount').value);
        if (!amount) return sheetError('请输入正确的金额');
        const data = { fundId, month: field(form, 'month').value, date: field(form, 'date').value, amount, note: field(form, 'note').value };
        try {
          mutate((s) => (p ? L.updatePayout(s, p.id, data) : L.addPayout(s, data)));
        } catch (e) {
          return sheetError(e.message);
        }
        closeSheet();
        showToast(p ? '已修改' : `已记录交出 ${money(amount)}`);
      },
    });
  }

  // ---------------------------------------------------------------- member sheets
  function openMemberSheet({ fundId, id }) {
    const m = id ? L.getMember(state, id) : null;
    const hasReceipts = m && L.memberHasReceipts(state, m.id);
    openSheet({
      title: m ? '修改资料' : '添加一人',
      ctx: { fundId, id },
      body: `
        <label class="field"><span class="field-label">名字</span>
          <input class="input" name="name" value="${esc(m ? m.name : '')}" placeholder="例如：陈美玲 / 陈家合家" autocomplete="off"${m ? '' : ' autofocus'}></label>
        <label class="field"><span class="field-label">每月金额（${esc(cur())}）</span>
          <input class="input input-money" name="pledge" inputmode="decimal" autocomplete="off" value="${m && m.pledge ? L.fmtPlain(m.pledge) : ''}" placeholder="不固定就留空"></label>
        <label class="field"><span class="field-label">从哪个月开始</span>
          <select class="input" name="startMonth">${monthOptions(m ? m.startMonth : L.currentMonth())}</select></label>
        <label class="field"><span class="field-label">到哪个月停止</span>
          <select class="input" name="endMonth">${monthOptions(m ? m.endMonth : null, { allowNone: true, noneLabel: '一直捐（没有停止）' })}</select></label>
        <label class="field"><span class="field-label">备注（可以不填）</span>
          <input class="input" name="note" value="${esc(m ? m.note : '')}" placeholder="例如：已故、电话号码" autocomplete="off"></label>
        <div class="sheet-actions">
          <button type="submit" class="btn btn-primary btn-block">保存</button>
          ${m ? (hasReceipts ? '<p class="hint">这个人已有收款记录，所以不能删除。如果不再捐，请设定“到哪个月停止”。</p>' : '<button type="button" class="btn btn-danger btn-block" data-action="member-delete">删除这个人</button>') : ''}
        </div>`,
      onSubmit: (form) => {
        const pledgeRaw = field(form, 'pledge').value.trim();
        const pledge = pledgeRaw ? L.parseAmount(pledgeRaw) : 0;
        if (pledge == null) return sheetError('每月金额不对，例如 10 或留空');
        const data = { fundId, name: field(form, 'name').value, pledge, startMonth: field(form, 'startMonth').value, endMonth: field(form, 'endMonth').value || null, note: field(form, 'note').value };
        try {
          mutate((s) => (m ? L.updateMember(s, m.id, data) : L.addMember(s, data)));
        } catch (e) {
          return sheetError(e.message);
        }
        closeSheet();
        showToast(m ? '已保存' : `已添加：${data.name.trim()}`);
      },
    });
  }

  function openBulkSheet(fundId) {
    openSheet({
      title: '一次添加多人',
      sub: '每行一个人：名字，后面加每月金额',
      ctx: { fundId },
      body: `
        <label class="field"><span class="field-label">名单</span>
          <textarea class="input textarea" name="text" rows="8" placeholder="陈美玲 10&#10;林志明、黄淑芬 20&#10;Tan Ah Kow 合家 10&#10;王小华" autofocus></textarea></label>
        <label class="field"><span class="field-label">从哪个月开始</span>
          <select class="input" name="startMonth">${monthOptions(L.currentMonth())}</select></label>
        <p class="hint">如果选更早的月份，那些月份会显示红色（未收），要在「全年表」里把旧记录补上。只想从现在开始记，就选本月。</p>
        <div class="bulk-preview" data-role="preview"></div>
        <div class="sheet-actions"><button type="submit" class="btn btn-primary btn-block" data-role="bulk-submit">添加</button></div>`,
      onInput: (form) => {
        const rows = L.parseBulkMembers(field(form, 'text').value);
        form.querySelector('[data-role="bulk-submit"]').textContent = rows.length ? `添加 ${rows.length} 人` : '添加';
        form.querySelector('[data-role="preview"]').innerHTML = rows.length
          ? `<p class="section-label">会添加：</p><ol class="preview-list">${rows
              .map((r) => `<li><span>${esc(r.name)}</span><span>${r.pledge ? esc(money(r.pledge)) : '<span class="muted">不固定</span>'}</span></li>`)
              .join('')}</ol>`
          : '';
      },
      onSubmit: (form) => {
        const rows = L.parseBulkMembers(field(form, 'text').value);
        if (!rows.length) return sheetError('请先输入名单');
        try {
          mutate((s) => L.addMembersBulk(s, fundId, rows, field(form, 'startMonth').value));
        } catch (e) {
          return sheetError(e.message);
        }
        closeSheet();
        showToast(`已添加 ${rows.length} 人`);
      },
    });
  }

  // ---------------------------------------------------------------- fund sheet
  function openFundSheet(id) {
    const f = id ? L.getFund(state, id) : null;
    openSheet({
      title: f ? '修改项目' : '新增项目',
      ctx: { id },
      body: `
        <label class="field"><span class="field-label">项目名称</span>
          <input class="input" name="name" value="${esc(f ? f.name : '')}" placeholder="例如：Bhante 医疗费用" autocomplete="off"${f ? '' : ' autofocus'}></label>
        <label class="field"><span class="field-label">开始时手上已有的钱（${esc(cur())}）</span>
          <input class="input input-money" name="opening" inputmode="decimal" autocomplete="off" value="${f && f.opening ? L.fmtPlain(f.opening) : ''}" placeholder="没有就留空"></label>
        <p class="hint">开始用这个 App 之前，这个项目已经存下的钱。</p>
        <label class="field"><span class="field-label">说明（可以不填）</span>
          <input class="input" name="note" value="${esc(f ? f.note : '')}" placeholder="例如：师父看脊椎治疗" autocomplete="off"></label>
        <div class="sheet-actions">
          <button type="submit" class="btn btn-primary btn-block">保存</button>
          ${f ? '<button type="button" class="btn btn-danger btn-block" data-action="fund-delete">删除整个项目</button>' : ''}
        </div>`,
      onSubmit: (form) => {
        const raw = field(form, 'opening').value.trim();
        const opening = raw ? L.parseAmount(raw) : 0;
        if (opening == null) return sheetError('金额不对');
        let created;
        try {
          created = mutate((s) => (f ? L.updateFund(s, f.id, { name: field(form, 'name').value, opening, note: field(form, 'note').value }) : L.addFund(s, { name: field(form, 'name').value, opening, note: field(form, 'note').value })));
        } catch (e) {
          return sheetError(e.message);
        }
        closeSheet().then(() => {
          if (!f) nav(`#/f/${created.id}/p`);
        });
        showToast(f ? '已保存' : '项目已建立，现在添加名单');
      },
    });
  }

  function openNoteSheet(fundId, month) {
    const f = L.getFund(state, fundId);
    openSheet({
      title: '本月备注',
      sub: L.monthLabel(month),
      body: `
        <label class="field"><span class="field-label visually-hidden">备注</span>
          <textarea class="input textarea" name="text" rows="5" placeholder="例如：9/1 看医生，谁出油钱" autofocus>${esc((f.monthNotes && f.monthNotes[month]) || '')}</textarea></label>
        <div class="sheet-actions"><button type="submit" class="btn btn-primary btn-block">保存</button></div>`,
      onSubmit: (form) => {
        mutate((s) => L.setMonthNote(s, fundId, month, field(form, 'text').value));
        closeSheet();
      },
    });
  }

  // ================================================================ confirm
  let confirmOpen = false;
  let confirmResolve = null;
  function confirmBox({ title, message = '', ok = '确定', cancel = '不要', danger = false }) {
    return new Promise((resolve) => {
      confirmResolve = resolve;
      confirmOpen = true;
      confirmRoot.innerHTML = `<div class="sheet-backdrop" data-action="confirm-no"></div>
        <div class="confirm" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-msg">
          <h2 id="confirm-title">${esc(title)}</h2>
          ${message ? `<p id="confirm-msg">${message}</p>` : ''}
          <div class="confirm-actions">
            <button class="btn ${danger ? 'btn-danger-solid' : 'btn-primary'} btn-block" data-action="confirm-yes">${esc(ok)}</button>
            <button class="btn btn-ghost btn-block" data-action="confirm-no">${esc(cancel)}</button>
          </div>
        </div>`;
      confirmRoot.classList.add('open');
      confirmRoot.querySelector('[data-action="confirm-no"].btn').focus();
    });
  }
  function closeConfirm(value) {
    confirmOpen = false;
    confirmRoot.classList.remove('open');
    confirmRoot.innerHTML = '';
    const r = confirmResolve;
    confirmResolve = null;
    if (r) r(value);
  }

  // ================================================================ toast
  let toastTimer = null;
  let toastAction = null;
  function showToast(msg, { actionLabel, action, ms } = {}) {
    toastAction = action || null;
    toastRoot.innerHTML = `<div class="toast-inner"><span class="toast-msg">${esc(msg)}</span>${
      actionLabel ? `<button class="toast-btn" data-action="toast-action">${esc(actionLabel)}</button>` : ''
    }</div>`;
    toastRoot.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, ms || (actionLabel ? 7000 : 3000));
  }
  function hideToast() {
    toastRoot.classList.remove('show');
    toastAction = null;
  }

  // ================================================================ files & sharing
  /** Share the file (phone share sheet) or download it. Returns 'shared', 'downloaded' or false if cancelled. */
  async function shareOrDownload(filename, text, type) {
    const blob = new Blob([text], { type });
    try {
      const file = new File([blob], filename, { type });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: filename });
        return 'shared';
      }
    } catch (e) {
      if (e && e.name === 'AbortError') return false;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    return 'downloaded';
  }

  async function doBackup() {
    const how = await shareOrDownload(`${DEMO ? '善款簿示范' : '善款簿备份'}-${L.todayISO()}.json`, L.backupJSON(state), 'application/json');
    if (!how) return;
    state.settings.lastBackupAt = Date.now();
    state.settings.changesSinceBackup = 0;
    persist();
    render();
    showToast(
      how === 'downloaded'
        ? '备份已存到手机的「下载」文件夹。可以在 WhatsApp 点附件 → 文件，选这个文件发给家人。'
        : '备份已保存。可以发一份给家人保管。',
      { ms: 9000 }
    );
  }

  async function doRestore(file) {
    let parsed;
    try {
      parsed = L.normalizeState(JSON.parse(await file.text()));
    } catch (e) {
      showToast('打不开这个文件：' + (e.message || '格式不对'), { ms: 6000 });
      return;
    }
    const n = parsed.state;
    const yes = await confirmBox({
      title: '用这个备份取代现在的记录？',
      message: `备份里有 ${n.funds.length} 个项目、${n.members.length} 人、${n.receipts.length} 笔收款。<br>手机里<strong>现在的记录会被取代</strong>。`,
      ok: '是，恢复备份',
      danger: true,
    });
    if (!yes) return;
    try { localStorage.setItem(STORE_KEY + ':before-restore', JSON.stringify(state)); } catch (_) { /* ignore */ }
    state = n;
    state.settings.lastBackupAt = Date.now();
    state.settings.changesSinceBackup = 0;
    persist();
    nav('#/', true);
    showToast(`已恢复${parsed.dropped ? `（有 ${parsed.dropped} 笔坏掉的记录被跳过）` : ''}`, { ms: 5000 });
  }

  async function shareText(text) {
    if (navigator.share) {
      try {
        await navigator.share({ text });
        return;
      } catch (e) {
        if (e && e.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      showToast('已复制，可以贴到 WhatsApp');
    } catch (_) {
      showToast('无法分享，请截图');
    }
  }

  // ================================================================ events
  const actions = {
    go: (el) => nav(el.dataset.to),
    'go-replace': (el) => nav(el.dataset.to, true),
    back: () => goBack(),

    'quick-pay': (el) => quickPay(el.dataset.member, el.dataset.month),
    receipt: (el) => openReceiptSheet(el.dataset.member, el.dataset.month),
    'receipt-delete': async () => {
      const { memberId, month, existing } = sheet.ctx;
      const m = L.getMember(state, memberId);
      const yes = await confirmBox({ title: '取消这笔收款？', message: `${esc(m.name)} ${L.monthLabel(month)} ${esc(money(existing.amount))}`, ok: '是，取消收款', danger: true });
      if (!yes) return;
      const removed = mutate((s) => L.removeReceipt(s, memberId, month));
      closeSheet();
      showToast('已取消这笔收款', { actionLabel: '撤销', action: () => mutate((s) => L.restoreReceipt(s, removed)) });
    },
    step: (el) => {
      const out = sheetForm().querySelector('[data-role="count"]');
      out.textContent = Math.min(24, Math.max(1, +out.textContent + +el.dataset.d));
      sheet.onInput(sheetForm());
    },

    'payout-new': (el) => openPayoutSheet({ fundId: el.dataset.fund, month: el.dataset.month }),
    'payout-edit': (el) => {
      const p = L.getPayout(state, el.dataset.id);
      if (p) openPayoutSheet({ fundId: p.fundId, id: p.id });
    },
    'payout-delete': async () => {
      const p = L.getPayout(state, sheet.ctx.id);
      const yes = await confirmBox({ title: '删除这笔交钱记录？', message: `${L.shortDate(p.date)} ${esc(money(p.amount))} ${esc(p.note)}`, ok: '是，删除', danger: true });
      if (!yes) return;
      const removed = mutate((s) => L.removePayout(s, p.id));
      closeSheet();
      showToast('已删除', { actionLabel: '撤销', action: () => mutate((s) => L.restorePayout(s, removed)) });
    },
    'fill-amount': (el) => {
      field(sheetForm(), 'amount').value = el.dataset.value;
    },

    'note-edit': (el) => openNoteSheet(el.dataset.fund, el.dataset.month),
    'share-month': (el) => shareText(L.monthShareText(state, el.dataset.fund, el.dataset.month)),

    'member-new': (el) => openMemberSheet({ fundId: el.dataset.fund }),
    'member-edit': (el) => {
      const m = L.getMember(state, el.dataset.id);
      if (m) openMemberSheet({ fundId: m.fundId, id: m.id });
    },
    'member-delete': async () => {
      const m = L.getMember(state, sheet.ctx.id);
      const yes = await confirmBox({ title: `删除「${m.name}」？`, ok: '是，删除', danger: true });
      if (!yes) return;
      try {
        mutate((s) => L.deleteMember(s, m.id));
      } catch (e) {
        return sheetError(e.message);
      }
      closeSheet();
      showToast('已删除');
    },
    move: (el) => mutate((s) => L.moveMember(s, el.dataset.id, +el.dataset.dir)),
    bulk: (el) => openBulkSheet(el.dataset.fund),

    'fund-new': () => openFundSheet(null),
    'fund-edit': (el) => openFundSheet(el.dataset.id),
    'fund-delete': async () => {
      const f = L.getFund(state, sheet.ctx.id);
      const people = L.fundMembers(state, f.id).length;
      const recs = state.receipts.filter((r) => r.fundId === f.id).length + state.payouts.filter((p) => p.fundId === f.id).length;
      const yes = await confirmBox({
        title: `删除整个「${f.name}」？`,
        message: `会同时删除 ${people} 人和 ${recs} 笔记录。<strong>删除后不能恢复</strong>（除非有备份）。`,
        ok: '是，全部删除',
        danger: true,
      });
      if (!yes) return;
      await closeSheet();
      mutate((s) => L.deleteFund(s, f.id));
      nav('#/', true);
      showToast('项目已删除');
    },

    'export-csv': (el) => {
      const f = L.getFund(state, el.dataset.fund);
      shareOrDownload(`${f.name}-${el.dataset.year}.csv`, L.yearCSV(state, f.id, +el.dataset.year), 'text/csv');
    },
    print: () => window.print(),

    backup: () => doBackup(),
    restore: () => restoreInput.click(),
    font: (el) => {
      state.settings.fontSize = el.dataset.size;
      persist();
      render();
    },

    'demo-open': () => {
      location.href = location.pathname + '?demo';
    },
    'demo-exit': () => {
      location.href = location.pathname;
    },
    'demo-reset': async () => {
      const yes = await confirmBox({ title: '把示范资料重来一次？', message: '你在示范里改过的东西会还原。真正的记录不受影响。', ok: '重来' });
      if (!yes) return;
      try { localStorage.removeItem(STORE_KEY); } catch (_) { /* ignore */ }
      state = loadState();
      nav('#/', true);
    },

    'sheet-close': () => closeSheet(),
    'confirm-yes': () => closeConfirm(true),
    'confirm-no': () => closeConfirm(false),
    'toast-action': () => {
      const fn = toastAction;
      hideToast();
      if (fn) fn();
    },
  };

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el || el.disabled) return;
    const fn = actions[el.dataset.action];
    if (!fn) return;
    e.preventDefault();
    fn(el, e);
  });

  document.addEventListener('submit', (e) => {
    const form = e.target;
    e.preventDefault();
    if (form.classList.contains('sheet-form') && sheet && sheet.onSubmit) {
      sheetError('');
      sheet.onSubmit(form);
    } else if (form.dataset.form === 'currency') {
      state.settings.currency = field(form, 'currency').value.trim().slice(0, 8);
      persist();
      render();
      showToast('已保存');
    }
  });

  sheetRoot.addEventListener('input', () => {
    if (sheet && sheet.onInput) sheet.onInput(sheetForm());
  });
  sheetRoot.addEventListener('change', () => {
    if (sheet && sheet.onInput) sheet.onInput(sheetForm());
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (confirmOpen) closeConfirm(false);
    else if (sheetOpen) closeSheet();
  });

  restoreInput.addEventListener('change', () => {
    const file = restoreInput.files && restoreInput.files[0];
    restoreInput.value = '';
    if (file) doRestore(file);
  });

  // Another tab or window changed the data: reload it so we never overwrite newer records.
  window.addEventListener('storage', (e) => {
    if (e.key === STORE_KEY) {
      state = loadState();
      render();
    }
  });

  // ================================================================ service worker
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('SW registration failed', err));
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController) showToast('善款簿已更新', { actionLabel: '重新打开', action: () => location.reload(), ms: 15000 });
    });
  }

  render();
})();
