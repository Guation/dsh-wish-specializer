const IC={intensity:'<path d="M3 12h4l2-5 3 10 2-5h5"/>',state:'<path d="M12 3v4M12 17v4M3 12h4M17 12h4"/><circle cx="12" cy="12" r="3.2"/>',perm:'<path d="M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6z"/>',model:'<rect x="3" y="5" width="18" height="12" rx="2.5"/><path d="M7 21h10"/>',effort:'<path d="M4 17l5-6 4 3 6-8"/>',ctx:'<path d="M4 7h16M4 12h10M4 17h13"/>',turns:'<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',advisor:'<path d="M12 3l2.2 5.4L20 10.5l-4.4 3.7L16.9 20 12 16.9 7.1 20l1.3-5.8L4 10.5l5.8-2.1z"/>',english:'<path d="M4 6h9M8.5 6v13M4 19h7"/><path d="M14 12h6M17 12v7"/>',tools:'<path d="M6 4l4 4-2 2-4-4z"/><path d="M13 11l7 7-2 2-7-7z"/>',bash:'<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M7 9l3 3-3 3M13 15h4"/>',enter:'<path d="M20 5v6a3 3 0 0 1-3 3H6"/><path d="M9 10l-3 3 3 3"/>',detail:'<circle cx="12" cy="12" r="8"/><path d="M12 11v6M12 8h.01"/>'};
IC.readTools=IC.tools;IC.bash=IC.bash;IC.doubleEnter=IC.enter;
const ico=k=>'<svg class="ic" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+(IC[k]||'')+'</svg>';
const S={tier:'heavy',state:'extreme',advisor:true,english:false,permission:'auto',model:'follow',effort:'max',mode:'turns',turns:6,readTools:true,bash:true,doubleEnter:true,menu:null,tab:'model',save:'idle',fail:false,sheet:false}
const TIERS=[['off','关闭'],['light','轻度'],['standard','标准'],['heavy','重度']]
const MODELS=[['follow','跟随会话模型'],['v31','DeepSeek V3.1'],['r1','DeepSeek R1']]
const EFFORTS=[['max','Max'],['high','High'],['off','Off']]
const TN={off:'关闭',light:'轻度',standard:'标准',heavy:'重度'}
const TD={off:'不拦截，原话直接发送。',light:'少量补充，只点出最关键的方向。',standard:'展开关键方向，保留你的判断空间。',heavy:'深入展开，把想法往前多推一步。'}
const label=(l,k)=>(l.find(x=>x[0]===k)||l[0])[1]
const idx=()=>TIERS.findIndex(t=>t[0]===S.tier)
const dis=()=>S.tier==='off'&&!S.english
function knob(size){const p=[0,66,132,198][idx()]
 const ticks=[0,1,2,3].map(i=>{const a=(-135+90*i)*Math.PI/180,c=(50+31*Math.sin(a)).toFixed(2),s=(50-31*Math.cos(a)).toFixed(2),c2=(50+27*Math.sin(a)).toFixed(2),s2=(50-27*Math.cos(a)).toFixed(2)
  return '<line class="tick" data-on="'+(i===idx())+'" x1="'+c+'" y1="'+s+'" x2="'+c2+'" y2="'+s2+'"/>'}).join('')
 return '<div class="knob" data-knob="1" tabindex="0" role="slider" aria-valuemin="0" aria-valuemax="3" aria-valuenow="'+idx()+'" aria-valuetext="'+TN[S.tier]+'" style="width:'+size+'px;height:'+size+'px"><svg viewBox="0 0 100 100" width="'+size+'" height="'+size+'"><circle class="arc-bg" cx="50" cy="50" r="42" stroke-width="5" stroke-dasharray="198 264" transform="rotate(135 50 50)"/><circle class="arc-fg" cx="50" cy="50" r="42" stroke-width="5" stroke-dasharray="'+p+' 264" transform="rotate(135 50 50)"/>'+ticks+'<g class="needle-g" transform="rotate('+(-135+90*idx())+' 50 50)"><line class="needle" x1="50" y1="50" x2="50" y2="19"/></g><circle cx="50" cy="50" r="4" fill="var(--fg)"/></svg><div class="knob-mid"><b>'+TN[S.tier]+'</b><small>强度</small></div></div>'}
const seg=(k,list,d)=>'<div class="seg" role="radiogroup">'+list.map(function(o){var v=o[0],l=o[1];return '<button role="radio" data-a="'+k+'" data-v="'+v+'" aria-checked="'+(({state:S.state,permission:S.permission,mode:S.mode,tab:S.tab})[k]===v)+'"'+(d?' disabled':'')+'>'+l+'</button>'}).join('')+'</div>'
const sw=(k,on)=>'<button class="swline" data-a="toggle" data-v="'+k+'" aria-checked="'+!!on+'"><span class="lb">'+ico(k)+({advisor:'顾问',english:'英文模式',readTools:'只读工具',bash:'内置 Bash',doubleEnter:'双击 Enter 跳过'})[k]+'</span><span class="sw"></span></button>'
const pick=(k,list,txt)=>'<div class="pick"><button data-a="menu" data-v="'+k+'">'+txt+'<span aria-hidden="true">▾</span></button>'+(S.menu===k?'<div class="menu">'+list.map(function(o){return '<button data-a="pick" data-v="'+k+':'+o[0]+'" aria-selected="'+(({model:S.model,effort:S.effort})[k]===o[0])+'">'+o[1]+'</button>'}).join('')+'</div>':'')+'</div>'
const slider=()=>'<div><div class="row" style="font-size:11.5px;color:var(--fg3)"><span>回合数</span><b style="color:var(--fg)">'+S.turns+'</b></div><input type="range" min="0" max="10" value="'+S.turns+'" data-a="turns"></div>'
const head=()=>'<div class="hd"><strong>优化选项</strong><button class="x" data-a="detail">×</button></div>'
const foot=()=>'<div class="foot"><button class="detail" data-a="detail"><span class="dot"></span>详情 ↗</button><span class="save" data-s="'+(S.fail?'error':S.save)+'">'+(S.fail?'保存失败 · 点此重试':(S.save==='saving'?'保存中…':'自动保存'))+'</span></div>'
const tierRow=()=>'<div class="row" style="font-size:11.5px;color:var(--fg3)"><span>模型状态</span>'+seg('state',[['normal','正常'],['extreme','极限']])+'</div>'
const permRow=()=>'<div class="row" style="font-size:11.5px;color:var(--fg3)"><span>权限</span>'+seg('permission',[['review','审查'],['auto','自动']],dis())+'</div>'
const modelRow=()=>'<div class="row" style="font-size:11.5px;color:var(--fg3)"><span>模型</span><div style="width:172px">'+pick('model',MODELS,label(MODELS,S.model))+'</div></div>'
const effortRow=()=>'<div class="row" style="font-size:11.5px;color:var(--fg3)"><span>思考档位</span><div style="width:112px">'+pick('effort',EFFORTS,label(EFFORTS,S.effort))+'</div></div>'
const ctxRow=()=>'<div class="row" style="font-size:11.5px;color:var(--fg3)"><span>上下文</span>'+seg('mode',[['turns','回合'],['full','全文']],dis())+'</div>'
const allSw=()=>sw('advisor',S.advisor)+sw('english',S.english)+sw('readTools',S.readTools)+sw('bash',S.bash)+sw('doubleEnter',S.doubleEnter)
const gap=n=>'<div style="height:'+n+'px"></div>'
function render(){document.documentElement.dataset.tier=S.tier;document.getElementById('app').innerHTML=LAYOUT()}
function act(a,v){
 if(a==='detail'){S.fail=false;return render()}
 if(a==='tier')S.tier=v;else if(a==='state')S.state=v;else if(a==='permission')S.permission=v
 else if(a==='mode')S.mode=v;else if(a==='tab')S.tab=v;else if(a==='menu')S.menu=S.menu===v?null:v
 else if(a==='pick'){var q=v.split(':');S[q[0]]=q[1];S.menu=null}
 else if(a==='toggle')S[v]=!S[v];else if(a==='sheet')S.sheet=!S.sheet;else if(a==='fail')S.fail=!S.fail
 S.save='saving';render()
 if(!S.fail)setTimeout(function(){if(!S.fail){S.save='saved';render()}},380)}
document.addEventListener('click',function(e){var t=e.target.closest('[data-a]');if(t)act(t.dataset.a,t.dataset.v)})
document.addEventListener('input',function(e){if(e.target.dataset.a==='turns'){S.turns=+e.target.value;render()}})
var drag=false
function tierAt(e,el){var r=el.getBoundingClientRect(),cx=r.left+r.width/2,cy=r.top+r.height/2
 var d=Math.atan2(e.clientX-cx,cy-e.clientY)*180/Math.PI;d=Math.max(-135,Math.min(135,d))
 return TIERS[Math.max(0,Math.min(3,Math.round((d+135)/90)))][0]}
document.addEventListener('pointerdown',function(e){var k=e.target.closest('[data-knob]');if(!k)return
 drag=true;if(k.setPointerCapture)k.setPointerCapture(e.pointerId);var t=tierAt(e,k);if(t!==S.tier){S.tier=t;render()}})
document.addEventListener('pointermove',function(e){if(!drag)return;var k=document.querySelector('[data-knob]');if(!k)return
 var t=tierAt(e,k);if(t!==S.tier){S.tier=t;render()}})
document.addEventListener('pointerup',function(){drag=false})
document.addEventListener('keydown',function(e){var k=e.target.closest&&e.target.closest('[data-knob]');if(!k)return
 var i=idx(),n=null
 if(e.key==='ArrowUp'||e.key==='ArrowRight')n=Math.min(3,i+1)
 else if(e.key==='ArrowDown'||e.key==='ArrowLeft')n=Math.max(0,i-1)
 else if(e.key==='Home')n=0;else if(e.key==='End')n=3
 if(n===null)return;e.preventDefault();S.tier=TIERS[n][0];S.save='saving';render()
 setTimeout(function(){S.save='saved';render()},380)})
var tb=document.getElementById('theme');if(tb)tb.addEventListener('click',function(){document.body.classList.toggle('light');render()})
render()