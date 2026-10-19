// 自绘下拉（2026-10-19）与顾问开关可调整（同一天的两个真机问题）。
//
// ① 原生 <select> 的展开面板由系统绘制（黑底 + 系统蓝高亮），和插件设计语言完全不搭 → 全部换成自绘。
// ② 顾问开关原来把 english.ready 当成自己的就绪条件 ⇒ 英文没就绪时开关被禁用、点不动。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const CLIENT_SRC = readFileSync(join(HERE, '..', 'lib', 'client.js'), 'utf8')

test('可见控件里不再使用原生 select：模型/思考档位一律走自绘下拉', () => {
  // 只剩隐藏的「推理监控」面板里那一个（实验功能，不渲染给用户）；可见的三处模型/档位都已换成 Options。
  const raw = (CLIENT_SRC.match(/h\('select'/g) || []).length
  assert.equal(raw <= 1, true, '可见控件里不应再有原生 select，实际：' + raw)
  assert.equal((CLIENT_SRC.match(/h\(Options,/g) || []).length >= 5, true, '模型/档位/表单都在用自绘下拉')
  assert.ok(CLIENT_SRC.includes("'data-po06': 'picker'"), '要有触发器')
  assert.ok(CLIENT_SRC.includes("'data-po06': 'picker-menu'"), '要有浮层面板')
  assert.ok(CLIENT_SRC.includes("'data-po06': 'picker-item'"), '要有选项')
  assert.ok(CLIENT_SRC.includes("role: 'listbox'") && CLIENT_SRC.includes("role: 'option'"), '要有 listbox/option 语义')
})

test('键盘可用：上下移动、Home/End、Enter 选择、Esc 关闭', () => {
  for (const key of ["'ArrowDown'", "'ArrowUp'", "'Home'", "'End'", "'Enter'", "'Escape'"]) {
    assert.ok(CLIENT_SRC.includes(key), '缺少按键处理：' + key)
  }
  assert.ok(CLIENT_SRC.includes("aria-expanded"), '展开状态要暴露给辅助技术')
})

test('浮层定位：量触发器矩形，空间不足就向上开', () => {
  assert.ok(/const below = vh - r\.bottom > 240/.test(CLIENT_SRC), '按剩余空间决定上下')
  assert.ok(/position: 'fixed', zIndex: OV_Z\.pop \+ 1/.test(CLIENT_SRC), '菜单要浮在面板之上')
})

test('顾问开关的就绪条件不再借用 english.ready', () => {
  // 只看**同一行**：下一行就是 EnglishControls，按窗口取会把它的 english.ready 也圈进来
  const windows = CLIENT_SRC.split('\n').filter((line) => line.includes('h(AdvisorControls,')).map((line) => line.trim())
  assert.equal(windows.length >= 2, true, '顾问开关出现在两处（详情表单 + 选项面板）')
  for (const w of windows) {
    assert.equal(w.includes('english?.ready'), false, '顾问不得用 english.ready 作为就绪条件：' + w.slice(0, 120))
    assert.ok(w.includes('ready:true'), '顾问应当始终可调：' + w.slice(0, 120))
  }
  // 对比：英文模式确实依赖 english.ready（那是它真的前提）
  const i = CLIENT_SRC.indexOf('EnglishControls,')
  assert.ok(i > 0 && CLIENT_SRC.slice(i, i + 220).includes('english?.ready'), '英文模式仍然用 english.ready')
})
