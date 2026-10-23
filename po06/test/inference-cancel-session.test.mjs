// “跳过优化”必须真的停下宿主侧推理（2026-10-22 用户口径：跳过 = 无插件）。
// 前端只知道会话，所以取消要支持 runId 省略 ⇒ 按会话中止所有未进入 working 的运行。
import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createControlHandler } from '../lib/control-api.js'

test('控制面允许只给 sessionId 取消', async () => {
  let got = null
  const handler = createControlHandler({
    home: process.env.PO06_TEST_HOME || 'C:/Users/33875/.dsh',
    stateDir: 'C:/Users/33875/.dsh/po06-state',
    ledgerPath: 'C:/Users/33875/.dsh/po06-wire.jsonl',
    inferenceCancel: (sid, run) => { got = { sid, run }; return { ok: true, cancelled: 1 } },
  })
  const req = new EventEmitter()
  req.method = 'POST'
  req.url = '/po06/api/inference-cancel'
  req.headers = { host: '127.0.0.1:19387', 'x-po06': '1' }
  let body = ''
  const res = { writeHead() {}, end(chunk) { body += String(chunk || '') } }
  const done = handler(req, res)
  req.emit('data', Buffer.from(JSON.stringify({ sessionId: 's1' })))
  req.emit('end')
  await done
  const parsed = JSON.parse(body || '{}')
  assert.equal(parsed.ok, true, '不带 runId 也应成功: ' + body)
  assert.equal(got && got.sid, 's1', '必须把会话传下去')
  assert.equal(got && got.run, '', 'runId 为空表示按会话取消')
})
