// 退场动效（2026-10-19 用户：很多 UI 直接消失，太硬）。
//
// 规则：条件渲染的浮层在 show=false 时**先留在树上**打 data-po06-closing=1，
// 播完 po06-out（160ms）再卸载；拦截浮层因为带拖拽 inline transform，只淡出。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const CLIENT_SRC = readFileSync(join(HERE, '..', 'lib', 'client.js'), 'utf8')

test('统一的退出钩子：先打 closing 标记，过动画时长再卸载', () => {
  assert.ok(CLIENT_SRC.includes('function useExit(show, ms)'), '要有 useExit')
  assert.ok(CLIENT_SRC.includes('setTimeout(() => { setMounted(false); setClosing(false) }, ms)'), '延迟卸载')
  assert.ok(CLIENT_SRC.includes('function useLast(value)'), '退出期间内容仍需可读（记住最后一份快照）')
})

test('四个主要浮层都接了退场：选项面板 / 帮助 / 提示弹窗 / 拦截浮层', () => {
  for (const k of ['optExit', 'helpExit', 'noticeExit', 'ovExit']) {
    assert.ok(CLIENT_SRC.includes('const ' + k + ' = useExit('), '缺少退出钩子：' + k)
    assert.ok(CLIENT_SRC.includes(k + '.closing'), '缺少 closing 标记使用：' + k)
  }
  assert.ok(CLIENT_SRC.includes("'data-po06-closing'") || CLIENT_SRC.includes('"data-po06-closing"'), '要写到 DOM 上')
})

test('CSS：退场关键帧存在；拦截浮层只淡出（不能动 transform）', () => {
  assert.ok(CLIENT_SRC.includes('@keyframes po06-out{'), '通用退场关键帧')
  assert.ok(CLIENT_SRC.includes('@keyframes po06-out-fade{'), '纯淡出关键帧')
  assert.ok(CLIENT_SRC.includes('[data-po06="intercept"][data-po06-closing="1"]{animation:po06-out-fade'), '拦截浮层只淡出')
})

test('「详情」面板与两处折叠块也有退场', () => {
  assert.ok(CLIENT_SRC.includes('const panelExit = useExit(open, 160)'), '详情面板要有退出钩子')
  assert.ok(/panelExit\.mounted \? h\('div'/.test(CLIENT_SRC), '面板按 mounted 渲染')
  assert.ok(CLIENT_SRC.includes("'data-po06': 'intercept-fold-body-' + mark"), '折叠块仍在')
  assert.ok(/fold\.mounted \? h\('div'/.test(CLIENT_SRC) && /body\.mounted \? h\('div'/.test(CLIENT_SRC), '两处折叠都走 useExit')
})

test('下拉浮层自己淡出后再 remove（不直接消失）', () => {
  const i = CLIENT_SRC.indexOf('function Options(')
  const block = CLIENT_SRC.slice(i, i + 6000)
  assert.ok(block.includes("layer.style.transition = 'opacity .12s ease, transform .12s ease'"), '先设过渡')
  assert.ok(block.includes('setTimeout(() => { try { layer.remove()'), '延迟移除')
})
