// 三个入口（2026-10-20 重构 3/4）：understand / improve / rework / verify。
// 老的四个 mode 保留为别名——已有调用方（含我自己过去的用法）不能因此炸掉。
import test from 'node:test'
import assert from 'node:assert/strict'
import { ADVISOR_ENTRIES, ADVISOR_MODES, ENTRY_TO_MODE, entryFromMode, normalizeEntry, ADVISOR_PARAMETERS, ADVISOR_SYSTEM } from '../lib/advisor.js'

test('四个入口与四个旧 mode 一一对应', () => {
  assert.deepEqual([...ADVISOR_ENTRIES], ['understand', 'improve', 'rework', 'verify'])
  for (const e of ADVISOR_ENTRIES) assert.ok(ADVISOR_MODES.includes(ENTRY_TO_MODE[e]), e + ' 要有对应 mode')
  assert.equal(entryFromMode('develop_approach'), 'understand')
  assert.equal(entryFromMode('improve_result'), 'improve')
  assert.equal(entryFromMode('diagnose_failure'), 'rework')
  assert.equal(entryFromMode('review_result'), 'verify')
})

test('normalizeEntry：新调用传 entry，老调用传 mode，都能落到同一个入口', () => {
  assert.equal(normalizeEntry('improve'), 'improve')
  assert.equal(normalizeEntry(undefined, 'develop_approach'), 'understand')
  assert.equal(normalizeEntry('', 'review_result'), 'verify')
  assert.equal(normalizeEntry('nonsense', 'nonsense'), 'improve', '都认不出时落到最常用的那个')
})

test('参数：entry 可选、question 仍是必填', () => {
  const props = ADVISOR_PARAMETERS.properties
  assert.ok(props.entry, '要有 entry 参数')
  assert.deepEqual([...props.entry.enum], ['understand', 'improve', 'rework', 'verify'])
  assert.ok(!ADVISOR_PARAMETERS.required.includes('mode'), 'mode 不再是必填（兼容别名）')
  assert.ok(ADVISOR_PARAMETERS.required.includes('question'))
})

test('顾问的措辞里带着两段式与禁施工图', () => {
  const sys = String(ADVISOR_SYSTEM)
  assert.ok(sys.includes('现在……，是因为……，所以你应当……'), '要给 summary 句式')
  assert.ok(sys.includes('不写代码'), '禁代码')
  assert.ok(sys.includes('点拨'), '定位是点拨不是施工')
})
