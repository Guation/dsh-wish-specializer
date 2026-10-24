// 顾问关闭后，注入文里不能再出现“用 consult_task 复核”这类指示——
// 工具已经不在模型的可选动作里了（注册层硬关闭），再提就是自相矛盾、白耗注意力。
import test from 'node:test'
import assert from 'node:assert/strict'
import { withAdvisorWorkflow } from '../lib/advisor-workflow.js'

test('顾问关闭 ⇒ 不注入顾问工作流', () => {
  const out = withAdvisorWorkflow('包正文', { injectPacket: true, advisor: false })
  assert.equal(out, '包正文')
  assert.equal(out.includes('consult_task'), false)
})

test('顾问开启 ⇒ 正常注入（且保留包正文）', () => {
  const out = withAdvisorWorkflow('包正文', { injectPacket: true, advisor: true })
  assert.ok(out.includes('consult_task'), '开启时要告诉模型有这个能力')
  assert.ok(out.includes('包正文'))
})

test('不注入时任何情况都不加工作流', () => {
  assert.equal(withAdvisorWorkflow('x', { injectPacket: false, advisor: true }), 'x')
})
