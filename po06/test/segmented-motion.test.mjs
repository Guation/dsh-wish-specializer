// The studio redesign replaces measured pills/particles with semantic choices.
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'

function radio() {
  const hooks=[],effects=[];let cursor=0
  const win={__ModuleLoader__:{load(def){win.registration=def}}}
  const react={createElement:(type,props,...children)=>({type,props:props||{},children}),
    useState(initial){const i=cursor++;hooks[i]??={value:initial};return [hooks[i].value,value=>{hooks[i].value=value}]},
    useEffect(fn,deps){const i=cursor++;if(!hooks[i]||deps.some((d,n)=>d!==hooks[i].deps[n])){hooks[i]={deps};effects.push(fn)}},
    useRef(initial){const i=cursor++;hooks[i]??={ref:{current:initial}};return hooks[i].ref}}
  runInNewContext(readFileSync(new URL('../lib/client.js',import.meta.url),'utf8'),{window:win,document:{},console,URL})
  const client=win.registration.factory(()=>react)
  client.apply({slots:{register:()=>()=>{},inject:(_,fn)=>fn()}})
  const component=client.__debug.Segmented
  const picks=[];let props={name:'test',value:'standard',options:['off','light','standard','heavy'],label:k=>k,onPick:k=>picks.push(k),failTick:0}
  const render=patch=>{props={...props,...patch};cursor=0;const tree=component(props);for(const effect of effects.splice(0))effect();return tree}
  return {render,picks}
}
const buttons=tree=>tree.children.flat().filter(node=>node?.props?.role==='radio')

test('actual choices expose selection, roving focus and original setting values',()=>{
  const h=radio(),tree=h.render(),items=buttons(tree)
  assert.equal(tree.props.role,'radiogroup');assert.equal(items.length,4)
  assert.equal(items[2].props['aria-checked'],true);assert.equal(items[2].props.tabIndex,0)
  assert.equal(items[0].props.tabIndex,-1);assert.equal(items[3].props.type,'button')
  assert.equal(items[3].props['data-po06'],'test-heavy')
})
test('a click commits once; a repeated click on the chosen value is inert',()=>{
  const h=radio();h.render();let tree=h.render()
  buttons(tree)[3].props.onClick();tree=h.render();buttons(tree)[3].props.onClick()
  assert.deepEqual(h.picks,['heavy']);assert.equal(buttons(tree)[3].props['aria-checked'],true)
})
test('server value and failed save replace optimistic selection',()=>{
  const h=radio();h.render();buttons(h.render())[3].props.onClick();h.render()
  h.render({failTick:1});assert.equal(buttons(h.render())[2].props['aria-checked'],true)
  h.render({value:'light'});assert.equal(buttons(h.render())[1].props['aria-checked'],true)
})
test('arrows wrap and Home/End select with keyboard focus following selection',()=>{
  const h=radio();h.render();let focused=-1,prevented=0
  const event=key=>({key,preventDefault(){prevented++},currentTarget:{querySelectorAll:()=>[0,1,2,3].map(i=>({focus(){focused=i}}))}})
  h.render().props.onKeyDown(event('End'));assert.equal(focused,3)
  h.render().props.onKeyDown(event('ArrowRight'));assert.equal(focused,0)
  h.render().props.onKeyDown(event('ArrowLeft'));assert.equal(focused,3)
  h.render().props.onKeyDown(event('Home'));assert.equal(focused,0)
  assert.deepEqual(h.picks,['heavy','off','heavy','off']);assert.equal(prevented,4)
})
test('disabled choices cannot issue clicks or keyboard setting writes',()=>{
  const h=radio();h.render();const tree=h.render({disabled:true})
  buttons(tree)[3].props.onClick();tree.props.onKeyDown({key:'End'})
  assert.deepEqual(h.picks,[]);assert.ok(buttons(tree).every(b=>b.props.disabled&&b.props.tabIndex===-1))
})
