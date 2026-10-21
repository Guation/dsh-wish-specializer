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
  for (const k of ['optExit', 'helpExit', 'ovExit']) {
    assert.ok(CLIENT_SRC.includes('const ' + k + ' = useExit('), '缺少退出钩子：' + k)
    assert.ok(CLIENT_SRC.includes(k + '.closing'), '缺少 closing 标记使用：' + k)
  }
  // 预设弹窗改为 body 级命令式浮层（React 渲染会被输入区裁剪）⇒ 它自己负责淡出后再移除
  assert.ok(CLIENT_SRC.includes("el.style.transition = 'opacity .12s ease'"), '提示弹窗自己淡出')
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
  // 2026-10-21：菜单改为面板内联展开，不再有需要手动 remove 的浮层节点；
  // 但“不要生硬弹出”的意图保留——由 CSS 入场动画承担。
  assert.ok(CLIENT_SRC.includes('[data-po06="picker-layer"]{animation:po06-jelly-in'), '内联菜单有入场动画')
  assert.equal(CLIENT_SRC.includes('layer.remove()'), false, '内联菜单不需要手动移除浮层')
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

test('逐渐展开：正文 clip-path 自上而下揭开 + 按钮/输入区逐个浮现', () => {
  assert.ok(CLIENT_SRC.includes('@keyframes po06-unfold{'), '揭开关键帧')
  assert.ok(/intercept-scroll"\]\{animation:po06-unfold/.test(CLIENT_SRC), '正文按 clip-path 揭开')
  assert.ok(/button,\[data-po06="intercept"\]\[data-po06-closing="0"\] textarea\{animation:po06-jelly-in/.test(CLIENT_SRC), '按钮/输入区也走果冻入场')
  assert.ok(CLIENT_SRC.includes('button:nth-of-type(2){animation-delay:205ms}'), '按钮逐个错峰')
  assert.ok(CLIENT_SRC.includes('button:nth-of-type(n+4){animation-delay:270ms}'), '超过 4 个统一收口（总时长不膨胀）')
  // 揭开只裁可见区域、不改尺寸 ⇒ 与"大小自适应"不冲突
  assert.ok(CLIENT_SRC.includes('clip-path:inset(0 0 100% 0)'), '从头往下揭开')
})

test('完成发送 / 跳过发送：状态切换与离场都有性格（收束 vs 放行）', () => {
  // 离场种类写到 DOM 上，CSS 才能分性格
  assert.ok(CLIENT_SRC.includes("'data-po06-exit': props.exitKind || 'none'"), '面板要标记离场种类')
  assert.ok(CLIENT_SRC.includes("setOvExitKind(mark === 'skipped' ? 'skipped' : 'sent')"), '发送/跳过分别标记')
  assert.ok(CLIENT_SRC.includes("setOvExitKind('cancel')") && CLIENT_SRC.includes("setOvExitKind('collapse')"), '取消/收起也标记')
  // 状态切换本身也要软（不是文字突然换掉）
  assert.ok(CLIENT_SRC.includes('@keyframes po06-settle{'), '定住关键帧')
  assert.ok(/data-po06-phase="sent"\] \[data-po06="intercept-foot"\]/.test(CLIENT_SRC), '发送后 footer 收一下')
  // 两条出口的性格差异
  assert.ok(CLIENT_SRC.includes('@keyframes po06-release{'), '放行关键帧（向上弹开）')
  assert.ok(/data-po06-exit="skipped"\][^{]*\{animation:po06-release/.test(CLIENT_SRC), '跳过用放行曲线')
  assert.ok(/data-po06-exit="sent"\][^{]*\{animation:po06-jelly-out/.test(CLIENT_SRC), '发送用收束曲线')
})
