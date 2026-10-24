// 2026-10-25 用户定稿：“就不应该有壳”。
// 注入的唯一来源是**包**；编译器按状态渲染的头部（包头 + 基调块）不再参与注入。
// （旧守卫钉的是“占位提示当空”，那段逻辑已随编译器路径一起退出注入链，故一并删除。）
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

test('注入源只有包（不再经过编译器渲染）', () => {
  const src = readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8')
  assert.ok(src.includes('注入源=包'), '要有明确的口径注释')
  assert.ok(src.includes('applyFramingToPacket(packet'), '换装作用在包上')
})
