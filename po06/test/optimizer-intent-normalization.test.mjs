import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseOptimizerValue } from '../lib/optimizer-protocol.js'
import { handleUserInput } from '../lib/pipeline.js'

test('real completed flash response retains string intent and all directions in one call', async () => {
  const response = JSON.parse(readFileSync(new URL('./fixtures/flash-tank-string-intent.json',import.meta.url),'utf8'))
  const before = structuredClone(response); let calls = 0
  const out = await handleUserInput({}, {id:'flash-tank'}, {messageId:'one',text:'坦克测试',interpret:async()=>{calls++;return response}})
  assert.equal(calls,1);assert.equal(out.ok,true);assert.equal(out.status,'ready')
  assert.equal(out.optimizer.intent.text,response.intent);assert.equal(out.optimizer.intent.relation,response.relation)
  for (const field of ['add','scaffold','ask']) for (const text of response[field]) assert.ok(out.packet.text.includes(text),field+' text must survive')
  assert.deepEqual(Object.keys(out.optimizer).sort(),['version','intent','clarify','add','scaffold','ask','decide'].sort())
  assert.ok(out.warnings.some(w=>w.includes('string intent normalized')))
  assert.deepEqual(response,before)
})

test('empty or unknown intent shapes still fail without invented meaning', () => {
  for(const intent of ['', '   ', 3, null, [], {text:''}]) assert.equal(parseOptimizerValue({intent,add:['direction']}).ok,false)
  const unknown=parseOptimizerValue({intent:'A useful task',relation:'invented',add:['direction']})
  assert.equal(unknown.ok,true);assert.equal(unknown.optimizer.intent.relation,'uncertain')
})
