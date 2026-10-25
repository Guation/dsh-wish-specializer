import test from 'node:test'
import assert from 'node:assert/strict'
import { createOptimizationRuns } from '../lib/optimization-runs.js'
const ready = packet => ({ ok: true, packet, status: packet ? 'ready' : 'empty' })
test('skip/cancel decisions survive reordered starts and retired requests', () => {
  for (const disposition of ['skip','cancel']) {
    const runs=createOptimizationRuns()
    runs.submit('A',{runId:'late-request',disposition})
    const late=runs.begin('A','late-request')
    assert.equal(late.controller.signal.aborted,true)
    assert.equal(runs.finish(late,ready('must never publish')),false)
    const next=runs.begin('A','new');runs.finish(next,ready('current'))
    const retired=runs.begin('A','late-request')
    assert.equal(runs.isCurrent(retired),false)
    assert.equal(runs.finish(retired,ready('must never replace')),false)
    assert.equal(runs.packet('A'),'current')
  }
})
test('repeated acceptance is idempotent and consumed submissions never rearm', () => {
  const runs=createOptimizationRuns(), run=runs.begin('A','one')
  runs.finish(run,ready('packet'))
  const submission={runId:'one',text:'packet',disposition:'send',outgoingText:'request'}
  assert.equal(runs.submit('A',submission).ok,true)
  assert.equal(runs.submit('A',submission).ok,true)
  assert.equal(runs.submit('A',{...submission,text:'different'}).ok,false)
  assert.equal(runs.consume('A','request').packet,'packet')
  assert.equal(runs.submit('A',submission).reason,'already-submitted')
  assert.equal(runs.consume('A','request'),null)
})
test('terminal result is unavailable until completion; valid empty completes', () => {
  const runs = createOptimizationRuns(), run = runs.begin('A','one')
  assert.equal(runs.packet('A'), '')
  assert.equal(runs.submit('A',{runId:'one',text:'old'}).ok, false)
  assert.equal(runs.finish(run,ready('')), true)
  assert.equal(runs.get('A').status,'empty')
  const sent = runs.submit('A',{runId:'one',text:'',disposition:'send',originalText:'原话'})
  assert.equal(sent.ok,true); assert.equal(runs.consume('A','原话').packet,'')
})
test('cancel and replacement forbid late publication and review writes', () => {
  const runs=createOptimizationRuns(), old=runs.begin('A','old')
  runs.cancel('A','old')
  assert.equal(old.controller.signal.aborted,true)
  assert.equal(runs.finish(old,ready('late')),false)
  const next=runs.begin('A','next'); runs.finish(next,ready('current'))
  assert.equal(runs.submit('A',{runId:'old',text:'late',disposition:'send'}).ok,false)
  assert.equal(runs.submit('A',{runId:'old',disposition:'skip'}).ok,false)
  assert.equal(runs.cancel('A','old').ok,false)
  assert.equal(runs.packet('A'),'current')
})
test('skip aborts optimizer, records exact original without packet, consumed once', () => {
  const runs=createOptimizationRuns(), run=runs.begin('A','one')
  const original='  原话，保留空格 '+String.fromCharCode(10)+'第二行  '
  const r=runs.submit('A',{runId:'one',disposition:'skip',text:'ignored',originalText:original,outgoingText:original})
  assert.equal(r.ok,true); assert.equal(r.packet,''); assert.equal(run.controller.signal.aborted,true)
  assert.equal(runs.packet('A'),''); assert.equal(runs.bypass('A'),true)
  const value=runs.consume('A',original);assert.equal(value.originalText,original);assert.equal(value.outgoingText,original)
  assert.equal(value.skip,true);assert.equal(runs.consume('A','request'),null)
  assert.equal(runs.finish(run,ready('late')),false)
})
test('external abort and another session cannot corrupt completed packets', () => {
  const runs=createOptimizationRuns(), ac=new AbortController()
  const a=runs.begin('A','a',{signal:ac.signal}), b=runs.begin('B','b')
  runs.finish(b,ready('B'));ac.abort()
  assert.equal(runs.finish(a,ready('late A')),false);assert.equal(runs.packet('A'),'');assert.equal(runs.packet('B'),'B')
})
test('auto/reviewed text, stored context and card share accepted bytes', () => {
  const runs=createOptimizationRuns(), run=runs.begin('A','one')
  const packet='[Production suggestions]'+String.fromCharCode(10)+'1. Keep every detail.'
  runs.finish(run,ready(packet));assert.equal(runs.packet('A'),packet)
  assert.equal(runs.submit('A',{runId:'one',text:packet,disposition:'send',outgoingText:'request'}).packet,packet)
  assert.equal(runs.consume('A','request').packet,packet)
  const next=runs.begin('A','two');runs.finish(next,ready(packet))
  runs.submit('A',{runId:'two',text:'',disposition:'send',outgoingText:'request'})
  assert.equal(runs.packet('A'),'');assert.equal(runs.consume('A','request').packet,'')
})

test('higher-generation skip/cancel can arrive before start in an established session', () => {
  for (const disposition of ['skip','cancel']) {
    const runs=createOptimizationRuns(), previous=runs.begin('A','previous',{generation:1})
    runs.finish(previous,ready('previous result'))
    const result=runs.submit('A',{runId:'new',generation:2,disposition,originalText:'request'})
    assert.equal(result.ok,true)
    const delayed=runs.begin('A','new',{generation:2})
    assert.equal(delayed.controller.signal.aborted,true)
    assert.equal(runs.finish(delayed,ready('late')),false)
    const current=runs.begin('A','current',{generation:3});runs.finish(current,ready('current'))
    assert.equal(runs.submit('A',{runId:'old-unknown',generation:1,disposition}).ok,false)
    assert.equal(runs.packet('A'),'current')
  }
})
test('manual rollback can retract unobserved preparation but cannot change a consumed packet', () => {
  const runs=createOptimizationRuns(), run=runs.begin('A','r')
  runs.finish(run,ready('new'));runs.submit('A',{runId:'r',text:'new',outgoingText:'request'})
  const acceptedResult=run.result
  assert.equal(runs.revise('A','r','previous').ok,true)
  assert.notEqual(run.result,acceptedResult)
  assert.equal(runs.consume('A','request'),null)
  runs.submit('A',{runId:'r',text:'previous',outgoingText:'request'})
  assert.equal(runs.consume('A','wrong'),null)
  assert.equal(runs.consume('A','request').packet,'previous')
  assert.equal(runs.revise('A','r','different').ok,false)
})
