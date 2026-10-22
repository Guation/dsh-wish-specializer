// 自绘下拉（2026-10-19）与顾问开关可调整（同一天的两类真机问题）。
//
// ① 原生 <select> 的展开面板由系统绘制，和插件设计语言不搭 → 全部换成自绘。
// ② 顾问开关原来把 english.ready 当成自己的就绪条件 ⇒ 英文没就绪时开关被禁用、点不动。
// ③ 菜单曾经渲在选项面板内部（滚动容器 + fixed 定位）⇒ 被裁掉、和别的行叠在一起、字号看起来也不对。
//    现在改成挂在 document.body 上的独立浮层，并显式写死字号/行高。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const CLIENT_SRC = readFileSync(join(HERE, '..', 'lib', 'client.js'), 'utf8')

test('可见控件里不再使用原生 select：模型/思考档位一律走自绘下拉', () => {
  // 只剩隐藏的「推理监控」面板里那一个（实验功能，不渲染给用户）。
  const raw = (CLIENT_SRC.match(/h\('select'/g) || []).length
  assert.equal(raw <= 1, true, '可见控件里不应再有原生 select，实际：' + raw)
  assert.equal((CLIENT_SRC.match(/h\(Options,/g) || []).length >= 5, true, '模型/档位/表单都在用自绘下拉')
})

test('菜单是挂在 body 上的独立小窗：自己滚动、按视口夹紧、任何时刻只有一层', () => {
  // 2026-10-22 用户明确要求：不要把菜单累加在面板里（会撑长并被裁），要“寄生”成一个独立小滑窗。
  // 之前两版各自的问题：内联 → 面板被拉长、末项滚不到；无约束浮层 → 两层同时开着互相压住。
  assert.ok(CLIENT_SRC.includes("'data-po06', 'picker-layer'"), '小窗节点')
  assert.ok(CLIENT_SRC.includes('document.body.appendChild(layer)'), '挂在 body 上而不是面板内部')
  assert.ok(CLIENT_SRC.includes('PICKER_HOSTS'), '要有单层约束：开新的先关旧的')
  assert.ok(CLIENT_SRC.includes('max-height:'), '要有自己的最大高度（视口夹紧）')
  assert.ok(CLIENT_SRC.includes('overflow-y:auto'), '小窗自己滚动')
})



test('键盘可用：Enter/空格/↓ 打开，Esc 关闭；展开状态可读', () => {
  for (const key of ["'Enter'", "' '", "'ArrowDown'", "'Escape'"]) {
    assert.ok(CLIENT_SRC.includes(key), '缺少按键处理：' + key)
  }
  assert.ok(CLIENT_SRC.includes('aria-expanded'), '展开状态要暴露给辅助技术')
})

test('顾问开关的就绪条件不再借用 english.ready', () => {
  const windows = CLIENT_SRC.split(String.fromCharCode(10)).filter((line) => line.includes('h(AdvisorControls,'))
  assert.equal(windows.length >= 2, true, '顾问开关出现在两处（详情表单 + 选项面板）')
  for (const w of windows) {
    assert.equal(w.includes('english?.ready'), false, '顾问不得用 english.ready 作为就绪条件：' + w.slice(0, 120))
    assert.ok(w.includes('ready:true'), '顾问应当始终可调：' + w.slice(0, 120))
  }
  const i = CLIENT_SRC.indexOf('EnglishControls,')
  assert.ok(i > 0 && CLIENT_SRC.slice(i, i + 220).includes('english?.ready'), '英文模式仍然用 english.ready')
})
