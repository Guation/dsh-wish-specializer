// 2026-10-25 真机定因：注入的 370 字“壳”其实是**被写进包里**的编译器头部
// （【插件加的说明】+【协作基调】），一条建议都没有。
// 规矩：没有条目行的文本一律不许当包落库——那一轮就是零注入。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

test('pipeline 不会把“只有头部”的编译器输出写成包', () => {
  const src = readFileSync(new URL('../lib/pipeline.js', import.meta.url), 'utf8')
  assert.ok(src.includes('empty-shell-dropped'), '要有丢弃标记，便于台账核对')
  assert.ok(/if \(!hasPayloadLines\(stripPlaceholderNotice\(packet\.text\)\)\)/.test(src), '判据是剥掉占位后的条目行')
  assert.ok(src.includes("adapter.setIntentText(session.id, '')"), '丢弃时写空串（零注入）')
})
