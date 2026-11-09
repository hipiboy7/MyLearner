// 등급 A — web/core/dates.js (FR-213). 시험 먼저 2026-10-15.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { core } = require('./helpers');
const D = core('dates');

test('addDays · 윤년 · 해 넘김', () => {
  assert.equal(D.addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(D.addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(D.addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(D.addDays('2026-01-01', 180), '2026-06-30');
});

test('isoWeekday — 월 1 … 일 7', () => {
  assert.equal(D.isoWeekday('2026-09-15'), 2);
  assert.equal(D.isoWeekday('2026-10-18'), 7);
  assert.equal(D.isoWeekday('2026-10-19'), 1);
});

test('isDay — 있는 날짜만', () => {
  for (const ok of ['2026-10-15', '2028-02-29', '1999-12-31']) assert.equal(D.isDay(ok), true, ok);
  for (const bad of ['2026-02-29', '2026-13-01', '2026-00-10', '2026-1-1', '20261015', '', null, 20261015, '2026-10-15T00:00:00Z', '2026-10-32'])
    assert.equal(D.isDay(bad), false, String(bad));
});

test('isTime — toISOString 꼴만', () => {
  assert.equal(D.isTime('2026-10-15T12:34:56.789Z'), true);
  assert.equal(D.isTime(new Date(Date.UTC(2026, 9, 15)).toISOString()), true);
  for (const bad of ['2026-10-15T12:34:56Z', '2026-10-15T12:34:56.78Z', '2026-10-15T12:34:56.789+09:00', '2026-10-15T24:00:00.000Z',
    '2026-02-30T00:00:00.000Z', '2026-10-15T12:60:00.000Z', '2026-10-15 12:34:56.789Z', 5])
    assert.equal(D.isTime(bad), false, String(bad));
});

test('learningDay — 현지 날짜, 경계 시각(기본 자정)', () => {
  // 시험이 도는 곳의 시간대와 무관하게: 현지 시각으로 만든 Date 를 쓴다
  const late = new Date(2026, 9, 15, 23, 59, 0);
  const early = new Date(2026, 9, 16, 0, 30, 0);
  assert.equal(D.learningDay(late), '2026-10-15');
  assert.equal(D.learningDay(early), '2026-10-16');
  assert.equal(D.learningDay(early, 0), '2026-10-16');
  assert.equal(D.learningDay(early, 4), '2026-10-15');   // 새벽 4시 경계면 전날
  assert.equal(D.learningDay(new Date(2026, 9, 16, 4, 0, 0), 4), '2026-10-16');
  assert.throws(() => D.learningDay(early, 24));
  assert.throws(() => D.learningDay(early, -1));
});

test('compareDay·diffDays', () => {
  assert.equal(D.diffDays('2026-10-15', '2026-10-18'), 3);
  assert.equal(D.diffDays('2026-10-18', '2026-10-15'), -3);
  assert.equal(D.monthOf('2026-10-15'), '2026-10');
});
