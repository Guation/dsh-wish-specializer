export function renderToolboxFacts(snapshot, {english=false}={}) {
  if(!snapshot?.entries?.length||snapshot.pending)return ''
  const lines=[english?'[Existing task tools · historical reports; check current availability]':'【本任务已有工具 · 历史调用记录，当前可用性需复查】']
  for(const entry of snapshot.entries){
    lines.push(entry.name+' — '+entry.entrypoint)
    lines.push((english?'Project: ':'使用对象：')+entry.project)
    if(entry.capabilities?.length)lines.push((english?'Reported capabilities: ':'工具声明的能力：')+entry.capabilities.join(' / '))
    if(entry.lastResult){
      const r=entry.lastResult
      lines.push((english?'Last observed tool report: ':'最近实际取得的工具报告：')+r.status+'; callId='+r.callId+'; operation='+r.operation+'; artifactVersion='+(r.reportedArtifactVersion||'unknown'))
      if(r.feedbackRefs?.length)lines.push((english?'Evidence to read: ':'可定向读取的反馈：')+r.feedbackRefs.join(' / '))
    }
  }
  if(snapshot.stopWhen)lines.push((english?'Stop when: ':'停止条件：')+snapshot.stopWhen)
  lines.push(english?'These are host-bound tool-result records, not proof of quality or present runtime readiness. Reuse relevant entries after checking their scope; read feedback before making claims.':'这些是绑定真实调用的历史报告，不能单独证明成品质量或当前运行可用性。核对范围后优先复用相关入口；需要判断画面时实际读取图像，不把路径当成已观察。')
  return lines.join('\n')
}
