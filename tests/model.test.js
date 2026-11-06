// Run with: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../model.js');

function setup() {
  const s = L.emptyState();
  const fund = L.addFund(s, { name: 'Bhante 医疗费用', opening: 5000 }); // RM50 on hand at start
  const a = L.addMember(s, { fundId: fund.id, name: '陈美玲', pledge: 1000, startMonth: '2026-01' });
  const b = L.addMember(s, { fundId: fund.id, name: 'Tan Ah Kow 合家', pledge: 1000, startMonth: '2026-04', endMonth: '2026-08' });
  const c = L.addMember(s, { fundId: fund.id, name: '王小华', pledge: 0, startMonth: '2026-03' });
  return { s, fund, a, b, c };
}

test('parseAmount handles what people actually type', () => {
  assert.equal(L.parseAmount('10'), 1000);
  assert.equal(L.parseAmount('10.5'), 1050);
  assert.equal(L.parseAmount('10.50'), 1050);
  assert.equal(L.parseAmount('10.'), 1000);
  assert.equal(L.parseAmount('1,234.56'), 123456);
  assert.equal(L.parseAmount('RM 20'), 2000);
  assert.equal(L.parseAmount('rm20'), 2000);
  assert.equal(L.parseAmount('１０'), 1000);
  assert.equal(L.parseAmount('10。5'), 1050);
  assert.equal(L.parseAmount(' 7 '), 700);
  assert.equal(L.parseAmount(''), null);
  assert.equal(L.parseAmount('abc'), null);
  assert.equal(L.parseAmount('-5'), null);
  assert.equal(L.parseAmount('1.234'), null);
  // classic float trap: 0.1 + 0.2
  assert.equal(L.parseAmount('0.1') + L.parseAmount('0.2'), L.parseAmount('0.3'));
});

test('formatting', () => {
  assert.equal(L.fmtNum(1000), '10');
  assert.equal(L.fmtNum(1050), '10.50');
  assert.equal(L.fmtNum(123456789), '1,234,567.89');
  assert.equal(L.fmtMoney(-2500, 'RM'), '-RM 25');
  assert.equal(L.fmtPlain(1234500), '12345');
  assert.equal(L.shortDate('2026-02-05'), '5/2');
  assert.equal(L.monthLabel('2026-11'), '2026年11月');
});

test('month arithmetic crosses years both ways', () => {
  assert.equal(L.addMonths('2026-11', 2), '2027-01');
  assert.equal(L.addMonths('2026-01', -1), '2025-12');
  assert.equal(L.addMonths('2026-05', -17), '2024-12');
  assert.equal(L.addMonths('2026-12', 12), '2027-12');
});

test('month page lists only people active that month, plus anyone who paid', () => {
  const { s, fund, a, b, c } = setup();
  assert.deepEqual(L.membersForMonth(s, fund.id, '2026-02').map((m) => m.id), [a.id]);
  assert.deepEqual(L.membersForMonth(s, fund.id, '2026-04').map((m) => m.id), [a.id, b.id, c.id]);
  assert.deepEqual(L.membersForMonth(s, fund.id, '2026-09').map((m) => m.id), [a.id, c.id]);
  // b paid for September even though they stopped in August -> still shown that month
  L.setReceipt(s, { memberId: b.id, month: '2026-09', amount: 500, date: '2026-09-02' });
  assert.deepEqual(L.membersForMonth(s, fund.id, '2026-09').map((m) => m.id), [a.id, b.id, c.id]);
});

test('hand-checked scenario: grid totals and running balance', () => {
  const { s, fund, a, b, c } = setup();
  L.setReceipt(s, { memberId: a.id, month: '2026-01', amount: 1000, date: '2026-01-09' });
  L.setReceipt(s, { memberId: a.id, month: '2026-04', amount: 1000, date: '2026-04-20' });
  L.setReceipt(s, { memberId: b.id, month: '2026-04', amount: 1000, date: '2026-04-21' });
  L.setReceipt(s, { memberId: c.id, month: '2026-04', amount: 2900, date: '2026-04-22' }); // variable amount
  L.addPayout(s, { fundId: fund.id, month: '2026-04', date: '2026-04-23', amount: 4000, note: '交给 Bhante' });

  const g = L.yearGrid(s, fund.id, 2026);
  assert.equal(g.opening, 5000);
  assert.equal(g.received[0], 1000); // Jan
  assert.equal(g.received[3], 4900); // Apr: 10 + 10 + 29
  assert.equal(g.paidOut[3], 4000);
  // By hand: 50 + 10 (Jan) = 60, flat through Mar, + 49 - 40 = 69 in Apr, flat after.
  assert.deepEqual(g.balance.slice(0, 5), [6000, 6000, 6000, 6900, 6900]);
  assert.equal(g.balance[11], 6900);
  assert.equal(g.totalReceived, 5900);
  assert.equal(g.totalPaidOut, 4000);

  const row = g.rows.find((r) => r.member.id === b.id);
  assert.equal(row.cells[2].active, false); // March: not started
  assert.equal(row.cells[3].active, true);
  assert.equal(row.cells[8].active, false); // September: stopped
  assert.equal(row.total, 1000);

  const apr = L.monthSummary(s, fund.id, '2026-04');
  assert.equal(apr.opening, 6000);
  assert.equal(apr.received, 4900);
  assert.equal(apr.receivedCount, 3);
  assert.equal(apr.expected, 2000); // c has no fixed amount
  assert.equal(apr.closing, 6900);
  assert.equal(L.cashOnHand(s, fund.id), 6900);
});

test('one receipt per person per month; editing replaces it', () => {
  const { s, a } = setup();
  L.setReceipt(s, { memberId: a.id, month: '2026-03', amount: 1000, date: '2026-03-01' });
  L.setReceipt(s, { memberId: a.id, month: '2026-03', amount: 1500, date: '2026-03-02', note: '多给' });
  assert.equal(s.receipts.length, 1);
  assert.equal(s.receipts[0].amount, 1500);
  assert.equal(s.receipts[0].note, '多给');
});

test('prepay fills the next unpaid months and skips paid ones', () => {
  const { s, fund, a } = setup();
  L.setReceipt(s, { memberId: a.id, month: '2026-02', amount: 1000, date: '2026-02-01' });
  const made = L.prepay(s, { memberId: a.id, fromMonth: '2026-01', count: 12, amountEach: 2000, date: '2026-01-08', note: '已付全年' });
  assert.equal(made.length, 12);
  assert.deepEqual(made.map((r) => r.month).slice(0, 3), ['2026-01', '2026-03', '2026-04']);
  assert.equal(made[11].month, '2027-01');
  // February keeps its original payment
  assert.equal(L.receiptOf(s, a.id, '2026-02').amount, 1000);
  // Cash on hand counts the prepayment now; the month balance only counts months up to then.
  assert.equal(L.cashOnHand(s, fund.id), 5000 + 1000 + 12 * 2000);
  assert.equal(L.prepaidAfter(s, fund.id, '2026-01'), 1000 + 11 * 2000);
});

test('remove and restore (undo) a receipt and a payout', () => {
  const { s, fund, a } = setup();
  L.setReceipt(s, { memberId: a.id, month: '2026-05', amount: 1000, date: '2026-05-01' });
  const r = L.removeReceipt(s, a.id, '2026-05');
  assert.equal(s.receipts.length, 0);
  L.restoreReceipt(s, r);
  assert.equal(s.receipts.length, 1);
  const p = L.addPayout(s, { fundId: fund.id, month: '2026-05', date: '2026-05-08', amount: 1000 });
  L.removePayout(s, p.id);
  assert.equal(s.payouts.length, 0);
  L.restorePayout(s, p);
  assert.equal(s.payouts.length, 1);
});

test('members with receipts cannot be deleted; others can', () => {
  const { s, a, c } = setup();
  L.setReceipt(s, { memberId: a.id, month: '2026-01', amount: 1000, date: '2026-01-01' });
  assert.throws(() => L.deleteMember(s, a.id), /不能删除/);
  L.deleteMember(s, c.id);
  assert.equal(L.getMember(s, c.id), null);
});

test('validation rejects bad input', () => {
  const { s, fund, a } = setup();
  assert.throws(() => L.setReceipt(s, { memberId: a.id, month: '2026-01', amount: 0, date: '2026-01-01' }));
  assert.throws(() => L.setReceipt(s, { memberId: a.id, month: '2026-13', amount: 100, date: '2026-01-01' }));
  assert.throws(() => L.addMember(s, { fundId: fund.id, name: '  ', startMonth: '2026-01' }));
  assert.throws(() => L.addMember(s, { fundId: fund.id, name: 'x', startMonth: '2026-05', endMonth: '2026-04' }));
  assert.throws(() => L.addPayout(s, { fundId: fund.id, month: '2026-01', date: 'bad', amount: 100 }));
});

test('moveMember reorders within a fund', () => {
  const { s, fund, a, b, c } = setup();
  L.moveMember(s, c.id, -1);
  assert.deepEqual(L.fundMembers(s, fund.id).map((m) => m.id), [a.id, c.id, b.id]);
  assert.equal(L.moveMember(s, a.id, -1), false);
});

test('bulk paste parses names and monthly amounts', () => {
  const rows = L.parseBulkMembers(
    ['1 陈美玲 10', '2. 林志明、黄淑芬 20', '3、李国强，张丽华 20', 'Tan Ah Kow 合家 10', 'Wong Mei Ling RM3', '王小华', '已故刘德明 3/1/2026往生', '', '  郑家合家   5  '].join('\n')
  );
  assert.deepEqual(rows, [
    { name: '陈美玲', pledge: 1000 },
    { name: '林志明、黄淑芬', pledge: 2000 },
    { name: '李国强，张丽华', pledge: 2000 },
    { name: 'Tan Ah Kow 合家', pledge: 1000 },
    { name: 'Wong Mei Ling', pledge: 300 },
    { name: '王小华', pledge: 0 },
    { name: '已故刘德明 3/1/2026往生', pledge: 0 },
    { name: '郑家合家', pledge: 500 },
  ]);
});

test('backup round-trips and import drops broken records', () => {
  const { s, fund, a } = setup();
  L.setReceipt(s, { memberId: a.id, month: '2026-01', amount: 1000, date: '2026-01-09' });
  L.addPayout(s, { fundId: fund.id, month: '2026-01', date: '2026-02-05', amount: 1000 });
  L.setMonthNote(s, fund.id, '2026-01', 'Chiro 9/1');
  const back = L.normalizeState(JSON.parse(L.backupJSON(s)));
  assert.equal(back.dropped, 0);
  assert.deepEqual(back.state.funds, s.funds);
  assert.deepEqual(back.state.members, s.members);
  assert.deepEqual(back.state.receipts, s.receipts);
  assert.deepEqual(back.state.payouts, s.payouts);

  const broken = JSON.parse(JSON.stringify(s));
  broken.receipts.push({ id: 'x', memberId: 'ghost', month: '2026-01', amount: 100, date: '2026-01-01' });
  broken.receipts.push({ ...s.receipts[0], id: 'dup' }); // duplicate person+month
  broken.payouts.push({ id: 'y', fundId: fund.id, month: '2026-01', date: '2026-01-01', amount: -5 });
  const res = L.normalizeState(broken);
  assert.equal(res.dropped, 3);
  assert.equal(res.state.receipts.length, 1);

  assert.throws(() => L.normalizeState({ hello: 1 }), /不是善款簿/);
});

test('CSV export has BOM, header, rows, totals', () => {
  const { s, fund, a } = setup();
  L.setReceipt(s, { memberId: a.id, month: '2026-01', amount: 1000, date: '2026-01-09' });
  L.addPayout(s, { fundId: fund.id, month: '2026-01', date: '2026-02-05', amount: 1000, note: '交给 "Bhante"' });
  const csv = L.yearCSV(s, fund.id, 2026);
  assert.ok(csv.startsWith('﻿'));
  const lines = csv.slice(1).split('\r\n');
  assert.equal(lines[1], '编号,名字,每月,1月,2月,3月,4月,5月,6月,7月,8月,9月,10月,11月,12月,合计');
  assert.equal(lines[2], '1,陈美玲,10,10,,,,,,,,,,,,10');
  assert.ok(lines[3].startsWith('2,Tan Ah Kow 合家,10,-,-,-,,'));
  assert.ok(csv.includes('交钱日期,,2026-02-05'));
});

test('share text summarises the month', () => {
  const { s, fund, a, b } = setup();
  L.setReceipt(s, { memberId: a.id, month: '2026-05', amount: 1000, date: '2026-05-01' });
  L.addPayout(s, { fundId: fund.id, month: '2026-05', date: '2026-05-07', amount: 1000, note: '交给 Bhante' });
  const t = L.monthShareText(s, fund.id, '2026-05');
  assert.match(t, /【Bhante 医疗费用】2026年5月/);
  assert.match(t, /已收 1\/3 人：RM 10/);
  assert.match(t, /未收：Tan Ah Kow 合家、王小华/);
  assert.match(t, /交出 7\/5：RM 10（交给 Bhante）/);
  assert.ok(b);
});
