/*
 * 善款簿 — sample data for demo mode (open the app with ?demo).
 * Every name here is made up. The data is built relative to "now" so the demo
 * always shows the current year: most months paid, a few gaps, this month half done.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LedgerDemo = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** Small seeded random generator so the demo looks the same every time. */
  function seeded(seed) {
    return function () {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function build(L, now = new Date()) {
    const s = L.emptyState();
    const rand = seeded(2026);
    const today = L.todayISO(now);
    const cur = L.currentMonth(now);
    const year = cur.slice(0, 4);
    const jan = `${year}-01`;
    const RM = (n) => Math.round(n * 100);
    const pad = (n) => String(n).padStart(2, '0');
    /** A date inside `month` between day lo and hi, never later than today. */
    const dateIn = (month, lo, hi) => {
      const d = `${month}-${pad(lo + Math.floor(rand() * (hi - lo + 1)))}`;
      return d > today ? today : d;
    };
    const monthsUpTo = (from, to) => {
      const out = [];
      for (let m = from; m <= to; m = L.addMonths(m, 1)) out.push(m);
      return out;
    };

    // ------------------------------------------------ fund 1: monthly medical fees
    const med = L.addFund(s, { name: 'Bhante 医疗费用', opening: RM(120), note: '师父每月看脊椎治疗（Chiropractic）' });
    const people = [
      ['陈美玲', 10],
      ['林志明、黄淑芬', 20, '已付全年'],
      ['李国强、张丽华、李家豪', 20],
      ['何秀英、杨伟杰', 20],
      ['许雅婷、吴佩珊', 20],
      ['黄志强合家', 5],
      ['已故刘德明', 2, '家人代捐'],
      ['王小华', 2],
      ['梁慧敏', 2],
      ['杨家明', 0, '每月金额不固定'],
      ['吴佩琪', 5],
      ['张伟', 5],
      ['已故陈玉兰', 20, '女儿代捐'],
      ['方静怡', 10],
    ];
    const members = people.map(([name, pledge, note]) => L.addMember(s, { fundId: med.id, name, pledge: RM(pledge), startMonth: jan, note: note || '' }));
    const tan = L.addMember(s, { fundId: med.id, name: 'Tan Ah Kow 合家', pledge: RM(10), startMonth: `${year}-04`, endMonth: `${year}-08` });
    const wong = L.addMember(s, { fundId: med.id, name: 'Wong Mei Ling', pledge: RM(3), startMonth: `${year}-05`, note: '一次给了 RM18' });
    const zheng = L.addMember(s, { fundId: med.id, name: '郑家合家', pledge: RM(5), startMonth: `${year}-05` });

    const variable = [25, 14, 29, 26, 21, 31, 26, 28, 18, 22, 27, 24];
    const prepaidYear = members[1];
    for (const m of [...members, tan, zheng]) {
      if (m === prepaidYear) continue;
      for (const mo of monthsUpTo(m.startMonth, m.endMonth && m.endMonth < cur ? m.endMonth : cur)) {
        const chance = mo === cur ? 0.5 : 0.93; // this month only half collected so far
        if (rand() > chance) continue;
        const amount = m.pledge || RM(variable[+mo.slice(5) - 1]);
        L.setReceipt(s, { memberId: m.id, month: mo, amount, date: dateIn(mo, 3, 12) });
      }
    }
    // Paid the whole year by bank transfer on 8 January.
    L.prepay(s, { memberId: prepaidYear.id, fromMonth: jan, count: 12, amountEach: RM(20), date: `${year}-01-08` > today ? today : `${year}-01-08`, note: '已付全年 · 转账' });
    // Gave RM18 in May = six months of RM3.
    if (`${year}-05` <= cur) {
      L.prepay(s, { memberId: wong.id, fromMonth: `${year}-05`, count: 6, amountEach: RM(3), date: dateIn(`${year}-05`, 8, 12), note: '预付 RM18' });
    }

    for (const mo of monthsUpTo(jan, L.addMonths(cur, -1))) {
      const got = L.monthSummary(s, med.id, mo).received;
      let handOver = Math.floor(got / 1000) * 1000; // hand over in whole RM10s
      if (mo === `${year}-06`) {
        L.addPayout(s, { fundId: med.id, month: mo, date: dateIn(mo, 14, 16), amount: RM(10), note: '做茶点' });
        handOver -= RM(10);
      }
      L.addPayout(s, { fundId: med.id, month: mo, date: dateIn(L.addMonths(mo, 1), 2, 9), amount: handOver, note: '交给 Bhante（Chiro）' });
      const visit = 8 + Math.floor(rand() * 18);
      L.setMonthNote(s, med.id, mo, `${visit}/${+mo.slice(5)} 看 Chiro · 陈美玲载去`);
    }

    // ------------------------------------------------ fund 2: Dana Parami
    const dana = L.addFund(s, { name: 'Dana Parami', opening: 0, note: '每月供僧' });
    const danaPeople = ['陈美玲', '林志明', '何秀英', '许雅婷', '黄志强', '梁慧敏', '方静怡', '吴佩琪'];
    const danaMembers = danaPeople.map((name) => L.addMember(s, { fundId: dana.id, name, pledge: RM(10), startMonth: `${year}-02` }));
    for (const m of danaMembers) {
      for (const mo of monthsUpTo(m.startMonth, cur)) {
        if (rand() > (mo === cur ? 0.4 : 0.96)) continue;
        L.setReceipt(s, { memberId: m.id, month: mo, amount: RM(10), date: dateIn(mo, 1, 10) });
      }
    }
    for (const mo of monthsUpTo(`${year}-02`, L.addMonths(cur, -1))) {
      const got = L.monthSummary(s, dana.id, mo).received;
      if (got) L.addPayout(s, { fundId: dana.id, month: mo, date: dateIn(L.addMonths(mo, 1), 1, 6), amount: got, note: '供僧' });
    }

    s.settings.lastBackupAt = now.getTime();
    s.settings.changesSinceBackup = 0;
    return s;
  }

  return { build };
});
