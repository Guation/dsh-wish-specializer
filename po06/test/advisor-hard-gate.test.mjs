// 2026-10-23：顾问关闭必须是**注册层硬短路**，而不是“注册后返回 advisor-off”。
// 后者会让模型先调用、被告知关闭、再重新思考——白烧一轮注意力与时间。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { advisorToolEnabled } from '../lib/advisor.js'

test('关闭 ⇒ 不注册；开启或缺省 ⇒ 注册', () => {
  assert.equal(advisorToolEnabled({ advisor: false }), false)
  assert.equal(advisorToolEnabled({ advisor: true }), true)
  assert.equal(advisorToolEnabled({}), true, '读不到策略时按开处理，避免误关')
  assert.equal(advisorToolEnabled(null), true)
})

test('注册点必须走这个判定，且设置写盘后能重新同步', () => {
  const src = readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8')
  assert.ok(/const advisorEnabledNow = \(\) => \{[\s\S]{0,120}advisorToolEnabled\(/.test(src), '注册判定要复用 advisorToolEnabled')
  assert.ok(/if \(on && !advisorToolDispose\)/.test(src), '关闭时不能注册')
  assert.ok(/else if \(!on && advisorToolDispose\)/.test(src), '关闭后要注销已注册的工具')
  assert.ok(/syncAdvisorToolsRef\) syncAdvisorToolsRef\(\)/.test(src), '设置写盘后要重新同步')
})
