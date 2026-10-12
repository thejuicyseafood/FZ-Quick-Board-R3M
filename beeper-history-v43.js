(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root){root.FZQBBeeperHistoryCore=api;if(root.document)api.installBrowser(root)}
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const BUILD='R3M.8.43';
  const MAX_BEEPER=20;
  const pad=n=>String(n).padStart(2,'0');
  const text=v=>String(v==null?'':v).trim();
  const normBeeper=v=>{const n=parseInt(text(v),10);return Number.isInteger(n)&&n>=1&&n<=MAX_BEEPER?String(n):''};
  const isoDate=d=>d.toISOString().slice(0,10);
  const dateShiftFromKey=key=>{const m=text(key).match(/^(\d{4}-\d{2}-\d{2})_(AM|PM)$/i);return m?{date:m[1],shift:m[2].toUpperCase(),boardKey:m[1]+'_'+m[2].toUpperCase()}:null};
  const boardKeyFor=(date,shift)=>text(date)+'_'+text(shift).toUpperCase();
  const previousComplete30DayRange=today=>{
    const base=/^\d{4}-\d{2}-\d{2}$/.test(text(today))?new Date(text(today)+'T12:00:00Z'):new Date();
    const to=new Date(base);to.setUTCDate(to.getUTCDate()-1);
    const from=new Date(to);from.setUTCDate(from.getUTCDate()-29);
    return {from:isoDate(from),to:isoDate(to)};
  };
  const datesInRange=(from,to,max=370)=>{
    const a=new Date(text(from)+'T12:00:00Z'),b=new Date(text(to)+'T12:00:00Z'),out=[];
    if(Number.isNaN(a.getTime())||Number.isNaN(b.getTime())||b<a)return out;
    for(let d=new Date(a);d<=b&&out.length<max;d.setUTCDate(d.getUTCDate()+1))out.push(isoDate(d));
    return out;
  };
  const hash=s=>{let h=2166136261;for(const ch of text(s)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)}return (h>>>0).toString(36)};
  const recordId=r=>'b'+pad(Number(normBeeper(r.beeper)||0))+'_'+hash(text(r.server).toLowerCase()+'|'+text(r.section).toLowerCase());
  const makeRecord=(x={})=>{
    const parsed=dateShiftFromKey(x.boardKey)||{date:text(x.date),shift:text(x.shift).toUpperCase(),boardKey:boardKeyFor(x.date,x.shift)};
    const b=normBeeper(x.beeper),server=text(x.server),section=text(x.section||x.sections);
    if(!parsed.date||!['AM','PM'].includes(parsed.shift)||!b||!server)return null;
    const at=Number(x.recordedAt||x.createdAt||x.lastSeenAt||Date.now())||Date.now();
    return {version:1,build:BUILD,date:parsed.date,shift:parsed.shift,boardKey:parsed.boardKey,beeper:b,server,section,recordedAt:at,lastSeenAt:at,source:text(x.source||'UNKNOWN')};
  };
  const indexedValues=v=>Array.isArray(v)?v:(v&&typeof v==='object'?Object.keys(v).sort((a,b)=>Number(a)-Number(b)).map(k=>v[k]):[]);
  function boardUsageRecords(rawBoard,boardKey,source='BOARD',at=Date.now()){
    const out=[],parsed=dateShiftFromKey(boardKey);if(!parsed||!rawBoard||rawBoard.cleared===true)return out;
    indexedValues(rawBoard.rows).forEach(row=>{
      if(!row||!text(row.server))return;
      const rec=makeRecord({boardKey,beeper:row.beeper,server:row.server,section:row.section,source,recordedAt:at});if(rec)out.push(rec);
    });
    return dedupeRecords(out);
  }
  function auditUsageRecords(raw,boardKey,source='TRANSFER AUDIT'){
    const out=[];if(!raw||typeof raw!=='object')return out;
    const parsed=dateShiftFromKey(boardKey);if(!parsed)return out;
    Object.values(raw).forEach(a=>{
      if(!a||typeof a!=='object')return;
      const b=normBeeper(a.beeper||a.rowBeeper||a.sectionBeeper);if(!b)return;
      const at=Number(a.createdAt||Date.now())||Date.now();
      const section=text(a.section||a.selectedSection||a.sourceSection||a.targetSection);
      [a.outgoingServer,a.replacementServer,a.server,a.targetServer,a.sourceServer].forEach((server,idx)=>{
        const rec=makeRecord({boardKey,beeper:b,server,section,source:source+(idx?'':' • PRIMARY'),recordedAt:at});if(rec)out.push(rec);
      });
    });
    return dedupeRecords(out);
  }
  function dedupeRecords(records){
    const map=new Map();
    (records||[]).forEach(raw=>{const r=makeRecord(raw);if(!r)return;const k=r.boardKey+'|'+r.beeper+'|'+r.server.toLowerCase()+'|'+r.section.toLowerCase();const old=map.get(k);if(!old){map.set(k,r);return}old.recordedAt=Math.min(Number(old.recordedAt||r.recordedAt),Number(r.recordedAt));old.lastSeenAt=Math.max(Number(old.lastSeenAt||old.recordedAt),Number(r.lastSeenAt||r.recordedAt));const src=[...new Set((text(old.source)+'|'+text(r.source)).split('|').map(s=>s.trim()).filter(Boolean))];old.source=src.join(' | ')});
    return [...map.values()];
  }
  function filterRecords(records,{from='',to='',beeper='',server=''}={}){
    const b=normBeeper(beeper),q=text(server).toLowerCase();
    return dedupeRecords(records).filter(r=>(!from||r.date>=from)&&(!to||r.date<=to)&&(!b||r.beeper===b)&&(!q||r.server.toLowerCase().includes(q))).sort((a,b)=>b.date.localeCompare(a.date)||b.shift.localeCompare(a.shift)||Number(a.beeper)-Number(b.beeper)||a.server.localeCompare(b.server));
  }
  function lastSeenByBeeper(records){
    const out={};for(let i=1;i<=MAX_BEEPER;i++)out[String(i)]=null;
    filterRecords(records).forEach(r=>{const cur=out[r.beeper];if(!cur||r.date>cur.date||(r.date===cur.date&&r.shift==='PM'&&cur.shift==='AM')||(r.date===cur.date&&r.shift===cur.shift&&Number(r.lastSeenAt||0)>Number(cur.lastSeenAt||0)))out[r.beeper]=r});
    return out;
  }
  function summary(records,opts={}){const list=filterRecords(records,opts),seen=new Set(list.map(r=>r.beeper)),servers=new Set(list.map(r=>r.server));return {records:list.length,beepers:seen.size,servers:servers.size,lastSeen:lastSeenByBeeper(list),list}}

  function installBrowser(w){
    const d=w.document;
    const rt={
      get root(){try{return ROOT}catch(_){return ''}},
      get boardRoot(){try{return BOARD_ROOT}catch(_){return ''}},
      get selectedDate(){try{return selectedDate()}catch(_){return new Date().toISOString().slice(0,10)}},
      get shift(){try{return shift()}catch(_){return 'AM'}},
      get board(){try{return board}catch(_){return null}},
      read:async path=>{try{return await readJ(path)}catch(e){throw e}},
      write:async(path,data,method='PUT')=>{try{return await writeJ(path,data,method)}catch(e){throw e}},
      toast:msg=>{try{toast(msg)}catch(_){console.log(msg)}},
      isManager:()=>{try{return quickIsManager()}catch(_){return false}}
    };
    const historyRoot=()=>rt.root+'/beeperHistoryV1';
    const esc=s=>text(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    function pathFor(r){return historyRoot()+'/'+r.boardKey+'/'+recordId(r)}
    async function persistRecord(rec,verify=false){
      const r=makeRecord(rec);if(!r)return false;const path=pathFor(r),old=await rt.read(path+'.json').catch(()=>null),merged={...r,recordedAt:old&&old.recordedAt?Math.min(Number(old.recordedAt),Number(r.recordedAt)):r.recordedAt,lastSeenAt:Math.max(Number(old&&old.lastSeenAt||0),Number(r.lastSeenAt||r.recordedAt)),source:[...new Set((text(old&&old.source)+'|'+text(r.source)).split('|').map(s=>s.trim()).filter(Boolean))].join(' | ')};
      await rt.write(path+'.json',merged,'PUT');if(verify){const check=await rt.read(path+'.json');if(!check||text(check.beeper)!==r.beeper||text(check.server)!==r.server)throw new Error('Beeper History verification failed for Beeper '+r.beeper+' • '+r.server)}return true;
    }
    async function persistRecords(records,verify=false){let saved=0;for(const r of dedupeRecords(records)){if(await persistRecord(r,verify))saved++}return saved}
    async function captureCurrent(source='LIVE BOARD',verify=false){const key=boardKeyFor(rt.selectedDate,rt.shift),records=boardUsageRecords(rt.board,key,source,Date.now());if(!records.length)return true;try{await persistRecords(records,verify);return true}catch(e){rt.toast('BEEPER HISTORY SAVE FAILED • '+(e&&e.message||'check connection'));return false}}
    w.FZQBBeeperPreClear=async()=>{const ok=await captureCurrent('AUTO BEFORE CLEAR SHIFT',true);if(!ok){rt.toast('CLEAR SHIFT STOPPED • BEEPER HISTORY WAS NOT VERIFIED');return false}return true};
    w.FZQBBeeperTrackVerified=async info=>{const key=text(info&&info.boardKey)||boardKeyFor(rt.selectedDate,rt.shift),rec=makeRecord({boardKey:key,beeper:info&&info.beeper,server:info&&info.server,section:info&&info.section,source:info&&info.source||'VERIFIED BEEPER SAVE',recordedAt:Date.now()});if(!rec)return true;try{return await persistRecord(rec,true)}catch(e){rt.toast('BEEPER SAVED • HISTORY LOG FAILED');return false}};

    async function readLedgerRange(from,to){
      const keys=[];datesInRange(from,to).forEach(date=>{keys.push(date+'_AM',date+'_PM')});const records=[];
      for(let i=0;i<keys.length;i+=10){const batch=keys.slice(i,i+10);const vals=await Promise.all(batch.map(k=>rt.read(historyRoot()+'/'+k+'.json').catch(()=>null)));vals.forEach((raw,idx)=>{if(!raw)return;Object.values(raw).forEach(v=>{const r=makeRecord(v);if(r)records.push(r)})})}
      return dedupeRecords(records);
    }
    async function recoverKey(key){
      const [rawBoard,a95,a96]=await Promise.all([
        rt.read(rt.boardRoot+'/'+key+'.json').catch(()=>null),
        rt.read(rt.root+'/breaktimeTransfersV1095/'+key+'.json').catch(()=>null),
        rt.read(rt.root+'/breaktimeTransfersV1096/'+key+'.json').catch(()=>null)
      ]);
      return dedupeRecords([...boardUsageRecords(rawBoard,key,'RECOVERED LIVE BOARD'),...auditUsageRecords(a95,key,'RECOVERED BREAKTIME V1095'),...auditUsageRecords(a96,key,'RECOVERED BREAKTIME V1096')]);
    }
    async function backfillRange(from,to,onProgress){
      const keys=[];datesInRange(from,to).forEach(date=>{keys.push(date+'_AM',date+'_PM')});let found=0,saved=0;
      for(let i=0;i<keys.length;i+=6){const batch=keys.slice(i,i+6),rows=await Promise.all(batch.map(recoverKey));for(let j=0;j<rows.length;j++){found+=rows[j].length;saved+=await persistRecords(rows[j],false)}if(onProgress)onProgress(Math.min(keys.length,i+batch.length),keys.length,found)}return {keys:keys.length,found,saved};
    }
    function downloadCsv(records,from,to){
      const rows=[['Date','Shift','Beeper','Server','Section','Source']];filterRecords(records,{from,to}).forEach(r=>rows.push([r.date,r.shift,r.beeper,r.server,r.section,r.source]));const csv=rows.map(row=>row.map(v=>'"'+String(v==null?'':v).replace(/"/g,'""')+'"').join(',')).join('\r\n'),blob=new Blob([csv],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=d.createElement('a');a.href=url;a.download='FZ_Beeper_History_'+from+'_to_'+to+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
    }
    function ensureStyle(){if(d.getElementById('fzBeeperHistoryStyle'))return;const s=d.createElement('style');s.id='fzBeeperHistoryStyle';s.textContent=`
      .fzBHOverlay{position:fixed;inset:0;z-index:2147482100;background:rgba(2,12,23,.92);display:none;align-items:flex-start;justify-content:center;padding:18px;overflow:auto}.fzBHOverlay.show{display:flex}.fzBH{width:min(1180px,100%);background:linear-gradient(180deg,#0a2235,#061724);border:1px solid #31556e;border-radius:18px;color:#fff;box-shadow:0 25px 80px #000;padding:18px;font-family:Arial,sans-serif}.fzBH h2{font-size:28px;margin:0 0 3px}.fzBH p{color:#9fc1d8;margin:0 0 14px}.fzBHFilters{display:grid;grid-template-columns:1fr 1fr 150px 1fr auto auto;gap:8px;align-items:end}.fzBHFilters label{display:block;font-size:10px;font-weight:1000;color:#8fb4ca;margin-bottom:4px}.fzBHFilters input,.fzBHFilters select{width:100%;height:42px;border:1px solid #365e78;border-radius:10px;background:#0d2b40;color:#fff;padding:0 10px;font-weight:900}.fzBHBtn{height:42px;border:0;border-radius:10px;padding:0 14px;font-weight:1000;background:#54d7ff;color:#06141d}.fzBHBtn.secondary{background:#17374e;color:#fff;border:1px solid #3f6982}.fzBHStatus{margin:12px 0;padding:10px 12px;background:#102c40;border-radius:10px;color:#c8eaff;font-weight:900}.fzBHCards{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:10px 0}.fzBHCard{background:#0c2b40;border:1px solid #28516b;border-radius:13px;padding:11px}.fzBHCard b{display:block;font-size:25px;color:#67ddff}.fzBHCard span{font-size:10px;color:#9fc1d8;font-weight:900}.fzBHLast{display:grid;grid-template-columns:repeat(5,1fr);gap:7px;margin:12px 0}.fzBHLastItem{background:#0d2537;border:1px solid #29485e;border-radius:10px;padding:8px;min-height:74px}.fzBHLastItem strong{font-size:18px;color:#ffd166}.fzBHLastItem div{font-size:11px;line-height:1.35;margin-top:4px}.fzBHTableWrap{overflow:auto;border:1px solid #2e5066;border-radius:12px;max-height:48vh}.fzBH table{width:100%;border-collapse:collapse;min-width:760px}.fzBH th,.fzBH td{padding:9px 10px;border-bottom:1px solid #17384d;text-align:left;font-size:12px}.fzBH th{position:sticky;top:0;background:#13354b;color:#9ee6ff;z-index:1}.fzBHNote{margin-top:10px;color:#ffdca0;font-size:12px;line-height:1.45}.fzBHClose{float:right;background:#7f1d1d;color:#fff;border:0;border-radius:9px;padding:9px 13px;font-weight:1000}@media(max-width:760px){.fzBHOverlay{padding:4px}.fzBH{padding:11px;border-radius:10px}.fzBHFilters{grid-template-columns:1fr 1fr}.fzBHFilters .wide{grid-column:1/-1}.fzBHCards{grid-template-columns:1fr 1fr 1fr}.fzBHLast{grid-template-columns:repeat(2,1fr)}}`;
      d.head.appendChild(s)
    }
    function ensureUi(){
      if(d.getElementById('fzBeeperHistoryOverlay'))return;
      ensureStyle();const wrap=d.createElement('div');wrap.id='fzBeeperHistoryOverlay';wrap.className='fzBHOverlay';const range=previousComplete30DayRange(rt.selectedDate);
      wrap.innerHTML=`<div class="fzBH"><button id="fzBHClose" class="fzBHClose">CLOSE</button><h2>Beeper History / Last Seen</h2><p>Manager / Owner • persistent history survives Clear Shift</p><div class="fzBHFilters"><div><label>FROM</label><input id="fzBHFrom" type="date" value="${range.from}"></div><div><label>TO</label><input id="fzBHTo" type="date" value="${range.to}"></div><div><label>BEEPER</label><select id="fzBHBeeper"><option value="">ALL 1–20</option>${Array.from({length:20},(_,i)=>`<option value="${i+1}">${i+1}</option>`).join('')}</select></div><div><label>SERVER</label><input id="fzBHServer" placeholder="All servers"></div><button id="fzBHLoad" class="fzBHBtn">LOAD</button><button id="fzBHBackfill" class="fzBHBtn secondary">BACKFILL OLD DATA</button></div><div id="fzBHStatus" class="fzBHStatus">Ready.</div><div id="fzBHCards" class="fzBHCards"></div><h3>LAST SEEN • BEEPERS 1–20</h3><div id="fzBHLast" class="fzBHLast"></div><div style="display:flex;justify-content:flex-end;margin:8px 0"><button id="fzBHCsv" class="fzBHBtn secondary">DOWNLOAD CSV</button></div><div class="fzBHTableWrap"><table><thead><tr><th>Date</th><th>Shift</th><th>Beeper</th><th>Server</th><th>Section</th><th>Source</th></tr></thead><tbody id="fzBHRows"></tbody></table></div><div class="fzBHNote"><b>Historical recovery note:</b> R3M.8.42 and older did not keep a permanent Beeper ledger. BACKFILL can recover records still present in live Board data and some Breaktime transfer audits. If an old shift was fully cleared and no audit survived, that old Beeper assignment cannot be reconstructed safely. From R3M.8.43 forward, Beeper history is saved separately and Clear Shift does not delete it.</div></div>`;d.body.appendChild(wrap);
      d.getElementById('fzBHClose').onclick=()=>wrap.classList.remove('show');d.getElementById('fzBHLoad').onclick=()=>refreshUi();d.getElementById('fzBHBackfill').onclick=async()=>{const from=d.getElementById('fzBHFrom').value,to=d.getElementById('fzBHTo').value,status=d.getElementById('fzBHStatus');status.textContent='Scanning old Board / transfer audit data…';d.getElementById('fzBHBackfill').disabled=true;try{const result=await backfillRange(from,to,(done,total,found)=>status.textContent='BACKFILL '+done+'/'+total+' SHIFT KEYS • '+found+' recoverable records found');status.textContent='BACKFILL COMPLETE • '+result.found+' recoverable records • '+result.saved+' records saved';await refreshUi()}catch(e){status.textContent='BACKFILL FAILED • '+(e&&e.message||'connection error')}finally{d.getElementById('fzBHBackfill').disabled=false}};d.getElementById('fzBHCsv').onclick=async()=>{const from=d.getElementById('fzBHFrom').value,to=d.getElementById('fzBHTo').value,records=await readLedgerRange(from,to);downloadCsv(records,from,to)};
      ['fzBHBeeper','fzBHServer','fzBHFrom','fzBHTo'].forEach(id=>d.getElementById(id).addEventListener('change',refreshUi));
    }
    async function refreshUi(){ensureUi();const from=d.getElementById('fzBHFrom').value,to=d.getElementById('fzBHTo').value,beeper=d.getElementById('fzBHBeeper').value,server=d.getElementById('fzBHServer').value,status=d.getElementById('fzBHStatus');status.textContent='Loading saved Beeper history…';try{const records=await readLedgerRange(from,to),sum=summary(records,{from,to,beeper,server}),last=sum.lastSeen;d.getElementById('fzBHCards').innerHTML=`<div class="fzBHCard"><b>${sum.records}</b><span>USAGE RECORDS</span></div><div class="fzBHCard"><b>${sum.beepers}</b><span>BEEPERS SEEN</span></div><div class="fzBHCard"><b>${sum.servers}</b><span>SERVERS</span></div>`;d.getElementById('fzBHLast').innerHTML=Array.from({length:20},(_,i)=>{const n=String(i+1),r=last[n];return `<div class="fzBHLastItem"><strong>BEEPER ${n}</strong><div>${r?`${esc(r.date)} • ${esc(r.shift)}<br>${esc(r.server)}${r.section?` • ${esc(r.section)}`:''}`:'No recoverable record in this range'}</div></div>`}).join('');d.getElementById('fzBHRows').innerHTML=sum.list.map(r=>`<tr><td>${esc(r.date)}</td><td>${esc(r.shift)}</td><td><b>${esc(r.beeper)}</b></td><td>${esc(r.server)}</td><td>${esc(r.section||'—')}</td><td>${esc(r.source)}</td></tr>`).join('')||'<tr><td colspan="6">No saved/recoverable Beeper records for this filter.</td></tr>';status.textContent=`${from} → ${to} • ${sum.records} matching usage records. Use BACKFILL OLD DATA once for pre-R3M.8.43 history.`}catch(e){status.textContent='LOAD FAILED • '+(e&&e.message||'connection error')}}
    function open(){if(!rt.isManager())return rt.toast('Beeper History • Manager / Owner only');ensureUi();d.getElementById('fzBeeperHistoryOverlay').classList.add('show');refreshUi()}
    function installButton(){const grid=d.querySelector('#quickMorePane .quickGroup:nth-of-type(4) .quickMenuGrid')||d.querySelector('#quickReports')?.parentElement;if(!grid||d.getElementById('quickBeeperHistory'))return;const b=d.createElement('button');b.id='quickBeeperHistory';b.className='quickMenuBtn quickManagerOnly';b.innerHTML='<strong>📟 Beeper History / Last Seen</strong><span>Manager • number, server, date, shift • survives Clear Shift</span>';b.onclick=open;const reports=d.getElementById('quickReports');if(reports&&reports.parentElement===grid)grid.insertBefore(b,reports.nextSibling);else grid.appendChild(b)}
    function init(){ensureUi();installButton();setTimeout(()=>captureCurrent('AUTO LIVE CAPTURE',false),2500);setInterval(()=>captureCurrent('AUTO LIVE CAPTURE',false),60000)}
    if(d.readyState==='loading')d.addEventListener('DOMContentLoaded',init,{once:true});else init();
    w.FZQBBeeperHistoryOpen=open;w.FZQBBeeperHistoryBackfill=backfillRange;
  }
  return {BUILD,MAX_BEEPER,normBeeper,dateShiftFromKey,previousComplete30DayRange,datesInRange,recordId,makeRecord,boardUsageRecords,auditUsageRecords,dedupeRecords,filterRecords,lastSeenByBeeper,summary,installBrowser};
});
