import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const file=new URL('../../po06/presets/wish.patch.yml',import.meta.url)
const text=readFileSync(file,'utf8')
const disabled=[...text.matchAll(/- id: (\S+)\n(?:\s+name: [^\n]*\n)?\s+disabled: true/g)].map(m=>m[1])
test('the wish preset is a valid agent-preset declaration',()=>{
 assert.match(text,/id: preset-wish/)
 assert.match(text,/id: wish\b/)
 assert.match(text,/order: 5/)
 assert.match(text,/name: '@deepseek-ai\/dsh-agent-preset'/)
})
test('it stays a PTC preset',()=>{
 assert.match(text,/- id: tool-presentation[\s\S]{0,120}mode: ptc/,'PTC 的呈现方式必须保留，否则测的就不是"工具面"')
})
test('the narrowed surface is exactly the declared set',()=>{
 const expected=['skill-filesystem','tool-skill','command-goal','tool-goal','tool-web','tool-subagent-codex','tool-subagent-claude-code','workflow-ptc','tool-workflow','tool-ralph','tool-plugin-manager']
 assert.deepEqual(disabled.slice().sort(),expected.slice().sort())
})
test('nothing is deleted from the composition, only disabled',()=>{
 const ids=[...text.matchAll(/- id: (\S+)/g)].map(m=>m[1]).filter(id=>!id.startsWith('preset-'))
 for(const must of ['persona','tool-bash','tool-fs','tool-pwsh','tool-ask-user','tool-todo','present','delegation'])
  assert.ok(ids.includes(must),must+' 仍然在组合里')
})
