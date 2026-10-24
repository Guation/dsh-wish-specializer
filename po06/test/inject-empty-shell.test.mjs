// 2026-10-23 真机：包是空的，注入文里却还挂着基调块 + 编译器那句“没有从中提取到可执行内容”。
// 那句是**提示**不是内容：只有它时应当按“空”处理，什么都不注入（界面也不会有卡片）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

test('getWorkingText 把占位提示当空，且不改动真实未决项', () => {
  const src = readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8')
  assert.ok(/placeholderOnly/.test(src), '要有占位识别')
  assert.ok(/cleanedBase/.test(src), '要在判空之前先剥掉占位')
  assert.ok(/这一轮没有从中提取到可执行内容/.test(src), '匹配的正是那句提示')
  // 必须仍然保留“有内容就注入”的分支：cleanedBase 非空时继续走渲染
  assert.ok(/base = cleanedBase/.test(src), '剥掉占位后继续用真实内容')
})

test("只有包非空才换装：空包不允许出现基调块", () => {
  const src = readFileSync(new URL("../lib/index.js", import.meta.url), "utf8")
  assert.ok(/const hasPacket = String\(packet[^)]*\)\.trim\(\)\.length > 0/.test(src), '要有包判据')
  assert.ok(/hasPacket \? applyFramingToPacket/.test(src), "空包不得换装")
})
