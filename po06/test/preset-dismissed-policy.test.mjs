// issue #37：`presetNoticeDismissed` 写了盘、也在白名单里，但 policyFor 不转交 ⇒ 下游恒读 undefined，
// 「以后不再显示」因此永远无效。这是同一类死开关的第三例（前两次：historyMode/turns/readTools、effortByModel）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readPolicy } from '../lib/policy.js'

test('policyFor 必须转交两个“不再显示”开关', () => {
  const home = mkdtempSync(join(tmpdir(), 'po06-dismiss-'))
  try {
    writeFileSync(join(home, 'po06.json'), JSON.stringify({ settingsVersion: 1, presetNoticeDismissed: true, skipHintDismissed: true }))
    const pol = readPolicy({ home })
    assert.equal(pol.presetNoticeDismissed, true, '开关必须出现在政策对象里')
    assert.equal(pol.skipHintDismissed, true)
  } finally { rmSync(home, { recursive: true, force: true }) }
})

test('默认值不能变成 undefined（缺失即 false，不能是“没这个键”）', () => {
  const home = mkdtempSync(join(tmpdir(), 'po06-dismiss-'))
  try {
    const pol = readPolicy({ home })
    assert.equal(pol.presetNoticeDismissed, false)
    assert.equal(typeof pol.skipHintDismissed, 'boolean')
  } finally { rmSync(home, { recursive: true, force: true }) }
})
