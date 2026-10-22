// 模型/思考档位解析的真机缺陷（2026-10-21 定位）。
//
// 症状：模型清单是异步到的；解析 effect 只依赖 [curKey, sessionId]，
// 清单晚到后不会重跑 ⇒ effortTarget 永远 null ⇒ 整个“思考档位”行消失。
// 这类“控件自己没了”的 bug 在截图里看不出来，只能靠钉住依赖与降级文案。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const SRC = readFileSync(fileURLToPath(new URL('../lib/client.js', import.meta.url)), 'utf8')
const SRC_INDEX = readFileSync(fileURLToPath(new URL('../lib/index.js', import.meta.url)), 'utf8')
const SRC_ADVISOR = readFileSync(fileURLToPath(new URL('../lib/advisor.js', import.meta.url)), 'utf8')

test('解析会话模型的 effect 依赖模型清单：清单晚到也必须重算', () => {
  assert.ok(SRC.includes("const routeSig = routes.map(mkey).join('|')"), '要有清单签名')
  assert.ok(SRC.includes('}, [curKey, sessionId, routeSig])'), '依赖里要有 routeSig，否则晚到的清单不会触发重算')
  assert.equal(SRC.includes('}, [curKey, sessionId])'), false, '旧的依赖写法必须消失')
})

test('解析不出来时不静默消失：就地说明是“正在读”还是“读不到”', () => {
  assert.equal(SRC.includes('if (!effortKey) return null'), false, '整行返回 null 就是用户看到的“档位不见了”')
  assert.ok(SRC.includes("'data-po06': 'effort-state'"), '要有一个可断言的状态节点')
  assert.ok(SRC.includes('正在读取会话模型'), 'resolving 文案')
  assert.ok(SRC.includes('没读到会话模型'), 'missing 文案')
})

test('跟随时按会话模型取档位，显式选择时按所选模型取', () => {
  assert.ok(SRC.includes("apiGet('/session-model?session='"), '跟随时问宿主当前会话模型')
  assert.ok(SRC.includes("'/efforts?provider='"), '按 provider/model 单独查档位')
  assert.ok(SRC.includes('effortTarget.provider + \'/\' + effortTarget.model'), '键必须是 provider/model（后端校验口径）')
})

test('颜色只许用真实存在的记号：OVS.line2 会拼出非法值，浏览器静默丢弃', () => {
  // 真机事故（2026-10-21）：阴影写成 `'inset 0 -2px 0 ' + OVS.line2`。
  // OVS 里**只有** line / lineSoft，`OVS.line2` 是 undefined ⇒ 拼出 `inset 0 -2px 0 undefined`，
  // 非法 CSS 被浏览器直接忽略 —— 表现就是“阴影怎么加都不显示”，连报错都没有。
  assert.equal(SRC.includes('OVS.line2'), false, 'OVS 没有 line2 这个键；用 OVS.lineSoft 或 T(\'line\')')
  assert.ok(SRC.includes("'inset 0 -2px 0 ' + T('line')"), '底边用 var() 形式')
  // 反过来也要钉住：合法的 '1px solid ' + OVS.line 不该被误伤（它已经是 var(...)）
  assert.ok(SRC.includes("'1px solid ' + OVS.line"), '合法写法保留')
})

test('调用宿主 llm.stream 必须带 sessionId：缺了它 opencode 系网关直接 400', () => {
  // 宿主 dsh-llm-pi-ai/lib/index.js:1885 只有在收到 options.sessionId 时才把它交给 SDK，
  // 由 SDK 生成网关要求的会话头。插件此前不传 ⇒ 400 MissingSessionID ⇒ 优化/顾问整轮失败。
  assert.ok(SRC_INDEX.includes('...(sessionId ? { sessionId: String(sessionId) } : {})'), '解释层调用要带会话标识')
  assert.ok(SRC_INDEX.includes('sessionId })'), '调用方要把 sessionId 传进 interpretViaLlm')
  assert.ok(SRC_ADVISOR.includes('sessionId: String(sid'), '顾问调用也要带')
})
