import test from 'node:test'
import assert from 'node:assert/strict'
import {apply} from '../lib/wish-check.js'
const harness=(reply)=>{
 let def=null
 const ctx={logger:{warn(){}},on(){},inject(_names,cb){cb({tools:{register(d){def=d;return ()=>{}},execute:async()=>reply}})},}
 apply(ctx)
 return def
}
test('a passing command yields structured evidence, not prose',async()=>{
 const def=harness({isError:false,content:[{type:'text',text:'ok\n[exit code: 0]'}]})
 const out=await def.execute({criterion:'页面能打开',command:'node verify.mjs'},{})
 assert.equal(out.ok,true);assert.equal(out.exitCode,0);assert.equal(out.criterion,'页面能打开');assert.ok(out.tail.includes('ok'))
})
test('a failing command is reported as such',async()=>{
 const def=harness({isError:false,content:[{type:'text',text:'boom\n[exit code: 1]'}]})
 const out=await def.execute({criterion:'测试通过',command:'node --test'},{})
 assert.equal(out.ok,false);assert.equal(out.exitCode,1)
})
test('missing criterion or command is refused before running anything',async()=>{
 const def=harness({isError:false,content:[{type:'text',text:'[exit code: 0]'}]})
 assert.deepEqual(await def.execute({command:'x'},{}),{ok:false,reason:'criterion-required'})
 assert.deepEqual(await def.execute({criterion:'x'},{}),{ok:false,reason:'command-required'})
})
test('a broken runner becomes a fixed reason with the criterion kept',async()=>{
 let def=null
 const ctx={logger:{warn(){}},on(){},inject(_n,cb){cb({tools:{register(d){def=d;return ()=>{} },execute:async()=>{throw Error('spawn failed')}}})}}
 apply(ctx)
 const out=await def.execute({criterion:'构建通过',command:'npm run build'},{})
 assert.equal(out.ok,false);assert.equal(out.reason,'check-failed-to-run');assert.equal(out.criterion,'构建通过')
})
