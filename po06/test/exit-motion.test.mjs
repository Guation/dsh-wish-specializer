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

test('退场动画必须带 !important（入场是 fill:both，会一直占着 animation 槽）', () => {
  // 2026-10-19 真机：优化选项 / 帮助 / 拦截面板"没有退场"，根因就是这条同优先级规则被后面的入场规则盖住
  assert.ok(/\[data-po06-closing="1"\]\{animation:po06-out \.16s ease-in both !important/.test(CLIENT_SRC), '通用退场要 !important')
  assert.ok(/\[data-po06="intercept"\]\[data-po06-closing="1"\]\{animation:po06-out-fade \.\d+s ease-in both !important/.test(CLIENT_SRC), '拦截浮层淡出也要 !important')
})

test('拦截面板：果冻式逐组件入场/退场（只动 transform/opacity，不碰尺寸）', () => {
  assert.ok(CLIENT_SRC.includes('@keyframes po06-jelly-in{'), '入场关键帧')
  assert.ok(CLIENT_SRC.includes('@keyframes po06-jelly-out{'), '退场关键帧')
  // 挤压—拉伸：scale 的 x/y 不同步，才是"软体"而不是等比弹跳
  assert.ok(/scale\(\.94,\.88\)/.test(CLIENT_SRC), '压缩起始（xy 不同步）')
  assert.ok(/scale\(1\.014,1\.028\)/.test(CLIENT_SRC), '回弹过冲')
  // 逐组件错峰且间隔不等距
  assert.ok(CLIENT_SRC.includes('> *:nth-child(2){animation-delay:55ms}'), '第二个组件 55ms')
  assert.ok(CLIENT_SRC.includes('> *:nth-child(3){animation-delay:120ms}'), '第三个 120ms')
  assert.ok(CLIENT_SRC.includes('intercept-scroll"\] > *{animation:po06-jelly-in'), '滚动区内部区块也逐个')
  // 退场窗口与错峰对齐
  assert.ok(CLIENT_SRC.includes('const ovExit = useExit(!!shown, 240)'), '退场窗口 240ms')
  // 性能：不给这些子元素加 will-change（数量多时反而更贵），只靠 transform/opacity 合成
  const i = CLIENT_SRC.indexOf('[data-po06="intercept"][data-po06-closing="0"] > *{')
  const seg = CLIENT_SRC.slice(i, i + 900)
  assert.equal(seg.includes('will-change'), false, '不要给孩子加 will-change')
})
