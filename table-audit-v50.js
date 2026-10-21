/* FZ Quick Board R3M.8.50 — Fast Background Audit Queue + Simple Table Shift Report */
(function(global){
'use strict';
const BUILD='R3M.8.50';
const AUDIT_CHILD='tableAuditV44';
const RETENTION_CHILD='tableAuditRetentionV45';
const RETENTION_MONTHS=13;
const WARNING_DAYS=30;
const DAY_MS=86400000;
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
function retentionRoot(){try{return ROOT+'/'+RETENTION_CHILD}catch(_){return 'https://table-live-by-iwanto-zhang-default-rtdb.firebaseio.com/juicyTableLive/JUICY-HUNTSVILLE/flexibleFloorV1/'+RETENTION_CHILD}}
function pathFor(key){return auditRoot()+'/'+key}
function retentionPath(key){return retentionRoot()+'/'+key}
function parseDateParts(date){const m=txt(date).match(/^(\d{4})-(\d{2})-(\d{2})$/);return m?{y:Number(m[1]),m:Number(m[2]),d:Number(m[3])}:null}
function addCalendarMonthsMs(date,months){const p=parseDateParts(date);if(!p)return 0;let total=p.y*12+(p.m-1)+months,y=Math.floor(total/12),m=total%12;if(m<0){m+=12;y--}const last=new Date(Date.UTC(y,m+1,0)).getUTCDate(),day=Math.min(p.d,last);return Date.UTC(y,m,day,12,0,0)}
function expiryForKey(key){const date=dateFromKey(key);return date?addCalendarMonthsMs(date,RETENTION_MONTHS):0}
function retentionStatus(key,meta={},at=Date.now()){const expiresAt=expiryForKey(key),retained=!!(meta&&meta.retain),daysLeft=expiresAt?Math.ceil((expiresAt-at)/DAY_MS):null;return {key,expiresAt,retained,daysLeft,warning:!retained&&daysLeft!==null&&daysLeft>=0&&daysLeft<=WARNING_DAYS,expired:!retained&&daysLeft!==null&&daysLeft<0}}
async function readRetention(key){try{return (await readJ(retentionPath(key)+'.json'))||{}}catch(_){return {}}}
async function setRetention(key,retain){const value={retain:!!retain,updatedAt:Date.now(),updatedBy:currentRole(),deviceId:device(),expiresAt:expiryForKey(key)};await writeJ(retentionPath(key)+'.json',value,'PUT');const check=await readJ(retentionPath(key)+'.json');if(!check||!!check.retain!==!!retain)throw new Error('Retention setting could not be verified.');return check}
async function retentionSweep({quiet=true}={}){let auditKeys=[],metaAll={};try{const [shallow,meta]=await Promise.all([readJ(auditRoot()+'.json?shallow=true'),readJ(retentionRoot()+'.json')]);auditKeys=Object.keys(shallow||{}).filter(k=>/^\d{4}-\d{2}-\d{2}_(AM|PM)$/.test(k));metaAll=meta||{}}catch(e){if(!quiet)toastSafe('Retention check could not load');return {deleted:0,warnings:[],errors:1}}let deleted=0,errors=0;const warnings=[];for(const key of auditKeys){const state=retentionStatus(key,metaAll[key]||{});if(state.retained)continue;if(state.warning)warnings.push(state);if(state.expired){try{await writeJ(pathFor(key)+'.json',null,'PUT');const check=await readJ(pathFor(key)+'.json');if(check!==null)throw 0;deleted++;await writeJ(retentionPath(key)+'.json',{retain:false,deletedAt:Date.now(),expiresAt:state.expiresAt,deletedBy:currentRole(),deviceId:device()},'PUT')}catch(_){errors++}}}if(!quiet&&deleted)toastSafe('TABLE AUDIT RETENTION • '+deleted+' expired shift(s) deleted');return {deleted,warnings,errors}}
function parseSeatTime(entryId){const m=txt(entryId).match(/^seat_(\d{11,})_/i);const n=m?Number(m[1]):0;return Number.isFinite(n)&&n>0?n:0}
function now(){return Date.now()}
function idSafe(v){return txt(v).replace(/[^A-Za-z0-9_-]/g,'_').slice(0,140)}
function eventId(rec){const base=[rec.type||'EVENT',rec.partyId||'NA',rec.table||rec.toTable||rec.fromTable||'',rec.at||now(),rec.fromTable||'',rec.toTable||'',rec.fromServer||'',rec.toServer||''].join('_');return idSafe(base)}
function tableStatus(state){try{return typeof operationalTableStatus==='function'?operationalTableStatus(state||{}):txt(state&&state.status).toLowerCase()}catch(_){return txt(state&&state.status).toLowerCase()}}
function clone(v){try{return JSON.parse(JSON.stringify(v==null?null:v))}catch(_){return v}}
function tableList(v){const a=Array.isArray(v)?v:(txt(v)?txt(v).split(','):[]);return [...new Set(a.map(x=>txt(x).trim()).filter(Boolean))]}
function primaryFrom(rec){return txt(rec&&rec.primaryTable||rec&&rec.table||rec&&rec.toTable||rec&&rec.fromTable)}
function toastSafe(msg){try{if(typeof toast==='function')toast(msg)}catch(_){}}
function boardKeyFromState(state){const ref=state&&(state.boardRef||state.primaryBoardRef);return txt(ref&&ref.boardKey)||currentKey()}
function normalizeEvent(rec){
  rec=rec||{};const key=txt(rec.boardKey||currentKey());const at=num(rec.at,now()),partyId=txt(rec.partyId),seatedAt=num(rec.seatedAt,parseSeatTime(partyId));
  const primaryTable=txt(rec.primaryTable||rec.table||rec.toTable||rec.fromTable),secondaryTables=tableList(rec.secondaryTables),fromSecondaryTables=tableList(rec.fromSecondaryTables),toSecondaryTables=tableList(rec.toSecondaryTables),secondaryBefore=tableList(rec.secondaryBefore),secondaryAfter=tableList(rec.secondaryAfter);
  return {build:BUILD,eventId:txt(rec.eventId||eventId({...rec,at})),boardKey:key,date:txt(rec.date||dateFromKey(key)),shift:txt(rec.shift||shiftFromKey(key)),type:txt(rec.type||'EVENT'),label:txt(rec.label||EVENT_LABELS[rec.type]||rec.type||'EVENT'),table:txt(rec.table||primaryTable),primaryTable,secondaryTables,fromSecondaryTables,toSecondaryTables,secondaryBefore,secondaryAfter,fromTable:txt(rec.fromTable),toTable:txt(rec.toTable),server:canon(rec.server||rec.toServer||rec.fromServer),fromServer:canon(rec.fromServer),toServer:canon(rec.toServer),people:txt(rec.people),partyId,seatedAt,at,by:txt(rec.by||currentRole()),deviceId:txt(rec.deviceId||device()),note:txt(rec.note),source:txt(rec.source||'LIVE AUDIT')};
}
function pendingKey(){return 'fzqb_table_audit_pending_v44'}
/* R3M.8.50: never discard an audit event to make room for a newer one. Keep an
   in-memory copy until Firebase verifies it, even when local storage is full.
   Storage failures are visible and block Clear Shift until recovery. */
let pendingMemory=null,pendingStorageHealthy=true,pendingStorageUnread=false,pendingStorageWarned=false;
const verifiedPendingIds=new Set();
function pendingStorageFailed(){
  pendingStorageHealthy=false;
  if(!pendingStorageWarned){pendingStorageWarned=true;toastSafe('TABLE REPORT NOT SAVED LOCALLY • Keep this app open. Clear Shift is blocked until retry succeeds.');}
}
function mergePendingRecords(a,b=[]){
  const map=new Map();
  [...(a||[]),...(b||[])].forEach(rec=>{const id=txt(rec&&rec.eventId);if(id&&!verifiedPendingIds.has(id))map.set(id,rec)});
  return [...map.values()];
}
function readPendingStorage(){
  const parsed=JSON.parse(localStorage.getItem(pendingKey())||'[]');
  if(!Array.isArray(parsed)||parsed.some(rec=>!rec||!txt(rec.eventId)))throw new Error('Invalid pending table report storage');
  return parsed;
}
function loadPending(){
  if(pendingMemory===null){
    try{pendingMemory=mergePendingRecords(readPendingStorage())}
    catch(_){pendingMemory=[];pendingStorageUnread=true;pendingStorageFailed()}
  }
  return pendingMemory.slice();
}
function savePending(a){
  pendingMemory=mergePendingRecords(a);
  try{
    /* A failed initial read may hide existing records. Read and merge them before
       replacing storage, rather than treating an unreadable queue as empty. */
    if(pendingStorageUnread){pendingMemory=mergePendingRecords(readPendingStorage(),pendingMemory);pendingStorageUnread=false}
    const serialized=JSON.stringify(pendingMemory);
    localStorage.setItem(pendingKey(),serialized);
    if(localStorage.getItem(pendingKey())!==serialized)throw new Error('Pending table report storage did not verify');
    pendingStorageHealthy=true;pendingStorageWarned=false;verifiedPendingIds.clear();return true;
  }catch(_){pendingStorageFailed();return false}
}
function queuePending(rec){rec=normalizeEvent(rec);const list=loadPending(),id=txt(rec.eventId);if(!list.some(x=>txt(x&&x.eventId)===id))list.push(rec);const durable=savePending(list);return {rec,durable}}
function removePending(eventId){const id=txt(eventId);verifiedPendingIds.add(id);return savePending(loadPending().filter(x=>txt(x&&x.eventId)!==id))}
let pendingFlushPromise=null,pendingFlushScheduled=false;
async function putVerified(rec,quiet=false){
  rec=normalizeEvent(rec);if(!rec.boardKey||!rec.eventId)return false;const p=pathFor(rec.boardKey)+'/'+rec.eventId+'.json';
  for(let attempt=0;attempt<3;attempt++){
    try{await writeJ(p,rec,'PUT');const check=await readJ(p);if(check&&txt(check.eventId)===rec.eventId&&txt(check.type)===rec.type){removePending(rec.eventId);return true}}catch(_){ }
    await new Promise(r=>setTimeout(r,100+attempt*180));
  }
  queuePending(rec);if(!quiet)toastSafe('Table report audit queued • will retry');return false;
}
async function flushPending(background=false){
  if(pendingFlushPromise)return pendingFlushPromise;
  pendingFlushPromise=(async()=>{
    const list=loadPending();savePending(list);let saved=0;
    for(const rec of list){
      try{if(background&&typeof quickMutationBusy==='function'&&quickMutationBusy())break}catch(_){}
      /* putVerified removes only its own confirmed event. A new event queued
         while this snapshot is uploading therefore cannot be overwritten. */
      if(await putVerified(rec,true))saved++;else break;
    }
    return saved
  })();
  try{return await pendingFlushPromise}finally{pendingFlushPromise=null}
}
function schedulePendingFlush(){
  if(pendingFlushScheduled)return;pendingFlushScheduled=true;
  setTimeout(()=>{
    pendingFlushScheduled=false;
    try{if(typeof quickMutationBusy==='function'&&quickMutationBusy()){schedulePendingFlush();return}}catch(_){}
    flushPending(true).catch(()=>{})
  },600);
}
function enqueueAudit(rec){
  const queued=queuePending(rec),normalized=queued.rec;
  if(normalized&&normalized.boardKey&&normalized.eventId)schedulePendingFlush();
  return queued.durable;
}
function partyFind(partyId){if(!partyId)return null;try{for(const [id,s] of Object.entries(tableState||{})){if(s&&txt(s.partyId)===txt(partyId)&&!s.secondaryOf)return {id,state:s}}}catch(_){ }return null}
async function recordSeatFromState(table,state,source='LIVE SEAT'){
  if(!state||tableStatus(state)!=='seated'||state.secondaryOf)return false;const key=boardKeyFromState(state),pid=txt(state.partyId),at=parseSeatTime(pid)||num(state.updatedAt,now()),people=state.people||state.partyPeople,secondaryTables=tableList(state.secondaryTables);
  const rec=normalizeEvent({type:'SEATED',boardKey:key,table,primaryTable:table,secondaryTables,server:state.server,people,partyId:pid,at,note:'Seated',source});rec.eventId=idSafe('seat_'+(pid||[table,canon(state.server),at].join('_'))+'_'+table);return enqueueAudit(rec);
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
        const live=partyFind(pid),liveSecondaries=live&&txt(live.id)===txt(t.table)?tableList(live.state.secondaryTables):[];const rec=normalizeEvent({type:'BACKFILL_SEATED',boardKey:key,table:t.table,primaryTable:t.table,secondaryTables:liveSecondaries,server,people:t.people,partyId:pid,at,note:'Recovered seating'+(section?(' • Section '+section):''),source:'BACKFILL HOST BOARD'});rec.eventId=idSafe('seat_'+(pid||[t.table,server,at].join('_'))+'_'+txt(t.table));
        if(await putVerified(rec,true))saved++;
      }
    }
  }catch(_){errors++}
  try{
    const hist=(await readJ(FLOOR_HISTORY_ROOT+'/'+key+'.json'))||{};const seen=new Set();
    const vals=Object.values(hist).filter(x=>x&&x.action==='delete').sort((a,b)=>num(a.at)-num(b.at));
    for(const h of vals){const st=h.state||{},pid=txt(st.partyId),sig=[pid,h.tableId,Math.floor(num(h.at)/1000)].join('|');if(seen.has(sig))continue;seen.add(sig);found++;
      const primary=txt(st.secondaryOf||h.tableId),secs=st.secondaryOf?[txt(h.tableId)]:tableList(st.secondaryTables);const rec=normalizeEvent({type:'BACKFILL_CANCEL',boardKey:key,table:primary,primaryTable:primary,secondaryTables:secs,server:h.server||st.server,people:st.people||st.partyPeople,partyId:pid,at:num(h.at,now()),note:'Cancel / reset',source:'BACKFILL FLOOR HISTORY'});rec.eventId=idSafe('cancel_'+(pid||primary)+'_'+rec.at);if(await putVerified(rec,true))saved++;
    }
  }catch(_){errors++}
  if(!quiet)toastSafe('TABLE REPORT BACKFILL • '+found+' found • '+saved+' saved'+(errors?' • '+errors+' read error(s)':''));return {found,saved,errors};
}
async function preClear(target){try{await flushPending();if(loadPending().length||!pendingStorageHealthy)return false;const key=txt(target||currentKey()),result=await backfillShift(key,{quiet:true});if(result.errors||result.saved<result.found)return false;await flushPending();return loadPending().length===0&&pendingStorageHealthy}catch(_){return false}}
global.FZQBTableAuditPreClear=preClear;
global.FZQBTableAuditRecord=enqueueAudit;
global.FZQBTableAuditRecordVerified=putVerified;
global.FZQBTableAuditBackfill=backfillShift;
global.FZQBTableAuditRetentionSweep=retentionSweep;
global.FZQBTableAuditSetRetention=setRetention;

function wrapOperations(){
  if(global.__fzTableAuditWrapped)return;global.__fzTableAuditWrapped=true;
  if(typeof global.applyFloorSeat==='function'){
    const orig=global.applyFloorSeat;global.applyFloorSeat=async function(){const table=txt(selectedTable),before=clone((tableState||{})[table]||{});const result=await orig.apply(this,arguments);const after=clone((tableState||{})[table]||{});if(table&&tableStatus(after)==='seated'&&txt(after.partyId)&&txt(after.partyId)!==txt(before.partyId))recordSeatFromState(table,after);return result};
  }
  if(typeof global.resetWrongFloorEntry==='function'){
    const orig=global.resetWrongFloorEntry;global.resetWrongFloorEntry=async function(sourceOverride='',peopleOverride=null){const source=txt((typeof sourceOverride==='string'&&sourceOverride)||((document.getElementById('moveSourceTable')||{}).value)||selectedTable),before=clone((tableState||{})[source]||{}),key=boardKeyFromState(before),pid=txt(before.partyId),oldPeople=txt(before.people||before.partyPeople),linked=tableList(before.secondaryTables);const result=await orig.apply(this,arguments);const after=clone((tableState||{})[source]||{});if(peopleOverride!==null&&tableStatus(after)==='seated'&&txt(after.partyId)===pid&&txt(after.people)!==oldPeople){enqueueAudit({type:'EDIT_PEOPLE',boardKey:key,table:source,primaryTable:source,secondaryTables:tableList(after.secondaryTables),server:before.server,people:after.people,partyId:pid,at:num(after.updatedAt,now()),note:'Guests: '+oldPeople+' → '+txt(after.people),source:'EDIT PEOPLE'})}else if(pid&&tableStatus(before)==='seated'&&tableStatus(after)!=='seated'){const at=num(after.updatedAt,now());enqueueAudit({type:'CANCEL_RESET',boardKey:key,table:source,primaryTable:source,secondaryTables:linked,server:before.server,people:oldPeople,partyId:pid,at,note:'Cancel / reset',source:'RESET / DELETE'})}return result};
  }
  if(typeof global.saveMoveChange==='function'){
    const orig=global.saveMoveChange;global.saveMoveChange=async function(){const source=txt((document.getElementById('moveSourceTable')||{}).value),before=clone((tableState||{})[source]||{}),pid=txt(before.partyId),key=boardKeyFromState(before),fromServer=canon(before.server),fromTable=source,fromSecondaries=tableList(before.secondaryTables),mode=txt(swapMode);const result=await orig.apply(this,arguments);const hit=partyFind(pid);if(pid&&hit){const toTable=hit.id,toServer=canon(hit.state.server),toSecondaries=tableList(hit.state.secondaryTables);let type='TABLE_SERVER_SWAP';if(fromTable!==toTable&&fromServer===toServer)type='TABLE_SWAP';else if(fromTable===toTable&&fromServer!==toServer)type='SERVER_SWAP';else if(fromTable===toTable&&fromServer===toServer)return result;const note=type==='TABLE_SWAP'?('Table swap: '+fromTable+' → '+toTable):type==='SERVER_SWAP'?('Server swap: '+fromServer+' → '+toServer):('Table + server swap: '+fromTable+' / '+fromServer+' → '+toTable+' / '+toServer);enqueueAudit({type,boardKey:key,table:toTable,primaryTable:toTable,secondaryTables:toSecondaries,fromSecondaryTables:fromSecondaries,toSecondaryTables:toSecondaries,fromTable,toTable,server:toServer,fromServer,toServer,people:hit.state.people||before.people,partyId:pid,at:num(hit.state.updatedAt,now()),note,source:'MOVE / CHANGE '+mode.toUpperCase()})}return result};
  }
  if(typeof global.setStatus==='function'){
    const orig=global.setStatus;global.setStatus=async function(status){const selected=txt(selectedTable),before=clone((tableState||{})[selected]||{}),main=txt(before.secondaryOf||selected),mainBefore=clone((tableState||{})[main]||before),key=boardKeyFromState(mainBefore),pid=txt(mainBefore.partyId),beforeStatus=tableStatus(before);const result=await orig.apply(this,arguments);const after=clone((tableState||{})[selected]||{}),afterStatus=tableStatus(after);if(selected&&beforeStatus!==afterStatus){const type=afterStatus==='ready'?'READY':afterStatus==='cleaning'?'CLEANING':'';if(type)enqueueAudit({type,boardKey:key,table:main,primaryTable:main,secondaryTables:tableList(mainBefore.secondaryTables),server:mainBefore.server||after.server,people:mainBefore.people||mainBefore.partyPeople,partyId:pid,at:num(after.updatedAt,now()),note:type==='READY'?'Ready / released':'Cleaning',source:'FLOOR STATUS'})}return result};
  }
  if(typeof global.restoreFloorHistory==='function'){
    const orig=global.restoreFloorHistory;global.restoreFloorHistory=async function(){const rec=clone(quickUndoPending||{}),table=txt(rec.tableId);const result=await orig.apply(this,arguments);const after=clone((tableState||{})[table]||{});if(table&&tableStatus(after)==='seated'){enqueueAudit({type:'RESTORE',boardKey:boardKeyFromState(after),table,primaryTable:table,secondaryTables:tableList(after.secondaryTables),server:after.server,people:after.people||after.partyPeople,partyId:after.partyId,at:num(after.updatedAt,now()),note:'Restored',source:'UNDO DELETE'})}return result};
  }
  if(typeof global.saveEditedSecondaries==='function'){
    const orig=global.saveEditedSecondaries;global.saveEditedSecondaries=async function(){const primary=txt(editSecondaryPrimary),before=clone((tableState||{})[primary]||{}),oldSet=tableList(before.secondaryTables);const result=await orig.apply(this,arguments);const after=clone((tableState||{})[primary]||{}),newSet=tableList(after.secondaryTables);if(primary&&JSON.stringify(oldSet)!==JSON.stringify(newSet))enqueueAudit({type:'SECONDARY_CHANGE',boardKey:boardKeyFromState(after||before),table:primary,primaryTable:primary,secondaryTables:newSet,secondaryBefore:oldSet,secondaryAfter:newSet,server:(after||before).server,people:(after||before).people,partyId:(after||before).partyId,at:num((after||before).updatedAt,now()),note:'Secondary tables: '+(oldSet.join(', ')||'none')+' → '+(newSet.join(', ')||'none'),source:'EDIT SECONDARY'});return result};
  }
  if(typeof global.clearHistoryParty26==='function'){
    const orig=global.clearHistoryParty26;global.clearHistoryParty26=async function(ri,ti){let ev=null;try{ev=clone(board&&board.rows&&board.rows[ri]&&board.rows[ri].turns&&board.rows[ri].turns[ti]);ev={...ev,server:board.rows[ri].server,key:currentKey()}}catch(_){ }const result=await orig.apply(this,arguments);if(ev&&ev.table)enqueueAudit({type:'BOARD_HISTORY_DELETE',boardKey:ev.key,table:ev.table,primaryTable:ev.table,server:ev.server,people:ev.people,partyId:ev.entryId,at:now(),note:'Historical Board party deleted • later rotation entries compacted',source:'BOARD HISTORY DELETE'});return result};
  }
  if(typeof global.quickWizardSetReserved==='function'){
    const orig=global.quickWizardSetReserved;global.quickWizardSetReserved=async function(){const table=txt(selectedTable),before=clone((tableState||{})[table]||{});const result=await orig.apply(this,arguments);const after=clone((tableState||{})[table]||{});if(table&&tableStatus(after)==='reserved'&&tableStatus(before)!=='reserved')enqueueAudit({type:'RESERVED',boardKey:currentKey(),table,primaryTable:table,secondaryTables:tableList(after.secondaryTables||before.secondaryTables),server:after.server||before.server,people:after.people||before.people,partyId:after.partyId||before.partyId,at:num(after.updatedAt,now()),note:'Table marked RESERVED',source:'RESERVATION'});return result};
  }
  /* A few legacy controls captured their original function object with element.onclick=fn
     before this module loaded. Rebind those controls to the wrapped audit-aware functions. */
  try{const x=document.getElementById('moveSave');if(x&&typeof global.saveMoveChange==='function')x.onclick=global.saveMoveChange}catch(_){}
  try{const x=document.getElementById('quickUndoRestore');if(x&&typeof global.restoreFloorHistory==='function')x.onclick=global.restoreFloorHistory}catch(_){}
  try{const x=document.getElementById('editSecondarySave');if(x&&typeof global.saveEditedSecondaries==='function')x.onclick=global.saveEditedSecondaries}catch(_){}
  try{const x=document.getElementById('quickWizardReservation');if(x&&typeof global.quickWizardSetReserved==='function')x.onclick=global.quickWizardSetReserved}catch(_){}
}

function fmtTime(at){if(!at)return '—';try{return new Date(Number(at)).toLocaleTimeString([], {hour:'numeric',minute:'2-digit',second:'2-digit'})}catch(_){return '—'}}
function fmtDate(at){if(!at)return '—';try{return new Date(Number(at)).toLocaleDateString('en-US',{month:'2-digit',day:'2-digit',year:'numeric'})}catch(_){return '—'}}
function mainTable(rec){return txt(rec&&rec.primaryTable||rec&&rec.table||rec&&rec.toTable||rec&&rec.fromTable)||'—'}
function secondaryText(rec){const a=tableList(rec&&rec.secondaryTables);return a.length?a.join(', '):'—'}
function simpleDetails(rec){
  const type=txt(rec&&rec.type),ft=txt(rec&&rec.fromTable),tt=txt(rec&&rec.toTable),fs=canon(rec&&rec.fromServer),ts=canon(rec&&rec.toServer);
  if(type==='TABLE_SWAP')return 'Table swap: '+(ft||'—')+' → '+(tt||'—');
  if(type==='SERVER_SWAP')return 'Server swap: '+(fs||'—')+' → '+(ts||'—');
  if(type==='TABLE_SERVER_SWAP')return 'Table + server swap: '+(ft||'—')+' / '+(fs||'—')+' → '+(tt||'—')+' / '+(ts||'—');
  if(type==='SECONDARY_CHANGE'){const a=tableList(rec.secondaryBefore),b=tableList(rec.secondaryAfter);return 'Secondary tables: '+(a.join(', ')||'none')+' → '+(b.join(', ')||secondaryText(rec));}
  if(['SEATED','BACKFILL_SEATED'].includes(type))return 'Seated';
  if(['CANCEL_RESET','BACKFILL_CANCEL'].includes(type))return 'Cancel / reset';
  if(type==='READY')return 'Ready / released';if(type==='CLEANING')return 'Cleaning';if(type==='RESTORE')return 'Restored';if(type==='RESERVED')return 'Reserved';
  if(type==='EDIT_PEOPLE')return rec.note||'Guest count edited';if(type==='BOARD_HISTORY_DELETE')return 'Board history deleted';return rec.note||rec.label||type;
}
function allTables(){try{return Array.isArray(TABLE_IDS)?TABLE_IDS.slice():[]}catch(_){return []}}
function collapseEvents(vals){const primaryParties=new Set(vals.filter(e=>!txt(e.source).includes('SECONDARY')&&e.partyId).map(e=>e.partyId+'|'+(e.type==='BACKFILL_SEATED'?'SEATED':e.type==='BACKFILL_CANCEL'?'CANCEL_RESET':e.type)));return vals.filter(e=>{if(!txt(e.source).includes('SECONDARY'))return true;const t=e.type==='BACKFILL_SEATED'?'SEATED':e.type==='BACKFILL_CANCEL'?'CANCEL_RESET':e.type;return !primaryParties.has(e.partyId+'|'+t)})}
async function readEvents(key){try{const raw=(await readJ(pathFor(key)+'.json'))||{},vals=Object.values(raw).filter(Boolean).map(normalizeEvent).sort((a,b)=>a.at-b.at),out=[],seen=new Map();for(const e of vals){let sig=e.eventId;if(['SEATED','BACKFILL_SEATED'].includes(e.type))sig='seat|'+(e.partyId||[e.table,e.server,e.at].join('|'))+'|'+mainTable(e);else if(['CANCEL_RESET','BACKFILL_CANCEL'].includes(e.type))sig='cancel|'+(e.partyId||mainTable(e))+'|'+Math.round(e.at/5000);if(seen.has(sig)){const idx=seen.get(sig),prev=out[idx];if(/^BACKFILL_/.test(prev.type)&&!/^BACKFILL_/.test(e.type))out[idx]=e;continue}seen.set(sig,out.length);out.push(e)}return collapseEvents(out)}catch(_){return []}}
function downloadCsv(events,key){const q=v=>'"'+txt(v).replace(/"/g,'""')+'"';const rows=[['Time','Date','Shift','Server','Guests','Main Table','Secondary Table(s)','Event','Description','Seated Start','From Table','To Table','From Server','To Server','Party ID','Source']].concat(events.map(e=>[fmtTime(e.at),e.date||fmtDate(e.at),e.shift,e.server,e.people,mainTable(e),secondaryText(e),e.label,simpleDetails(e),fmtTime(e.seatedAt),e.fromTable,e.toTable,e.fromServer,e.toServer,e.partyId,e.source]));const csv=rows.map(r=>r.map(q).join(',')).join('\r\n');const blob=new Blob([csv],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='FZ_Table_Shift_Report_'+key+'.csv';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000)}
let ui={date:'',shift:'',table:'ALL',server:'ALL',type:'ALL'},autoBackfilled=new Set();
function styles(){if(document.getElementById('fzTableAuditStyle'))return;const s=document.createElement('style');s.id='fzTableAuditStyle';s.textContent=`
.fzTA{padding:13px 14px 38px;color:#eaf4fb}.fzTAHead h2{margin:0;font-size:25px}.fzTAHead p{margin:4px 0 0;color:#9db6c9;font-size:12px;font-weight:800}.fzTAControls{display:grid;grid-template-columns:repeat(5,minmax(120px,1fr));gap:8px;margin:13px 0;padding:11px;border:1px solid #31556d;border-radius:12px;background:#091b29}.fzTAControls label{display:block;color:#8fb0c8;font-size:10px;font-weight:1000;margin-bottom:4px}.fzTAControls input,.fzTAControls select{width:100%;height:40px;border:1px solid #45667d;border-radius:8px;background:#102b40;color:#fff;padding:0 8px;font-weight:900}.fzTABtns{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}.fzTABtns button{min-height:42px;border:1px solid #3b6a84;border-radius:9px;background:#123149;color:#fff;padding:0 12px;font-weight:1000}.fzTABtns .primary{background:#167a4b;border-color:#5ee3a0}.fzTAStats{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px}.fzTAStat{padding:10px;border:1px solid #31546a;border-radius:12px;background:linear-gradient(180deg,#102d42,#0a1c2a)}.fzTAStat small{display:block;color:#8fb0c8;font-size:9px;font-weight:1000}.fzTAStat strong{display:block;font-size:23px;margin-top:4px}.fzTAReportHead,.fzTAEvent{display:grid;grid-template-columns:135px 64px minmax(145px,1fr) 90px 100px minmax(120px,1fr) 150px minmax(230px,1.5fr);gap:10px;align-items:center}.fzTAReportHead{padding:0 12px 7px;color:#89abc1;font-size:9px;font-weight:1000}.fzTATimeline{display:grid;gap:7px}.fzTAEvent{padding:12px;border:1px solid #2d5066;border-radius:11px;background:#0a1e2d;box-shadow:0 8px 18px rgba(0,0,0,.2)}.fzTAEvent .time b{display:block;font-size:15px}.fzTAEvent .time span{display:block;color:#9bb8ca;font-size:10px;font-weight:900;margin-top:2px}.fzTAEvent .shift{font-size:11px;font-weight:1000;color:#9edcff}.fzTAEvent .server{font-size:13px;font-weight:1000}.fzTAEvent .guests{font-size:12px;font-weight:1000;color:#f7d66b;white-space:nowrap}.fzTAEvent .main,.fzTAEvent .secondary{font-size:14px;font-weight:1000;color:#fff}.fzTAEvent .event{font-size:11px;font-weight:1000;color:#67e8f9}.fzTAEvent .detail{font-size:12px;color:#e5f3fb;font-weight:850;line-height:1.35}.fzTAEvent .detail small{display:block;color:#94b2c4;font-size:9px;margin-top:4px}.fzTAEmpty{padding:24px;text-align:center;color:#93aec0;font-weight:900;border:1px dashed #375a70;border-radius:12px}.fzTANote{padding:10px 12px;border:1px solid #7c5b20;border-radius:10px;background:#33230b;color:#fde68a;font-size:10px;font-weight:850;line-height:1.45;margin-bottom:11px}.fzTARetention{display:grid;grid-template-columns:1fr auto;gap:10px;align-items:center;padding:11px 12px;margin:0 0 10px;border:1px solid #31556d;border-radius:11px;background:#0d293b}.fzTARetention strong{display:block;font-size:12px}.fzTARetention span{display:block;color:#a9c4d6;font-size:10px;font-weight:800;margin-top:3px}.fzTARetention button{height:38px;border:1px solid #55d99a;border-radius:8px;background:#145437;color:#d9ffed;font-weight:1000;padding:0 12px}.fzTARetention.warning{border-color:#d9a441;background:#3b2b09}.fzTARetention.danger{border-color:#f87171;background:#4a1515}.fzTARetention.kept{border-color:#4ade80;background:#123a26}.fzTARetentionWarnings{display:none;padding:10px 12px;margin-bottom:10px;border:1px solid #d9a441;border-radius:10px;background:#3b2b09;color:#fde68a;font-size:10px;font-weight:900;line-height:1.4}
@media(max-width:900px){.fzTAControls{grid-template-columns:1fr 1fr}.fzTAStats{grid-template-columns:1fr 1fr}.fzTAReportHead{display:none}.fzTAEvent{grid-template-columns:95px 50px minmax(120px,1fr) 78px}.fzTAEvent .guests{grid-column:4}.fzTAEvent .main{grid-column:1/2}.fzTAEvent .secondary{grid-column:2/4}.fzTAEvent .event{grid-column:4}.fzTAEvent .detail{grid-column:1/-1}.fzTAHead{align-items:flex-start;flex-direction:column}}
`;document.head.appendChild(s)}
async function refreshRetentionPanel(key){const box=document.getElementById('fzTARetention');if(!box)return;const meta=await readRetention(key),state=retentionStatus(key,meta),exp=state.expiresAt?new Date(state.expiresAt).toLocaleDateString():'—';let msg='',cls='';if(state.retained){cls=' kept';msg='<strong>RETAINED • NO AUTO DELETE</strong><span>This shift is protected until you remove KEEP DATA.</span>'}else if(state.expired){cls=' danger';msg='<strong>EXPIRED • PENDING AUTO DELETE</strong><span>13-month retention limit passed. If this data still exists, keep it now before the next cleanup.</span>'}else if(state.warning){cls=' warning';msg='<strong>AUTO DELETE IN '+Math.max(0,state.daysLeft)+' DAY(S)</strong><span>Scheduled deletion: '+escHtml(exp)+'. Press KEEP DATA to preserve this shift.</span>'}else{msg='<strong>13-MONTH RETENTION</strong><span>Scheduled auto delete: '+escHtml(exp)+'. A warning appears during the final '+WARNING_DAYS+' days.</span>'}box.className='fzTARetention'+cls;box.innerHTML=msg+'<button id="fzTAKeep">'+(state.retained?'ALLOW AUTO DELETE':'KEEP DATA')+'</button>';const b=document.getElementById('fzTAKeep');if(b)b.onclick=async()=>{b.disabled=true;try{await setRetention(key,!state.retained);toastSafe(!state.retained?'Table audit retained':'Auto-delete restored');await refreshRetentionPanel(key)}catch(e){toastSafe((e&&e.message)||'Could not update retention')}finally{b.disabled=false}}}
async function refreshRetentionWarnings(){const box=document.getElementById('fzTARetentionWarnings');if(!box)return;const result=await retentionSweep({quiet:true});if(result.warnings&&result.warnings.length){const nearest=result.warnings.slice().sort((a,b)=>a.daysLeft-b.daysLeft)[0];box.innerHTML='<strong>RETENTION WARNING</strong> • '+result.warnings.length+' shift(s) expire within '+WARNING_DAYS+' days. Nearest: '+escHtml(nearest.key)+' in '+nearest.daysLeft+' day(s). Open that date/shift and press KEEP DATA to preserve it.';box.style.display='block'}else box.style.display='none'}
async function render(){const mount=document.getElementById('fzTAReport');if(!mount)return;const key=keyFor(ui.date,ui.shift);mount.innerHTML='<div class="fzTAEmpty">Loading table history…</div>';await refreshRetentionPanel(key);await flushPending();if(!autoBackfilled.has(key)){await backfillShift(key,{quiet:true});autoBackfilled.add(key)}const events=await readEvents(key);const servers=[...new Set(events.flatMap(x=>[x.server,x.fromServer,x.toServer]).filter(Boolean))].sort();const serverSel=document.getElementById('fzTAServer');if(serverSel){const keep=ui.server;serverSel.innerHTML='<option value="ALL">ALL SERVERS</option>'+servers.map(x=>'<option value="'+escHtml(x)+'">'+escHtml(x)+'</option>').join('');serverSel.value=servers.includes(keep)?keep:'ALL';ui.server=serverSel.value}
  const filtered=events.filter(e=>{const tables=[mainTable(e),e.table,e.fromTable,e.toTable,...tableList(e.secondaryTables),...tableList(e.fromSecondaryTables),...tableList(e.toSecondaryTables),...tableList(e.secondaryBefore),...tableList(e.secondaryAfter)];return (ui.table==='ALL'||tables.includes(ui.table))&&(ui.server==='ALL'||e.server===ui.server||e.fromServer===ui.server||e.toServer===ui.server)&&(ui.type==='ALL'||e.type===ui.type)});
  const partyCount=new Set(filtered.map(x=>x.partyId).filter(Boolean)).size,swapCount=filtered.filter(x=>/SWAP/.test(x.type)).length,cancelCount=filtered.filter(x=>/CANCEL/.test(x.type)).length;
  document.getElementById('fzTAStats').innerHTML='<div class="fzTAStat"><small>EVENTS</small><strong>'+filtered.length+'</strong></div><div class="fzTAStat"><small>PARTIES</small><strong>'+partyCount+'</strong></div><div class="fzTAStat"><small>SWAPS</small><strong>'+swapCount+'</strong></div><div class="fzTAStat"><small>CANCEL / RESET</small><strong>'+cancelCount+'</strong></div>';
  mount._events=filtered;mount._key=key;
  if(!filtered.length){mount.innerHTML='<div class="fzTAEmpty">No recoverable events for '+escHtml(key)+'. Use BACKFILL SELECTED SHIFT for older surviving Board/Floor evidence.</div>';return}
  const head='<div class="fzTAReportHead"><span>TIME / DATE</span><span>SHIFT</span><span>SERVER</span><span>GUESTS</span><span>MAIN TABLE</span><span>SECONDARY</span><span>EVENT</span><span>DESCRIPTION</span></div>';
  mount.innerHTML=head+'<div class="fzTATimeline">'+filtered.map(e=>{const started=e.seatedAt&&e.at!==e.seatedAt?'<small>Seated start: '+escHtml(fmtTime(e.seatedAt))+'</small>':'';return '<article class="fzTAEvent"><div class="time"><b>'+escHtml(fmtTime(e.at))+'</b><span>'+escHtml(e.date||fmtDate(e.at))+'</span></div><div class="shift">'+escHtml(e.shift||'—')+'</div><div class="server">'+escHtml(e.server||e.toServer||e.fromServer||'—')+'</div><div class="guests">'+escHtml(e.people?(e.people+' guests'):'—')+'</div><div class="main">'+escHtml(mainTable(e))+'</div><div class="secondary">'+escHtml(secondaryText(e))+'</div><div class="event">'+escHtml(e.label||e.type)+'</div><div class="detail">'+escHtml(simpleDetails(e))+started+'</div></article>'}).join('')+'</div>';
}
function openReport(){if(typeof quickIsManager==='function'&&!quickIsManager())return toastSafe('Table Shift Report • Manager / Owner only');styles();const mount=typeof quickPrepareLegacy==='function'?quickPrepareLegacy('Table Shift Report • Audit Trail'):null;if(!mount)return;let d='';try{d=selectedDate()}catch(_){d=new Date().toISOString().slice(0,10)}let sh='AM';try{sh=shift()}catch(_){ }ui={date:d,shift:sh,table:'ALL',server:'ALL',type:'ALL'};const types=['ALL',...Object.keys(EVENT_LABELS)];mount.innerHTML='<div class="fzTA"><div class="fzTAHead"><div><h2>Table Shift Report</h2><p>Simple shift history: time/date, shift, server, main table, secondary tables, and clear swap/cancel notes. Persistent history survives Clear Shift.</p></div></div><div class="fzTANote">R3M.8.50 keeps Server and Guests separate and writes live audit events through a background durability queue so table operations do not wait on report logging and records simple table/server history with main and secondary tables going forward. Table audit shifts auto-delete after 13 calendar months unless KEEP DATA is enabled. BACKFILL can recover older seating and some cancel/reset evidence only when the old Board/Floor audit still exists; missing historical swaps are never invented.</div><div id="fzTARetentionWarnings" class="fzTARetentionWarnings"></div><div id="fzTARetention" class="fzTARetention"></div><div class="fzTAControls"><div><label>DATE</label><input id="fzTADate" type="date" value="'+escHtml(d)+'"></div><div><label>SHIFT</label><select id="fzTAShift"><option'+(sh==='AM'?' selected':'')+'>AM</option><option'+(sh==='PM'?' selected':'')+'>PM</option></select></div><div><label>TABLE</label><select id="fzTATable"><option value="ALL">ALL TABLES</option>'+allTables().map(x=>'<option>'+escHtml(x)+'</option>').join('')+'</select></div><div><label>SERVER</label><select id="fzTAServer"><option value="ALL">ALL SERVERS</option></select></div><div><label>EVENT</label><select id="fzTAType">'+types.map(x=>'<option value="'+escHtml(x)+'">'+escHtml(x==='ALL'?'ALL EVENTS':(EVENT_LABELS[x]||x))+'</option>').join('')+'</select></div></div><div class="fzTABtns"><button id="fzTARefresh" class="primary">REFRESH</button><button id="fzTABackfill">BACKFILL SELECTED SHIFT</button><button id="fzTACsv">DOWNLOAD CSV</button></div><div id="fzTAStats" class="fzTAStats"></div><div id="fzTAReport"></div></div>';
  document.getElementById('fzTADate').onchange=e=>{ui.date=e.target.value;render()};document.getElementById('fzTAShift').onchange=e=>{ui.shift=e.target.value;render()};document.getElementById('fzTATable').onchange=e=>{ui.table=e.target.value;render()};document.getElementById('fzTAServer').onchange=e=>{ui.server=e.target.value;render()};document.getElementById('fzTAType').onchange=e=>{ui.type=e.target.value;render()};document.getElementById('fzTARefresh').onclick=render;document.getElementById('fzTABackfill').onclick=async()=>{const b=document.getElementById('fzTABackfill');b.disabled=true;b.textContent='BACKFILLING…';try{await backfillShift(keyFor(ui.date,ui.shift));await render()}finally{b.disabled=false;b.textContent='BACKFILL SELECTED SHIFT'}};document.getElementById('fzTACsv').onclick=()=>{const r=document.getElementById('fzTAReport');if(r&&r._events)downloadCsv(r._events,r._key||keyFor(ui.date,ui.shift));else toastSafe('Refresh report first')};if(typeof quickSetOpen==='function')quickSetOpen('quickLegacyPanel',true);refreshRetentionWarnings().catch(()=>{});render();
}
global.FZQBOpenTableAudit=openReport;
function injectMenu(){const grid=document.getElementById('quickReservations')&&document.getElementById('quickReservations').parentElement;if(!grid||document.getElementById('quickTableAudit'))return;const b=document.createElement('button');b.id='quickTableAudit';b.className='quickMenuBtn quickManagerOnly';b.type='button';b.innerHTML='<strong>Table Shift Report</strong><span>Manager • simple table/server/secondary/swap history</span>';b.onclick=openReport;grid.appendChild(b);try{if(typeof quickApplyAccessVisibility==='function')quickApplyAccessVisibility()}catch(_){}}
function install(){styles();injectMenu();wrapOperations();schedulePendingFlush();setTimeout(()=>{try{if(typeof quickIsManager==='function'&&quickIsManager())retentionSweep({quiet:true}).catch(()=>{})}catch(_){}},1800);setInterval(schedulePendingFlush,30000)}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})(typeof window!=='undefined'?window:globalThis);
