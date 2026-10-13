/* FZ Quick Board R3M.8.44 — Persistent Table Shift Report / Audit Trail */
(function(global){
'use strict';
const BUILD='R3M.8.44';
const AUDIT_CHILD='tableAuditV44';
const MAX_LOCAL_PENDING=200;
const EVENT_LABELS={
  SEATED:'SEATED',CANCEL_RESET:'CANCEL / RESET',TABLE_SWAP:'TABLE SWAP',SERVER_SWAP:'SERVER SWAP',TABLE_SERVER_SWAP:'TABLE + SERVER SWAP',
  READY:'READY / RELEASED',CLEANING:'CLEANING',RESTORE:'RESTORED',EDIT_PEOPLE:'PEOPLE EDITED',SECONDARY_CHANGE:'SECONDARY TABLES',
  BOARD_HISTORY_DELETE:'BOARD HISTORY DELETE',RESERVED:'RESERVED',BACKFILL_SEATED:'SEATED • BACKFILL',BACKFILL_CANCEL:'CANCEL / RESET • BACKFILL'
};
function txt(v){return String(v==null?'':v)}
function num(v,d=0){const n=Number(v);return Number.isFinite(n)?n:d}
function escHtml(v){return txt(v).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
function canon(v){try{return typeof canonicalServerName==='function'?canonicalServerName(v):txt(v).trim()}catch(_){return txt(v).trim()}}
function currentRole(){try{return typeof role==='function'?role():''}catch(_){return ''}}
function device(){try{return typeof deviceId==='function'?deviceId():''}catch(_){return ''}}
function currentKey(){try{return typeof boardKey==='function'?boardKey():''}catch(_){return ''}}
function keyFor(date,sh){return txt(date)+'_'+txt(sh).toUpperCase()}
function dateFromKey(key){const m=txt(key).match(/^(\d{4}-\d{2}-\d{2})_(AM|PM)$/);return m?m[1]:''}
function shiftFromKey(key){const m=txt(key).match(/_(AM|PM)$/);return m?m[1]:''}
function auditRoot(){try{return ROOT+'/'+AUDIT_CHILD}catch(_){return 'https://table-live-by-iwanto-zhang-default-rtdb.firebaseio.com/juicyTableLive/JUICY-HUNTSVILLE/flexibleFloorV1/'+AUDIT_CHILD}}
function pathFor(key){return auditRoot()+'/'+key}
function parseSeatTime(entryId){const m=txt(entryId).match(/^seat_(\d{11,})_/i);const n=m?Number(m[1]):0;return Number.isFinite(n)&&n>0?n:0}
function now(){return Date.now()}
function idSafe(v){return txt(v).replace(/[^A-Za-z0-9_-]/g,'_').slice(0,140)}
function eventId(rec){const base=[rec.type||'EVENT',rec.partyId||'NA',rec.table||rec.toTable||rec.fromTable||'',rec.at||now(),rec.fromTable||'',rec.toTable||'',rec.fromServer||'',rec.toServer||''].join('_');return idSafe(base)}
function tableStatus(state){try{return typeof operationalTableStatus==='function'?operationalTableStatus(state||{}):txt(state&&state.status).toLowerCase()}catch(_){return txt(state&&state.status).toLowerCase()}}
function clone(v){try{return JSON.parse(JSON.stringify(v==null?null:v))}catch(_){return v}}
function toastSafe(msg){try{if(typeof toast==='function')toast(msg)}catch(_){}}
function boardKeyFromState(state){const ref=state&&(state.boardRef||state.primaryBoardRef);return txt(ref&&ref.boardKey)||currentKey()}
function normalizeEvent(rec){
  rec=rec||{};const key=txt(rec.boardKey||currentKey());const at=num(rec.at,now());
  const partyId=txt(rec.partyId),seatedAt=num(rec.seatedAt,parseSeatTime(partyId));return {build:BUILD,eventId:txt(rec.eventId||eventId({...rec,at})),boardKey:key,date:txt(rec.date||dateFromKey(key)),shift:txt(rec.shift||shiftFromKey(key)),type:txt(rec.type||'EVENT'),label:txt(rec.label||EVENT_LABELS[rec.type]||rec.type||'EVENT'),table:txt(rec.table||rec.toTable||rec.fromTable),fromTable:txt(rec.fromTable),toTable:txt(rec.toTable),server:canon(rec.server||rec.toServer||rec.fromServer),fromServer:canon(rec.fromServer),toServer:canon(rec.toServer),people:txt(rec.people),partyId,seatedAt,at,by:txt(rec.by||currentRole()),deviceId:txt(rec.deviceId||device()),note:txt(rec.note),source:txt(rec.source||'LIVE AUDIT')};
}
function pendingKey(){return 'fzqb_table_audit_pending_v44'}
function loadPending(){try{const a=JSON.parse(localStorage.getItem(pendingKey())||'[]');return Array.isArray(a)?a:[]}catch(_){return []}}
function savePending(a){try{localStorage.setItem(pendingKey(),JSON.stringify((a||[]).slice(-MAX_LOCAL_PENDING)))}catch(_){}}
function queuePending(rec){const list=loadPending();const id=txt(rec.eventId);if(!list.some(x=>txt(x&&x.eventId)===id))list.push(rec);savePending(list)}
async function putVerified(rec,quiet=false){
  rec=normalizeEvent(rec);if(!rec.boardKey||!rec.eventId)return false;const p=pathFor(rec.boardKey)+'/'+rec.eventId+'.json';
  for(let attempt=0;attempt<3;attempt++){
    try{await writeJ(p,rec,'PUT');const check=await readJ(p);if(check&&txt(check.eventId)===rec.eventId&&txt(check.type)===rec.type){return true}}catch(_){ }
    await new Promise(r=>setTimeout(r,100+attempt*180));
  }
  queuePending(rec);if(!quiet)toastSafe('Table report audit queued • will retry');return false;
}
async function flushPending(){const list=loadPending();if(!list.length)return 0;const remain=[];let saved=0;for(const rec of list){if(await putVerified(rec,true))saved++;else remain.push(rec)}savePending(remain);return saved}
function partyFind(partyId){if(!partyId)return null;try{for(const [id,s] of Object.entries(tableState||{})){if(s&&txt(s.partyId)===txt(partyId)&&!s.secondaryOf)return {id,state:s}}}catch(_){ }return null}
async function recordSeatFromState(table,state,source='LIVE SEAT',allowSecondary=false){
  if(!state||tableStatus(state)!=='seated'||(state.secondaryOf&&!allowSecondary))return false;const key=boardKeyFromState(state),pid=txt(state.partyId),at=parseSeatTime(pid)||num(state.updatedAt,now()),people=state.people||state.partyPeople;
  const note=state.secondaryOf?('Secondary table seated with '+txt(state.secondaryOf)+' • server '+canon(state.server)):'Table seated • server '+canon(state.server)+(people?(' • '+people+' guests'):'');
  const rec=normalizeEvent({type:'SEATED',boardKey:key,table,server:state.server,people,partyId:pid,at,note,source});rec.eventId=idSafe('seat_'+(pid||[table,canon(state.server),at].join('_'))+'_'+table);return putVerified(rec);
}
function indexed(value){if(Array.isArray(value))return value;const out=[];if(value&&typeof value==='object')Object.entries(value).forEach(([k,v])=>{if(/^\d+$/.test(k))out[Number(k)]=v});return out}
async function backfillShift(key,{quiet=false}={}){
  key=txt(key);if(!key)return {found:0,saved:0,errors:1};let found=0,saved=0,errors=0;
  try{
    const raw=await readJ(BOARD_ROOT+'/'+key+'.json');const rows=indexed(raw&&raw.rows);
    for(let ri=0;ri<rows.length;ri++){
      const row=rows[ri]||{},turns=indexed(row.turns),server=canon(row.server),section=txt(row.section);
      for(let ti=0;ti<turns.length;ti++){
        const t=turns[ti]||{};if(t.skipped||!txt(t.table))continue;const pid=txt(t.entryId),at=parseSeatTime(pid)||num(t.at||t.seatedAt||t.createdAt||t.updatedAt||row.updatedAt,0);if(!at)continue;found++;
        const rec=normalizeEvent({type:'BACKFILL_SEATED',boardKey:key,table:t.table,server,people:t.people,partyId:pid,at,note:'Recovered from surviving Host Board'+(section?(' • Section '+section):''),source:'BACKFILL HOST BOARD'});rec.eventId=idSafe('seat_'+(pid||[t.table,server,at].join('_'))+'_'+txt(t.table));
        if(await putVerified(rec,true))saved++;
      }
    }
  }catch(_){errors++}
  try{
    const hist=(await readJ(FLOOR_HISTORY_ROOT+'/'+key+'.json'))||{};const seen=new Set();
    const vals=Object.values(hist).filter(x=>x&&x.action==='delete').sort((a,b)=>num(a.at)-num(b.at));
    for(const h of vals){const st=h.state||{},pid=txt(st.partyId),sig=[pid,h.tableId,Math.floor(num(h.at)/1000)].join('|');if(seen.has(sig))continue;seen.add(sig);found++;
      const rec=normalizeEvent({type:'BACKFILL_CANCEL',boardKey:key,table:h.tableId,server:h.server||st.server,people:st.people||st.partyPeople,partyId:pid,at:num(h.at,now()),note:'Recovered cancel/reset from Floor undo history',source:'BACKFILL FLOOR HISTORY'});rec.eventId=idSafe('cancel_'+(pid||h.tableId)+'_'+rec.at);if(await putVerified(rec,true))saved++;
    }
  }catch(_){errors++}
  if(!quiet)toastSafe('TABLE REPORT BACKFILL • '+found+' found • '+saved+' saved'+(errors?' • '+errors+' read error(s)':''));return {found,saved,errors};
}
async function preClear(target){try{await flushPending();if(loadPending().length)return false;const key=txt(target||currentKey()),result=await backfillShift(key,{quiet:true});if(result.errors||result.saved<result.found)return false;await flushPending();return loadPending().length===0}catch(_){return false}}
global.FZQBTableAuditPreClear=preClear;
global.FZQBTableAuditRecord=putVerified;
global.FZQBTableAuditBackfill=backfillShift;

function wrapOperations(){
  if(global.__fzTableAuditWrapped)return;global.__fzTableAuditWrapped=true;
  if(typeof global.applyFloorSeat==='function'){
    const orig=global.applyFloorSeat;global.applyFloorSeat=async function(){const table=txt(selectedTable),before=clone((tableState||{})[table]||{});const result=await orig.apply(this,arguments);const after=clone((tableState||{})[table]||{});if(table&&tableStatus(after)==='seated'&&txt(after.partyId)&&txt(after.partyId)!==txt(before.partyId)){await recordSeatFromState(table,after);const secs=Array.isArray(after.secondaryTables)?after.secondaryTables:[];for(const sec of secs){const ss=clone((tableState||{})[sec]||{});if(txt(ss.partyId)===txt(after.partyId))await recordSeatFromState(sec,ss,'LIVE SEAT • SECONDARY',true)}}return result};
  }
  if(typeof global.resetWrongFloorEntry==='function'){
    const orig=global.resetWrongFloorEntry;global.resetWrongFloorEntry=async function(sourceOverride='',peopleOverride=null){const source=txt((typeof sourceOverride==='string'&&sourceOverride)||((document.getElementById('moveSourceTable')||{}).value)||selectedTable),before=clone((tableState||{})[source]||{}),key=boardKeyFromState(before),pid=txt(before.partyId),oldPeople=txt(before.people||before.partyPeople);const linked=Array.isArray(before.secondaryTables)?before.secondaryTables.slice():[];const result=await orig.apply(this,arguments);const after=clone((tableState||{})[source]||{});if(peopleOverride!==null&&tableStatus(after)==='seated'&&txt(after.partyId)===pid&&txt(after.people)!==oldPeople){await putVerified({type:'EDIT_PEOPLE',boardKey:key,table:source,server:before.server,people:after.people,partyId:pid,at:num(after.updatedAt,now()),note:'People changed '+oldPeople+' → '+txt(after.people),source:'EDIT PEOPLE'})}else if(pid&&tableStatus(before)==='seated'&&tableStatus(after)!=='seated'){const at=num(after.updatedAt,now());await putVerified({type:'CANCEL_RESET',boardKey:key,table:source,server:before.server,people:oldPeople,partyId:pid,at,note:'Cancelled / reset • party removed from Floor and rotation',source:'RESET / DELETE'});for(const sec of linked)await putVerified({type:'CANCEL_RESET',boardKey:key,table:sec,server:before.server,people:oldPeople,partyId:pid,at,note:'Secondary table released with '+source+' cancel/reset',source:'RESET / DELETE • SECONDARY'})}return result};
  }
  if(typeof global.saveMoveChange==='function'){
    const orig=global.saveMoveChange;global.saveMoveChange=async function(){const source=txt((document.getElementById('moveSourceTable')||{}).value),before=clone((tableState||{})[source]||{}),pid=txt(before.partyId),key=boardKeyFromState(before),fromServer=canon(before.server),fromTable=source,mode=txt(swapMode);const result=await orig.apply(this,arguments);const hit=partyFind(pid);if(pid&&hit){const toTable=hit.id,toServer=canon(hit.state.server);let type='TABLE_SERVER_SWAP';if(fromTable!==toTable&&fromServer===toServer)type='TABLE_SWAP';else if(fromTable===toTable&&fromServer!==toServer)type='SERVER_SWAP';else if(fromTable===toTable&&fromServer===toServer)return result;await putVerified({type,boardKey:key,table:toTable,fromTable,toTable,server:toServer,fromServer,toServer,people:hit.state.people||before.people,partyId:pid,at:num(hit.state.updatedAt,now()),note:type==='TABLE_SWAP'?(fromTable+' → '+toTable+' • same server '+toServer):type==='SERVER_SWAP'?(toTable+' • '+fromServer+' → '+toServer):(fromTable+' → '+toTable+' • '+fromServer+' → '+toServer),source:'MOVE / CHANGE '+mode.toUpperCase()})}return result};
  }
  if(typeof global.setStatus==='function'){
    const orig=global.setStatus;global.setStatus=async function(status){const table=txt(selectedTable),before=clone((tableState||{})[table]||{}),key=boardKeyFromState(before),pid=txt(before.partyId),beforeStatus=tableStatus(before);const result=await orig.apply(this,arguments);const after=clone((tableState||{})[table]||{}),afterStatus=tableStatus(after);if(table&&beforeStatus!==afterStatus){const type=afterStatus==='ready'?'READY':afterStatus==='cleaning'?'CLEANING':'';if(type)await putVerified({type,boardKey:key,table,server:before.server||after.server,people:before.people||before.partyPeople,partyId:pid,at:num(after.updatedAt,now()),note:type==='READY'?'Table released / marked READY':'Table marked CLEANING',source:'FLOOR STATUS'})}return result};
  }
  if(typeof global.restoreFloorHistory==='function'){
    const orig=global.restoreFloorHistory;global.restoreFloorHistory=async function(){const rec=clone(quickUndoPending||{}),table=txt(rec.tableId);const result=await orig.apply(this,arguments);const after=clone((tableState||{})[table]||{});if(table&&tableStatus(after)==='seated'){await putVerified({type:'RESTORE',boardKey:boardKeyFromState(after),table,server:after.server,people:after.people||after.partyPeople,partyId:after.partyId,at:num(after.updatedAt,now()),note:'UNDO DELETE restored table to '+canon(after.server),source:'UNDO DELETE'})}return result};
  }
  if(typeof global.saveEditedSecondaries==='function'){
    const orig=global.saveEditedSecondaries;global.saveEditedSecondaries=async function(){const primary=txt(editSecondaryPrimary),before=clone((tableState||{})[primary]||{}),oldSet=Array.isArray(before.secondaryTables)?before.secondaryTables.slice():[];const result=await orig.apply(this,arguments);const after=clone((tableState||{})[primary]||{}),newSet=Array.isArray(after.secondaryTables)?after.secondaryTables.slice():[];if(primary&&JSON.stringify(oldSet)!==JSON.stringify(newSet))await putVerified({type:'SECONDARY_CHANGE',boardKey:boardKeyFromState(after||before),table:primary,server:(after||before).server,people:(after||before).people,partyId:(after||before).partyId,at:num((after||before).updatedAt,now()),note:'Secondary tables: '+(oldSet.join(', ')||'none')+' → '+(newSet.join(', ')||'none'),source:'EDIT SECONDARY'});return result};
  }
  if(typeof global.clearHistoryParty26==='function'){
    const orig=global.clearHistoryParty26;global.clearHistoryParty26=async function(ri,ti){let ev=null;try{ev=clone(board&&board.rows&&board.rows[ri]&&board.rows[ri].turns&&board.rows[ri].turns[ti]);ev={...ev,server:board.rows[ri].server,key:currentKey()}}catch(_){ }const result=await orig.apply(this,arguments);if(ev&&ev.table)await putVerified({type:'BOARD_HISTORY_DELETE',boardKey:ev.key,table:ev.table,server:ev.server,people:ev.people,partyId:ev.entryId,at:now(),note:'Historical Board party deleted • later rotation entries compacted',source:'BOARD HISTORY DELETE'});return result};
  }
  if(typeof global.quickWizardSetReserved==='function'){
    const orig=global.quickWizardSetReserved;global.quickWizardSetReserved=async function(){const table=txt(selectedTable),before=clone((tableState||{})[table]||{});const result=await orig.apply(this,arguments);const after=clone((tableState||{})[table]||{});if(table&&tableStatus(after)==='reserved'&&tableStatus(before)!=='reserved')await putVerified({type:'RESERVED',boardKey:currentKey(),table,server:after.server||before.server,people:after.people||before.people,partyId:after.partyId||before.partyId,at:num(after.updatedAt,now()),note:'Table marked RESERVED',source:'RESERVATION'});return result};
  }
  /* A few legacy controls captured their original function object with element.onclick=fn
     before this module loaded. Rebind those controls to the wrapped audit-aware functions. */
  try{const x=document.getElementById('moveSave');if(x&&typeof global.saveMoveChange==='function')x.onclick=global.saveMoveChange}catch(_){}
  try{const x=document.getElementById('quickUndoRestore');if(x&&typeof global.restoreFloorHistory==='function')x.onclick=global.restoreFloorHistory}catch(_){}
  try{const x=document.getElementById('editSecondarySave');if(x&&typeof global.saveEditedSecondaries==='function')x.onclick=global.saveEditedSecondaries}catch(_){}
  try{const x=document.getElementById('quickWizardReservation');if(x&&typeof global.quickWizardSetReserved==='function')x.onclick=global.quickWizardSetReserved}catch(_){}
}

function fmtTime(at){if(!at)return '—';try{return new Date(Number(at)).toLocaleTimeString([], {hour:'numeric',minute:'2-digit',second:'2-digit'})}catch(_){return '—'}}
function fmtDate(at){if(!at)return '—';try{return new Date(Number(at)).toLocaleDateString()}catch(_){return '—'}}
function details(rec){if(rec.note)return rec.note;if(rec.fromTable&&rec.toTable&&rec.fromTable!==rec.toTable)return rec.fromTable+' → '+rec.toTable;if(rec.fromServer&&rec.toServer&&rec.fromServer!==rec.toServer)return rec.fromServer+' → '+rec.toServer;return rec.label||rec.type}
function allTables(){try{return Array.isArray(TABLE_IDS)?TABLE_IDS.slice():[]}catch(_){return []}}
async function readEvents(key){try{const raw=(await readJ(pathFor(key)+'.json'))||{},vals=Object.values(raw).filter(Boolean).map(normalizeEvent).sort((a,b)=>a.at-b.at),out=[],seen=new Map();for(const e of vals){let sig=e.eventId;if(['SEATED','BACKFILL_SEATED'].includes(e.type))sig='seat|'+(e.partyId||[e.table,e.server,e.at].join('|'))+'|'+e.table;else if(['CANCEL_RESET','BACKFILL_CANCEL'].includes(e.type))sig='cancel|'+(e.partyId||e.table)+'|'+Math.round(e.at/5000);if(seen.has(sig)){const idx=seen.get(sig),prev=out[idx];if(/^BACKFILL_/.test(prev.type)&&!/^BACKFILL_/.test(e.type))out[idx]=e;continue}seen.set(sig,out.length);out.push(e)}return out}catch(_){return []}}
function downloadCsv(events,key){const q=v=>'"'+txt(v).replace(/"/g,'""')+'"';const rows=[['Date','Shift','Event Time','Seated Start','Table','Server','Event','From Table','To Table','From Server','To Server','Guests','Party ID','Details','Source']].concat(events.map(e=>[e.date,e.shift,fmtTime(e.at),fmtTime(e.seatedAt),e.table,e.server,e.label,e.fromTable,e.toTable,e.fromServer,e.toServer,e.people,e.partyId,details(e),e.source]));const csv=rows.map(r=>r.map(q).join(',')).join('\r\n');const blob=new Blob([csv],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='FZ_Table_Shift_Report_'+key+'.csv';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000)}
let ui={date:'',shift:'',table:'ALL',server:'ALL',type:'ALL'},autoBackfilled=new Set();
function styles(){if(document.getElementById('fzTableAuditStyle'))return;const s=document.createElement('style');s.id='fzTableAuditStyle';s.textContent=`
.fzTA{padding:13px 14px 38px;color:#eaf4fb}.fzTAHead{display:flex;align-items:center;justify-content:space-between;gap:12px}.fzTAHead h2{margin:0;font-size:25px}.fzTAHead p{margin:4px 0 0;color:#9db6c9;font-size:11px;font-weight:800}.fzTAControls{display:grid;grid-template-columns:repeat(5,minmax(120px,1fr));gap:8px;margin:13px 0;padding:11px;border:1px solid #31556d;border-radius:12px;background:#091b29}.fzTAControls label{display:block;color:#8fb0c8;font-size:9px;font-weight:1000;margin-bottom:4px}.fzTAControls input,.fzTAControls select{width:100%;height:40px;border:1px solid #45667d;border-radius:8px;background:#102b40;color:#fff;padding:0 8px;font-weight:900}.fzTABtns{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}.fzTABtns button{min-height:42px;border:1px solid #3b6a84;border-radius:9px;background:#123149;color:#fff;padding:0 12px;font-weight:1000}.fzTABtns .primary{background:#167a4b;border-color:#5ee3a0}.fzTAStats{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px}.fzTAStat{padding:10px;border:1px solid #31546a;border-radius:12px;background:linear-gradient(180deg,#102d42,#0a1c2a)}.fzTAStat small{display:block;color:#8fb0c8;font-size:9px;font-weight:1000}.fzTAStat strong{display:block;font-size:23px;margin-top:4px}.fzTATimeline{display:grid;gap:8px}.fzTAEvent{display:grid;grid-template-columns:105px 95px minmax(130px,170px) minmax(150px,200px) 1fr;gap:10px;align-items:center;padding:11px 12px;border:1px solid #2d5066;border-radius:11px;background:#0a1e2d;box-shadow:0 10px 22px rgba(0,0,0,.22)}.fzTAEvent .time b{display:block;font-size:16px}.fzTAEvent .time span,.fzTAEvent small{color:#8faec1;font-size:9px;font-weight:900}.fzTAEvent .table{font-size:21px;font-weight:1000;color:#fff}.fzTAEvent .event{font-size:12px;font-weight:1000;color:#67e8f9}.fzTAEvent .server{font-size:13px;font-weight:1000}.fzTAEvent .detail{font-size:11px;color:#d7e7f1;font-weight:800;line-height:1.4}.fzTAEmpty{padding:24px;text-align:center;color:#93aec0;font-weight:900;border:1px dashed #375a70;border-radius:12px}.fzTABadge{display:inline-block;margin-top:4px;padding:2px 6px;border:1px solid #496a7f;border-radius:999px;font-size:8px;color:#a8c4d5}.fzTANote{padding:10px 12px;border:1px solid #7c5b20;border-radius:10px;background:#33230b;color:#fde68a;font-size:10px;font-weight:850;line-height:1.45;margin-bottom:11px}
@media(max-width:760px){.fzTAControls{grid-template-columns:1fr 1fr}.fzTAStats{grid-template-columns:1fr 1fr}.fzTAEvent{grid-template-columns:84px 72px 1fr}.fzTAEvent .server{grid-column:3}.fzTAEvent .detail{grid-column:1/-1}.fzTAHead{align-items:flex-start;flex-direction:column}}
`;document.head.appendChild(s)}
async function render(){const mount=document.getElementById('fzTAReport');if(!mount)return;const key=keyFor(ui.date,ui.shift);mount.innerHTML='<div class="fzTAEmpty">Loading table history…</div>';await flushPending();if(!autoBackfilled.has(key)){await backfillShift(key,{quiet:true});autoBackfilled.add(key)}const events=await readEvents(key);const servers=[...new Set(events.map(x=>x.server).filter(Boolean))].sort();const serverSel=document.getElementById('fzTAServer');if(serverSel){const keep=ui.server;serverSel.innerHTML='<option value="ALL">ALL SERVERS</option>'+servers.map(x=>'<option value="'+escHtml(x)+'">'+escHtml(x)+'</option>').join('');serverSel.value=servers.includes(keep)?keep:'ALL';ui.server=serverSel.value}
  const filtered=events.filter(e=>(ui.table==='ALL'||e.table===ui.table||e.fromTable===ui.table||e.toTable===ui.table)&&(ui.server==='ALL'||e.server===ui.server||e.fromServer===ui.server||e.toServer===ui.server)&&(ui.type==='ALL'||e.type===ui.type));
  const partyCount=new Set(filtered.map(x=>x.partyId).filter(Boolean)).size,swapCount=filtered.filter(x=>/SWAP/.test(x.type)).length,cancelCount=filtered.filter(x=>/CANCEL/.test(x.type)).length;
  document.getElementById('fzTAStats').innerHTML='<div class="fzTAStat"><small>EVENTS</small><strong>'+filtered.length+'</strong></div><div class="fzTAStat"><small>PARTIES</small><strong>'+partyCount+'</strong></div><div class="fzTAStat"><small>SWAPS</small><strong>'+swapCount+'</strong></div><div class="fzTAStat"><small>CANCEL / RESET</small><strong>'+cancelCount+'</strong></div>';
  mount._events=filtered;mount._key=key;
  if(!filtered.length){mount.innerHTML='<div class="fzTAEmpty">No recoverable events for '+escHtml(key)+'. Use BACKFILL SELECTED SHIFT for older surviving Board/Floor evidence.</div>';return}
  mount.innerHTML='<div class="fzTATimeline">'+filtered.map(e=>'<article class="fzTAEvent"><div class="time"><b>'+escHtml(fmtTime(e.at))+'</b><span>'+escHtml(fmtDate(e.at))+'</span></div><div class="table">'+escHtml(e.table||'—')+'</div><div><div class="event">'+escHtml(e.label||e.type)+'</div><span class="fzTABadge">'+escHtml(e.shift||'')+'</span></div><div class="server">'+escHtml(e.server||'—')+(e.people?'<small>'+escHtml(e.people)+' guests</small>':'')+'</div><div class="detail">'+escHtml(details(e))+(e.seatedAt?('<small>Seated start: '+escHtml(fmtTime(e.seatedAt))+'</small>'):'')+'<small>'+escHtml(e.source||'')+(e.partyId?(' • '+e.partyId):'')+'</small></div></article>').join('')+'</div>';
}
function openReport(){if(typeof quickIsManager==='function'&&!quickIsManager())return toastSafe('Table Shift Report • Manager / Owner only');styles();const mount=typeof quickPrepareLegacy==='function'?quickPrepareLegacy('Table Shift Report • Audit Trail'):null;if(!mount)return;let d='';try{d=selectedDate()}catch(_){d=new Date().toISOString().slice(0,10)}let sh='AM';try{sh=shift()}catch(_){ }ui={date:d,shift:sh,table:'ALL',server:'ALL',type:'ALL'};const types=['ALL',...Object.keys(EVENT_LABELS)];mount.innerHTML='<div class="fzTA"><div class="fzTAHead"><div><h2>Table Shift Report</h2><p>Who served each table, original seated start, event time, cancel/reset time, swaps and table journey. Persistent history survives Clear Shift.</p></div></div><div class="fzTANote">R3M.8.44 records exact new events going forward. BACKFILL can recover older seating and some cancel/reset evidence only when the old Board/Floor audit still exists; missing historical swaps are never invented.</div><div class="fzTAControls"><div><label>DATE</label><input id="fzTADate" type="date" value="'+escHtml(d)+'"></div><div><label>SHIFT</label><select id="fzTAShift"><option'+(sh==='AM'?' selected':'')+'>AM</option><option'+(sh==='PM'?' selected':'')+'>PM</option></select></div><div><label>TABLE</label><select id="fzTATable"><option value="ALL">ALL TABLES</option>'+allTables().map(x=>'<option>'+escHtml(x)+'</option>').join('')+'</select></div><div><label>SERVER</label><select id="fzTAServer"><option value="ALL">ALL SERVERS</option></select></div><div><label>EVENT</label><select id="fzTAType">'+types.map(x=>'<option value="'+escHtml(x)+'">'+escHtml(x==='ALL'?'ALL EVENTS':(EVENT_LABELS[x]||x))+'</option>').join('')+'</select></div></div><div class="fzTABtns"><button id="fzTARefresh" class="primary">REFRESH</button><button id="fzTABackfill">BACKFILL SELECTED SHIFT</button><button id="fzTACsv">DOWNLOAD CSV</button></div><div id="fzTAStats" class="fzTAStats"></div><div id="fzTAReport"></div></div>';
  document.getElementById('fzTADate').onchange=e=>{ui.date=e.target.value;render()};document.getElementById('fzTAShift').onchange=e=>{ui.shift=e.target.value;render()};document.getElementById('fzTATable').onchange=e=>{ui.table=e.target.value;render()};document.getElementById('fzTAServer').onchange=e=>{ui.server=e.target.value;render()};document.getElementById('fzTAType').onchange=e=>{ui.type=e.target.value;render()};document.getElementById('fzTARefresh').onclick=render;document.getElementById('fzTABackfill').onclick=async()=>{const b=document.getElementById('fzTABackfill');b.disabled=true;b.textContent='BACKFILLING…';try{await backfillShift(keyFor(ui.date,ui.shift));await render()}finally{b.disabled=false;b.textContent='BACKFILL SELECTED SHIFT'}};document.getElementById('fzTACsv').onclick=()=>{const r=document.getElementById('fzTAReport');if(r&&r._events)downloadCsv(r._events,r._key||keyFor(ui.date,ui.shift));else toastSafe('Refresh report first')};if(typeof quickSetOpen==='function')quickSetOpen('quickLegacyPanel',true);render();
}
global.FZQBOpenTableAudit=openReport;
function injectMenu(){const grid=document.getElementById('quickReservations')&&document.getElementById('quickReservations').parentElement;if(!grid||document.getElementById('quickTableAudit'))return;const b=document.createElement('button');b.id='quickTableAudit';b.className='quickMenuBtn quickManagerOnly';b.type='button';b.innerHTML='<strong>Table Shift Report</strong><span>Manager • seated time, server, cancel/reset, swap and table history</span>';b.onclick=openReport;grid.appendChild(b);try{if(typeof quickApplyAccessVisibility==='function')quickApplyAccessVisibility()}catch(_){}}
function install(){styles();injectMenu();wrapOperations();flushPending().catch(()=>{});setInterval(()=>flushPending().catch(()=>{}),30000)}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})(typeof window!=='undefined'?window:globalThis);
