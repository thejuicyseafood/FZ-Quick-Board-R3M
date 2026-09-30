/* FZ Quick Board R3M.8.27 — Shift Correction + Persistent Analytics */
(function(global){
'use strict';

const BUILD='R3M.8.27';
const BAR_AUTO='barAuto';
const CAPACITY=60;
const ROWS=15;

const clone=v=>JSON.parse(JSON.stringify(v==null?null:v));
const text=v=>String(v==null?'':v);
const int=v=>Number.isInteger(v)?v:(typeof v==='string'&&/^\d+$/.test(v)?Number(v):null);
const safeInt=(v,d=0)=>{const n=parseInt(v,10);return Number.isFinite(n)?n:d};
const pad2=n=>String(n).padStart(2,'0');

function indexed(value,len){
  const out=Array.from({length:len},()=>null);
  if(Array.isArray(value)){for(let i=0;i<Math.min(len,value.length);i++)out[i]=value[i];return out}
  if(value&&typeof value==='object')Object.entries(value).forEach(([k,v])=>{if(/^\d+$/.test(k)){const i=Number(k);if(i>=0&&i<len)out[i]=v}});
  return out;
}
function emptyTurn(){return {table:'',people:'',master:null,skipped:false,skipType:'',entryId:''}}
function normTurn(t){
  t=t&&typeof t==='object'?t:{};
  return {table:text(t.table),people:text(t.people),master:int(t.master),skipped:!!t.skipped,skipType:text(t.skipType||t.skipKind||(t.skipped?'manual':'')),entryId:text(t.entryId||t.partyId)};
}
function emptyRow(){return {server:'',section:'',workShift:'',beeper:'',active:false,cutAt:0,cutReason:'',turns:Array.from({length:CAPACITY},emptyTurn)}}
function normRow(raw){
  const r=raw&&typeof raw==='object'?raw:{};
  const server=text(r.server);
  return {server,section:text(r.section),workShift:text(r.workShift),beeper:text(r.beeper),active:server?(r.active!==false):false,cutAt:Number(r.cutAt||0)||0,cutReason:text(r.cutReason),turns:indexed(r.turns,CAPACITY).map(normTurn)};
}
function normalizeBoard(raw){return {rows:indexed(raw&&raw.rows,ROWS).map(normRow)}}
function turnPayload(t){return !!(t&&(t.table||t.people||t.skipped||Number.isInteger(t.master)||t.entryId))}
function isBarAuto(t){return !!(t&&t.skipped&&text(t.skipType).toLowerCase()===BAR_AUTO.toLowerCase())}
function isBarSection(section){return /bar/i.test(text(section))}
function hasBoardHistory(raw){
  const b=normalizeBoard(raw);
  return b.rows.some(r=>(r.turns||[]).some(turnPayload));
}
function hasBoardSetup(raw){
  const b=normalizeBoard(raw);
  return b.rows.some(r=>r.server||r.section||r.workShift||r.beeper||(r.turns||[]).some(turnPayload));
}
function partyEpoch(entryId){const m=text(entryId).match(/^seat_(\d{13})_/);return m?Number(m[1]):0}
function weekdayForDate(date){try{return new Date(date+'T12:00:00').toLocaleDateString('en-US',{weekday:'long'})}catch(_){return ''}}
function boardTurnUnits(rawRow){
  const row=normRow(rawRow),turns=row.turns,units=[];
  for(let i=0;i<CAPACITY;i++){
    const t=turns[i];
    if(!turnPayload(t))continue;
    if(isBarAuto(t))continue;
    if(t.skipped){units.push({type:'skip',oldStart:i,oldIndexes:[i],turn:clone(t)});continue}
    if(t.table){
      const people=Math.max(1,safeInt(t.people,1)),need=Math.max(1,Math.ceil(people/4)),master=Number.isInteger(t.master)?t.master:i,oldIndexes=[i];
      for(let j=i+1;j<CAPACITY&&oldIndexes.length<need;j++){
        const q=turns[j];
        if(!q||q.skipped||q.table)break;
        const sameMaster=Number.isInteger(q.master)&&q.master===master;
        const sameId=t.entryId&&q.entryId&&q.entryId===t.entryId;
        if(!(sameMaster||sameId))break;
        oldIndexes.push(j);
      }
      if(oldIndexes.length!==need)throw new Error('BAR history is incomplete at '+(t.table||('turn '+(i+1)))+'. Shift correction stopped.');
      units.push({type:'party',oldStart:i,oldIndexes,table:t.table,people:String(people),entryId:t.entryId,slots:need});
      i=oldIndexes[oldIndexes.length-1];
      continue;
    }
    /* An orphan continuation is unsafe to move because it can change party chronology. */
    if(t.people||Number.isInteger(t.master)||t.entryId)throw new Error('BAR continuation cannot be linked safely at turn '+(i+1)+'. Shift correction stopped.');
  }
  return units;
}
function rebuildBarRow(rawRow,targetShift){
  const row=normRow(rawRow),units=boardTurnUnits(row),out=Array.from({length:CAPACITY},emptyTurn),oldToNew={},entryToNew={};
  let cursor=0,partyCount=0,manualSkipCount=0,barAutoCount=0;
  const ensure=n=>{if(cursor+n>CAPACITY)throw new Error('BAR history needs more than '+CAPACITY+' turns after shift correction. Nothing changed.')};
  for(const unit of units){
    if(unit.type==='skip'){
      ensure(1);const t=normTurn(unit.turn);t.master=cursor;t.skipped=true;t.skipType=t.skipType||'manual';out[cursor]=t;oldToNew[unit.oldStart]=cursor;manualSkipCount++;cursor++;continue;
    }
    ensure(unit.slots+(targetShift==='PM'&&((partyCount+1)%2===0)?1:0));
    const start=cursor;
    for(let k=0;k<unit.slots;k++){
      out[cursor]={table:k===0?unit.table:'',people:unit.people,master:start,skipped:false,skipType:'',entryId:unit.entryId};
      oldToNew[unit.oldIndexes[k]]=cursor;cursor++;
    }
    oldToNew[unit.oldStart]=start;if(unit.entryId)entryToNew[unit.entryId]=start;partyCount++;
    if(targetShift==='PM'&&partyCount%2===0){
      ensure(1);out[cursor]={table:'',people:'',master:cursor,skipped:true,skipType:BAR_AUTO,entryId:unit.entryId};barAutoCount++;cursor++;
    }
  }
  return {row:{...row,turns:out},oldToNew,entryToNew,partyCount,manualSkipCount,barAutoCount};
}
function transformBoardForShift(rawBoard,targetShift){
  const src=normalizeBoard(rawBoard),turnMaps={},entryMap={};
  const rows=src.rows.map((row,ri)=>{
    if(!isBarSection(row.section))return clone(row);
    const built=rebuildBarRow(row,targetShift);turnMaps[ri]=built.oldToNew;
    Object.entries(built.entryToNew).forEach(([entryId,turn])=>entryMap[entryId]={row:ri,turn});
    return built.row;
  });
  /* Also index non-BAR parties for active Floor references. */
  rows.forEach((row,ri)=>(row.turns||[]).forEach((t,ti)=>{if(t&&!t.skipped&&t.table&&t.entryId&&!entryMap[t.entryId])entryMap[t.entryId]={row:ri,turn:ti}}));
  return {board:{rows},turnMaps,entryMap};
}
function buildSkipLocksFromBoard(rawBoard,updatedBy='Shift Correction'){
  const b=normalizeBoard(rawBoard),locks={},now=Date.now();
  b.rows.forEach((row,ri)=>(row.turns||[]).forEach((t,ti)=>{if(!t||!t.skipped)return;locks['r'+ri+'_t'+ti]={active:true,row:ri,turn:ti,server:text(row.server),skipType:text(t.skipType||'manual'),entryId:text(t.entryId),updatedAt:now,updatedBy:text(updatedBy)}}));
  return locks;
}
function rewriteBoardRef(ref,sourceKey,targetKey,entryMap,turnMaps){
  if(!ref||typeof ref!=='object'||text(ref.boardKey)!==sourceKey)return ref;
  const out={...ref,boardKey:targetKey};const eid=text(ref.entryId);
  if(eid&&entryMap[eid]){out.row=entryMap[eid].row;out.turn=entryMap[eid].turn;return out}
  const ri=Number(ref.row),ti=Number(ref.turn),mapped=turnMaps[ri]&&turnMaps[ri][ti];
  if(Number.isInteger(mapped)){out.turn=mapped;return out}
  return out;
}
function rewriteTableRefs(tables,sourceKey,targetKey,entryMap,turnMaps){
  const updates={};
  Object.entries(tables||{}).forEach(([id,state])=>{
    if(!state||typeof state!=='object')return;
    let changed=false,next={...state};
    for(const field of ['boardRef','primaryBoardRef']){
      const before=state[field],after=rewriteBoardRef(before,sourceKey,targetKey,entryMap,turnMaps);
      if(after!==before){next[field]=after;changed=true}
    }
    if(changed){next.updatedAt=Date.now();next.shiftCorrectedFrom=sourceKey;updates[id]=next}
  });
  return updates;
}
function recursiveBoardKeyReplace(value,sourceKey,targetKey){
  if(Array.isArray(value))return value.map(v=>recursiveBoardKeyReplace(v,sourceKey,targetKey));
  if(value&&typeof value==='object'){
    const out={};for(const [k,v] of Object.entries(value)){if(k==='boardKey'&&text(v)===sourceKey)out[k]=targetKey;else out[k]=recursiveBoardKeyReplace(v,sourceKey,targetKey)}return out;
  }
  return value;
}
function extractAnalyticsSnapshot(rawBoard,date,shift,meta={}){
  const b=normalizeBoard(rawBoard),events=[],serverMap=new Map(),tableMap=new Map(),sectionMap=new Map(),hourMap=new Map();
  let manualSkips=0,barAutoSkips=0,rotationTurns=0,largest=null;
  const bump=(map,key,seed,party)=>{if(!map.has(key))map.set(key,{...seed,parties:0,guests:0,rotationTurns:0});const x=map.get(key);if(party){x.parties++;x.guests+=party.people;x.rotationTurns+=party.rotationSlots}return x};
  b.rows.forEach((row,ri)=>{
    if(!row.server&&!row.section)return;
    (row.turns||[]).forEach((t,ti)=>{
      if(!turnPayload(t))return;
      if(t.skipped){if(isBarAuto(t))barAutoSkips++;else manualSkips++;return}
      if(!t.table)return;
      const people=Math.max(0,safeInt(t.people,0)),rotationSlots=Math.max(1,Math.ceil(Math.max(1,people)/4)),seatedAt=partyEpoch(t.entryId),hour=seatedAt?new Date(seatedAt).getHours():null;
      const ev={id:t.entryId||('r'+ri+'t'+ti),entryId:t.entryId||'',server:row.server||'Unknown',section:row.section||'',table:t.table,people,rotationSlots,row:ri,turn:ti,seatedAt:seatedAt||0,hour:Number.isInteger(hour)?hour:null,date,shift};
      events.push(ev);rotationTurns+=rotationSlots;
      bump(serverMap,ev.server,{server:ev.server},ev);bump(tableMap,ev.table,{table:ev.table},ev);bump(sectionMap,ev.section||'UNASSIGNED',{section:ev.section||'UNASSIGNED'},ev);
      if(Number.isInteger(hour)){const hk=String(hour);if(!hourMap.has(hk))hourMap.set(hk,{hour,parties:0,guests:0});hourMap.get(hk).parties++;hourMap.get(hk).guests+=people}
      if(!largest||people>largest.people)largest=clone(ev);
    });
  });
  const guests=events.reduce((s,e)=>s+e.people,0),summary={parties:events.length,guests,rotationTurns,manualSkips,barAutoSkips,avgParty:events.length?guests/events.length:0,largestParty:largest?largest.people:0};
  return {build:BUILD,boardKey:date+'_'+shift,date,weekday:weekdayForDate(date),shift,syncedAt:Date.now(),syncedBy:text(meta.by||''),syncSource:text(meta.source||'MANUAL SYNC'),summary,largestParty:largest,events,servers:[...serverMap.values()].sort((a,b)=>b.parties-a.parties||b.guests-a.guests||a.server.localeCompare(b.server)),tables:[...tableMap.values()].sort((a,b)=>b.parties-a.parties||b.guests-a.guests||a.table.localeCompare(b.table)),sections:[...sectionMap.values()].sort((a,b)=>b.parties-a.parties),hours:[...hourMap.values()].sort((a,b)=>a.hour-b.hour)};
}
function snapshotEvents(snapshot){
  const raw=snapshot&&snapshot.events;
  if(Array.isArray(raw))return raw.filter(Boolean);
  if(raw&&typeof raw==='object')return Object.values(raw).filter(Boolean);
  return [];
}
function aggregateAnalytics(records){
  const server=new Map(),table=new Map(),section=new Map(),date=new Map(),weekday=new Map(),hour=new Map(),shiftMap=new Map();
  let parties=0,guests=0,rotationTurns=0,manualSkips=0,barAutoSkips=0,largest=null,minDate='',maxDate='';
  const add=(map,key,seed,e)=>{if(!map.has(key))map.set(key,{...seed,parties:0,guests:0,rotationTurns:0});const x=map.get(key);x.parties++;x.guests+=safeInt(e.people,0);x.rotationTurns+=Math.max(1,safeInt(e.rotationSlots,1));return x};
  for(const rec of records){
    if(!rec||!rec.date)continue;minDate=!minDate||rec.date<minDate?rec.date:minDate;maxDate=!maxDate||rec.date>maxDate?rec.date:maxDate;
    manualSkips+=safeInt(rec.summary&&rec.summary.manualSkips,0);barAutoSkips+=safeInt(rec.summary&&rec.summary.barAutoSkips,0);
    for(const e of snapshotEvents(rec)){
      parties++;guests+=safeInt(e.people,0);rotationTurns+=Math.max(1,safeInt(e.rotationSlots,1));
      add(server,text(e.server||'Unknown'),{server:text(e.server||'Unknown')},e);add(table,text(e.table||'Unknown'),{table:text(e.table||'Unknown')},e);add(section,text(e.section||'UNASSIGNED'),{section:text(e.section||'UNASSIGNED')},e);
      add(date,text(e.date||rec.date),{date:text(e.date||rec.date)},e);
      const wd=weekdayForDate(text(e.date||rec.date));add(weekday,wd,{weekday:wd},e);add(shiftMap,text(e.shift||rec.shift||'—'),{shift:text(e.shift||rec.shift||'—')},e);
      const h=Number(e.hour);if(Number.isInteger(h)){if(!hour.has(h))hour.set(h,{hour:h,parties:0,guests:0,rotationTurns:0});const x=hour.get(h);x.parties++;x.guests+=safeInt(e.people,0);x.rotationTurns+=Math.max(1,safeInt(e.rotationSlots,1))}
      if(!largest||safeInt(e.people,0)>safeInt(largest.people,0))largest=clone(e);
    }
  }
  const sort=(arr,primary='parties')=>arr.sort((a,b)=>safeInt(b[primary],0)-safeInt(a[primary],0)||safeInt(b.guests,0)-safeInt(a.guests,0)||text(a.server||a.table||a.date||a.weekday||a.section).localeCompare(text(b.server||b.table||b.date||b.weekday||b.section)));
  return {records:records.length,minDate,maxDate,parties,guests,rotationTurns,manualSkips,barAutoSkips,avgParty:parties?guests/parties:0,largest,
    servers:sort([...server.values()]),tables:sort([...table.values()]),sections:sort([...section.values()]),dates:sort([...date.values()]),weekdays:sort([...weekday.values()]),hours:[...hour.values()].sort((a,b)=>a.hour-b.hour),shifts:sort([...shiftMap.values()])};
}
function periodRange(mode,valueA,valueB){
  if(mode==='monthly'){
    const month=/^\d{4}-\d{2}$/.test(valueA)?valueA:new Date().toISOString().slice(0,7),[y,m]=month.split('-').map(Number),last=new Date(y,m,0).getDate();
    return {from:month+'-01',to:month+'-'+pad2(last),label:month};
  }
  if(mode==='custom'){const a=valueA||'',b=valueB||a;return {from:a<=b?a:b,to:a<=b?b:a,label:(a<=b?a:b)+' → '+(a<=b?b:a)}}
  const d=valueA||new Date().toISOString().slice(0,10);return {from:d,to:d,label:d};
}
function formatHour(h){if(!Number.isInteger(h))return '—';const suffix=h>=12?'PM':'AM',n=h%12||12;return n+':00 '+suffix}

const API={BUILD,BAR_AUTO,CAPACITY,normalizeBoard,hasBoardHistory,hasBoardSetup,isBarAuto,isBarSection,boardTurnUnits,rebuildBarRow,transformBoardForShift,buildSkipLocksFromBoard,rewriteTableRefs,recursiveBoardKeyReplace,extractAnalyticsSnapshot,aggregateAnalytics,periodRange,formatHour};
if(typeof module==='object'&&module.exports){module.exports=API;return}
global.FZShiftAnalyticsV27=API;

/* ========================= BROWSER INTEGRATION ========================= */
const ANALYTICS_CHILD='analyticsV1';
let shiftCorrectionBusy=false,analyticsBusy=false,analyticsUi={mode:'daily',from:'',to:'',month:''};
function analyticsRoot(){return ROOT+'/'+ANALYTICS_CHILD}
function relChild(rootUrl,key=''){const base=String(rootUrl).slice(String(ROOT).length+1);return base+(key?('/'+key):'')}
function meaningfulFloorRefTo(tables,key){return Object.values(tables||{}).some(s=>s&&((s.boardRef&&text(s.boardRef.boardKey)===key)||(s.primaryBoardRef&&text(s.primaryBoardRef.boardKey)===key)))}
function rawRowsHaveTurns(raw){return hasBoardHistory(raw)}
function analyticsBuildSnapshot(raw,key,source){const m=String(key).match(/^(\d{4}-\d{2}-\d{2})_(AM|PM)$/);if(!m)throw new Error('Invalid Board key for Analytics');return extractAnalyticsSnapshot(raw,m[1],m[2],{by:typeof role==='function'?role():'',source})}
async function analyticsWriteSnapshot(raw,key,source='MANUAL SYNC'){
  if(!raw||(!hasBoardSetup(raw)&&!hasBoardHistory(raw)))return {saved:false,reason:'empty'};
  if(raw.cleared===true&&!hasBoardHistory(raw))return {saved:false,reason:'cleared'};
  const snap=analyticsBuildSnapshot(raw,key,source);
  await writeJ(analyticsRoot()+'/'+key+'.json',snap,'PUT');
  const verify=await readJ(analyticsRoot()+'/'+key+'.json');
  if(!verify||text(verify.boardKey)!==key||safeInt(verify.summary&&verify.summary.parties,-1)!==safeInt(snap.summary.parties,-2))throw new Error('Analytics verification failed for '+key);
  return {saved:true,snapshot:snap};
}
async function syncAnalyticsToday({silent=false}={}){
  if(analyticsBusy)throw new Error('Analytics Sync is already running.');analyticsBusy=true;
  try{
    const date=selectedDate(),keys=[date+'_AM',date+'_PM'],raws=await Promise.all(keys.map(k=>readJ(BOARD_ROOT+'/'+k+'.json'))),results=[];
    for(let i=0;i<keys.length;i++)results.push(await analyticsWriteSnapshot(raws[i],keys[i],'SYNC TODAY'));
    const count=results.filter(r=>r.saved).length;if(!silent)toast(count?'ANALYTICS SYNCED • '+count+' SHIFT'+(count===1?'':'S'):'NO LIVE SHIFT HISTORY TO SYNC');return count;
  }finally{analyticsBusy=false}
}
async function preClearAnalytics(target){
  try{
    const key=text(target&&target.key||boardKey()),raw=await readJ(BOARD_ROOT+'/'+key+'.json');
    if(!raw||!hasBoardSetup(raw)||raw.cleared===true)return true;
    await analyticsWriteSnapshot(raw,key,'AUTO BEFORE CLEAR SHIFT');
    return true;
  }catch(e){toast('CLEAR STOPPED • ANALYTICS SYNC FAILED');console.error(e);return false}
}
global.FZQBAnalyticsPreClear=preClearAnalytics;

function activeTargetRefs(tables,targetKey){return Object.entries(tables||{}).filter(([,s])=>s&&((s.boardRef&&text(s.boardRef.boardKey)===targetKey)||(s.primaryBoardRef&&text(s.primaryBoardRef.boardKey)===targetKey))).map(([id])=>id)}
function tableRefTurnIsResolvable(state,sourceKey,transformed){
  for(const field of ['boardRef','primaryBoardRef']){
    const ref=state&&state[field];if(!ref||text(ref.boardKey)!==sourceKey)continue;
    const eid=text(ref.entryId);if(eid&&transformed.entryMap[eid])continue;
    const ri=Number(ref.row),ti=Number(ref.turn);if(!Number.isInteger(ri)||!Number.isInteger(ti)||!transformed.turnMaps[ri]||!Number.isInteger(transformed.turnMaps[ri][ti]))return false;
  }
  return true;
}
async function readShiftCorrectionBundle(sourceKey,targetKey){
  const roots=[
    ['sourceBoard',BOARD_ROOT+'/'+sourceKey+'.json'],['targetBoard',BOARD_ROOT+'/'+targetKey+'.json'],['sourceFormation',FLOOR_FORMATION_ROOT+'/'+sourceKey+'.json'],['targetFormation',FLOOR_FORMATION_ROOT+'/'+targetKey+'.json'],['sourceAssignments',FLOOR_ASSIGN_ROOT+'/'+sourceKey+'.json'],['targetAssignments',FLOOR_ASSIGN_ROOT+'/'+targetKey+'.json'],['sourceLocks',SKIP_LOCK_ROOT+'/'+sourceKey+'.json'],['targetLocks',SKIP_LOCK_ROOT+'/'+targetKey+'.json'],['tables',TABLE_ROOT+'.json'],['sourceFloorHistory',FLOOR_HISTORY_ROOT+'/'+sourceKey+'.json'],['sourceCutUndo',CUT_UNDO_ROOT+'/'+sourceKey+'.json'],['sourceRecent',RECENT_SEAT_ROOT+'/'+sourceKey+'.json'],['sourceBreakAudit',BREAKTIME_AUDIT_ROOT+'/'+sourceKey+'.json'],['sourceSectionAudit',SECTION_CONTROL_AUDIT_ROOT+'/'+sourceKey+'.json'],['sourceBackup',BOARD_BACKUP_ROOT+'/'+sourceKey+'.json'],['sourceAnalytics',analyticsRoot()+'/'+sourceKey+'.json']
  ];
  const vals=await Promise.all(roots.map(x=>readJ(x[1]))),out={};roots.forEach((x,i)=>out[x[0]]=vals[i]);return out;
}
async function correctCurrentShift(targetShift,onProgress){
  targetShift=text(targetShift).toUpperCase();if(!['AM','PM'].includes(targetShift))throw new Error('Choose AM or PM.');
  if(shiftCorrectionBusy||clearShiftInFlight)throw new Error('Another Board operation is running.');
  const sourceShift=shift(),date=selectedDate();if(sourceShift===targetShift)throw new Error('Current Board is already '+targetShift+'.');
  if(!(await flushScheduledBoardSave()))throw new Error('Pending Board edit must finish first.');
  const sourceKey=date+'_'+sourceShift,targetKey=date+'_'+targetShift,owner=operationId('shift-correction');let claimed=[];
  const progress=t=>{try{if(typeof onProgress==='function')onProgress(t)}catch(_){}};
  shiftCorrectionBusy=true;progress('CHECKING LIVE BOARD…');
  try{
    let pre=await readShiftCorrectionBundle(sourceKey,targetKey);
    if(!pre.sourceBoard||!hasBoardSetup(pre.sourceBoard))throw new Error(sourceKey+' has no Board data to move.');
    if(rawRowsHaveTurns(pre.targetBoard))throw new Error('SAFETY STOP • '+targetKey+' already has table/SKIP history. Nothing was overwritten.');
    const targetRefs=activeTargetRefs(pre.tables,targetKey);if(targetRefs.length)throw new Error('SAFETY STOP • '+targetKey+' already has active Floor tables: '+targetRefs.join(', '));
    const sourceTableIds=Object.entries(pre.tables||{}).filter(([,s])=>s&&((s.boardRef&&text(s.boardRef.boardKey)===sourceKey)||(s.primaryBoardRef&&text(s.primaryBoardRef.boardKey)===sourceKey))).map(([id])=>id);
    progress('LOCKING BOARD + ACTIVE TABLES…');
    claimed=await claimTableLocksWithRetry(['BOARD '+sourceKey+' CLEAR','BOARD '+targetKey+' CLEAR',...sourceTableIds],owner,7000);
    if(!claimed.length)throw new Error('Could not secure Board and active tables. Try again.');
    clearShiftInFlight=true;boardLoadSeq++;formationLoadSeq++;floorAssignmentLoadSeq++;tableLoadSeq++;
    progress('RE-READING LIVE DATA…');pre=await readShiftCorrectionBundle(sourceKey,targetKey);
    if(!pre.sourceBoard||!hasBoardSetup(pre.sourceBoard))throw new Error(sourceKey+' changed or disappeared.');
    if(rawRowsHaveTurns(pre.targetBoard)||activeTargetRefs(pre.tables,targetKey).length)throw new Error('Target shift changed on another device. Nothing was moved.');

    progress(targetShift==='AM'?'REMOVING BAR PM AUTO SKIPS…':'REBUILDING BAR • 2 TABLES → 1 AUTO SKIP…');
    const transformed=transformBoardForShift(pre.sourceBoard,targetShift);
    for(const [id,state] of Object.entries(pre.tables||{}))if(state&&!tableRefTurnIsResolvable(state,sourceKey,transformed))throw new Error('Floor reference '+id+' cannot be moved safely. Nothing changed.');
    const newLocks=buildSkipLocksFromBoard(transformed.board,typeof role==='function'?role():'Shift Correction'),tableUpdates=rewriteTableRefs(pre.tables||{},sourceKey,targetKey,transformed.entryMap,transformed.turnMaps);
    const snap=extractAnalyticsSnapshot(transformed.board,date,targetShift,{by:typeof role==='function'?role():'',source:'SHIFT CORRECTION '+sourceShift+' → '+targetShift});
    const patch={};
    patch[relChild(BOARD_ROOT,targetKey)]={...transformed.board,date,shift:targetShift,shiftCorrectedAt:Date.now(),shiftCorrectedFrom:sourceKey};patch[relChild(BOARD_ROOT,sourceKey)]=null;
    patch[relChild(FLOOR_FORMATION_ROOT,targetKey)]=pre.sourceFormation||pre.targetFormation||null;patch[relChild(FLOOR_FORMATION_ROOT,sourceKey)]=null;
    patch[relChild(FLOOR_ASSIGN_ROOT,targetKey)]=pre.sourceAssignments||pre.targetAssignments||null;patch[relChild(FLOOR_ASSIGN_ROOT,sourceKey)]=null;
    patch[relChild(SKIP_LOCK_ROOT,targetKey)]=newLocks;patch[relChild(SKIP_LOCK_ROOT,sourceKey)]=null;
    patch[relChild(FLOOR_HISTORY_ROOT,targetKey)]=recursiveBoardKeyReplace(pre.sourceFloorHistory||null,sourceKey,targetKey);patch[relChild(FLOOR_HISTORY_ROOT,sourceKey)]=null;
    patch[relChild(CUT_UNDO_ROOT,targetKey)]=recursiveBoardKeyReplace(pre.sourceCutUndo||null,sourceKey,targetKey);patch[relChild(CUT_UNDO_ROOT,sourceKey)]=null;
    patch[relChild(RECENT_SEAT_ROOT,targetKey)]=recursiveBoardKeyReplace(pre.sourceRecent||null,sourceKey,targetKey);patch[relChild(RECENT_SEAT_ROOT,sourceKey)]=null;
    patch[relChild(BREAKTIME_AUDIT_ROOT,targetKey)]=recursiveBoardKeyReplace(pre.sourceBreakAudit||null,sourceKey,targetKey);patch[relChild(BREAKTIME_AUDIT_ROOT,sourceKey)]=null;
    patch[relChild(SECTION_CONTROL_AUDIT_ROOT,targetKey)]=recursiveBoardKeyReplace(pre.sourceSectionAudit||null,sourceKey,targetKey);patch[relChild(SECTION_CONTROL_AUDIT_ROOT,sourceKey)]=null;
    if(pre.sourceBackup!=null){patch[relChild(BOARD_BACKUP_ROOT,targetKey)]=recursiveBoardKeyReplace(pre.sourceBackup,sourceKey,targetKey);patch[relChild(BOARD_BACKUP_ROOT,sourceKey)]=null}
    Object.entries(tableUpdates).forEach(([id,state])=>patch[relChild(TABLE_ROOT,id)]=state);
    patch[ANALYTICS_CHILD+'/'+targetKey]=snap;patch[ANALYTICS_CHILD+'/'+sourceKey]=null;

    progress('MOVING HISTORY ATOMICALLY…');
    const response=await fetch(ROOT+'.json',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(patch)});if(!response.ok)throw new Error('Shift correction save failed.');
    progress('VERIFYING…');
    const [verifyBoard,verifySource,verifyTables,verifyLocks,verifyAnalytics]=await Promise.all([readJ(BOARD_ROOT+'/'+targetKey+'.json'),readJ(BOARD_ROOT+'/'+sourceKey+'.json'),readJ(TABLE_ROOT+'.json'),readJ(SKIP_LOCK_ROOT+'/'+targetKey+'.json'),readJ(analyticsRoot()+'/'+targetKey+'.json')]);
    if(!verifyBoard||verifySource!==null)throw new Error('Shift correction verification failed. Source/target Board state is not exact.');
    const vb=normalizeBoard(verifyBoard),barRows=vb.rows.filter(r=>isBarSection(r.section)),actualBar=barRows.reduce((n,r)=>n+r.turns.filter(t=>t&&!t.skipped&&t.table).length,0),autoBar=barRows.reduce((n,r)=>n+r.turns.filter(isBarAuto).length,0);
    const expectedAuto=targetShift==='PM'?barRows.reduce((n,r)=>n+Math.floor(r.turns.filter(t=>t&&!t.skipped&&t.table).length/2),0):0;if(autoBar!==expectedAuto)throw new Error('BAR AUTO SKIP verification failed: expected '+expectedAuto+', found '+autoBar+'.');
    const staleTable=Object.entries(verifyTables||{}).find(([,s])=>s&&((s.boardRef&&text(s.boardRef.boardKey)===sourceKey)||(s.primaryBoardRef&&text(s.primaryBoardRef.boardKey)===sourceKey)));if(staleTable)throw new Error('Floor reference verification failed for '+staleTable[0]+'.');
    const lockCount=Object.values(verifyLocks||{}).filter(x=>x&&x.active!==false).length,boardSkipCount=vb.rows.reduce((n,r)=>n+r.turns.filter(t=>t&&t.skipped).length,0);if(lockCount!==boardSkipCount)throw new Error('SKIP lock verification failed.');
    if(!verifyAnalytics||text(verifyAnalytics.boardKey)!==targetKey)throw new Error('Analytics shift snapshot verification failed.');

    try{clearBoardSnapshot(sourceKey);cacheBoardSnapshot(targetKey,vb,'SHIFT CORRECTION');clearBoardRecovery(sourceKey);clearBoardRecovery(targetKey)}catch(_){}
    clearShiftInFlight=false;
    $('shift').value=targetShift;if($('quickShift'))$('quickShift').value=targetShift;localStorage.setItem('jhb31_shift',targetShift);localStorage.setItem('jhb31_date',date);
    await fetchBoard(targetKey);await fetchFloorFormation(targetKey);await fetchFloorAssignments(targetKey);await fetchTables();updateNextServerSuggestion();updateViewMeta();renderBreaktimeView(true);if(typeof quickSyncHeader==='function')quickSyncHeader();if(typeof quickScheduleRefresh==='function')quickScheduleRefresh();
    progress('DONE');toast(sourceShift+' → '+targetShift+' • HISTORY MOVED • BAR AUTO '+autoBar);return {sourceKey,targetKey,barParties:actualBar,barAuto:autoBar,snapshot:snap};
  }finally{
    clearShiftInFlight=false;shiftCorrectionBusy=false;await releaseTableLocksFast(claimed,owner);
  }
}

function topItem(arr,key='parties'){return arr&&arr.length?arr.slice().sort((a,b)=>safeInt(b[key],0)-safeInt(a[key],0)||safeInt(b.guests,0)-safeInt(a.guests,0))[0]:null}
function escHtml(s){return typeof esc==='function'?esc(s):text(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
function metricCard(label,value,sub=''){return '<div class="fzAStat"><small>'+escHtml(label)+'</small><strong>'+escHtml(value)+'</strong>'+(sub?'<span>'+escHtml(sub)+'</span>':'')+'</div>'}
function barList(title,items,labelKey='server',valueKey='parties',limit=12){
  const arr=(items||[]).slice(0,limit),max=Math.max(1,...arr.map(x=>safeInt(x[valueKey],0)));
  return '<section class="fzASection"><h3>'+escHtml(title)+'</h3><div class="fzABars">'+(arr.length?arr.map((x,i)=>'<div class="fzABarRow"><div class="fzABarLabel"><b>'+escHtml((i+1)+'. '+text(x[labelKey]))+'</b><span>'+escHtml(safeInt(x[valueKey],0)+' • '+safeInt(x.guests,0)+' guests')+'</span></div><div class="fzABarTrack"><i style="width:'+Math.max(2,Math.round(safeInt(x[valueKey],0)*100/max))+'%"></i></div></div>').join(''):'<div class="fzAEmpty">No data in this period.</div>')+'</div></section>';
}
function hourList(items){
  const arr=(items||[]),max=Math.max(1,...arr.map(x=>safeInt(x.parties,0)));
  return '<section class="fzASection"><h3>Traffic by Hour</h3><div class="fzAHours">'+(arr.length?arr.map(x=>'<div class="fzAHour"><b>'+escHtml(formatHour(Number(x.hour)))+'</b><div><i style="height:'+Math.max(5,Math.round(safeInt(x.parties,0)*90/max))+'px"></i></div><span>'+safeInt(x.parties,0)+'</span></div>').join(''):'<div class="fzAEmpty">Seating timestamps are unavailable for this period.</div>')+'</div></section>';
}
function analyticsConclusion(a,range){
  if(!a.parties)return 'No synced seating data is available for '+range.label+'. Press SYNC TODAY after the Board has live history.';
  const srv=topItem(a.servers),tbl=topItem(a.tables),day=topItem(a.dates),wd=topItem(a.weekdays),sec=topItem(a.sections),rot=topItem(a.servers,'rotationTurns'),hour=(a.hours||[]).slice().sort((x,y)=>y.parties-x.parties)[0],sh=topItem(a.shifts),lp=a.largest;
  const parts=['Analysis '+range.from+(range.to!==range.from?' through '+range.to:'')+': '+a.parties+' parties / '+a.guests+' guests were recorded.'];
  if(day)parts.push('Busiest date: '+day.date+' ('+day.parties+' parties, '+day.guests+' guests).');
  if(wd)parts.push('Busiest weekday: '+wd.weekday+' ('+wd.parties+' parties).');
  if(srv)parts.push('Server with the most tables/parties served: '+srv.server+' ('+srv.parties+' parties, '+srv.guests+' guests).');
  if(rot)parts.push('Most Board rotation turns: '+rot.server+' ('+rot.rotationTurns+' turns).');
  if(tbl)parts.push('Most-used table: '+tbl.table+' ('+tbl.parties+' seatings, '+tbl.guests+' guests).');
  if(sec)parts.push('Busiest section: '+sec.section+' ('+sec.parties+' parties).');
  if(hour)parts.push('Busiest recorded hour: '+formatHour(Number(hour.hour))+' ('+hour.parties+' parties).');
  if(sh)parts.push('Higher-volume synced shift: '+sh.shift+' ('+sh.parties+' parties).');
  if(lp)parts.push('Largest party: '+safeInt(lp.people,0)+' guests at '+lp.table+' served by '+lp.server+'.');
  parts.push('Average party size: '+a.avgParty.toFixed(1)+'. Manual SKIPs: '+a.manualSkips+'. BAR AUTO SKIPs: '+a.barAutoSkips+'.');return parts.join(' ');
}
async function loadAnalyticsRange(range){
  const raw=(await readJ(analyticsRoot()+'.json'))||{};return Object.values(raw).filter(r=>r&&r.date&&r.date>=range.from&&r.date<=range.to).sort((a,b)=>a.date.localeCompare(b.date)||text(a.shift).localeCompare(text(b.shift)));
}
function csvEscape(v){const s=text(v);return /[",\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s}
function downloadAnalyticsCsv(a,range){
  const rows=[['Period From',range.from],['Period To',range.to],['Total Parties',a.parties],['Total Guests',a.guests],['Average Party',a.avgParty.toFixed(2)],['Rotation Turns',a.rotationTurns],['Manual Skips',a.manualSkips],['BAR Auto Skips',a.barAutoSkips],[],['SERVER','PARTIES','GUESTS','ROTATION TURNS'],...a.servers.map(x=>[x.server,x.parties,x.guests,x.rotationTurns]),[],['TABLE','SEATINGS','GUESTS'],...a.tables.map(x=>[x.table,x.parties,x.guests]),[],['DATE','PARTIES','GUESTS'],...a.dates.map(x=>[x.date,x.parties,x.guests])];
  const blob=new Blob(['\ufeff'+rows.map(r=>r.map(csvEscape).join(',')).join('\n')],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='FZ_Quick_Board_Analytics_'+range.from+'_'+range.to+'.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function renderAnalyticsReport(){
  const mode=analyticsUi.mode,fromEl=document.getElementById('fzAFrom'),toEl=document.getElementById('fzATo'),monthEl=document.getElementById('fzAMonth'),dailyEl=document.getElementById('fzADay');
  let range;if(mode==='monthly')range=periodRange('monthly',monthEl&&monthEl.value);else if(mode==='custom')range=periodRange('custom',fromEl&&fromEl.value,toEl&&toEl.value);else range=periodRange('daily',dailyEl&&dailyEl.value);
  const body=document.getElementById('fzAReport');if(!body)return;body.innerHTML='<div class="fzALoading">Loading Analytics…</div>';
  try{
    const records=await loadAnalyticsRange(range),a=aggregateAnalytics(records);body._analytics=a;body._range=range;
    const topServer=topItem(a.servers),topTable=topItem(a.tables),topDate=topItem(a.dates),topRotation=topItem(a.servers,'rotationTurns');
    body.innerHTML='<div class="fzASummaryGrid">'+metricCard('PARTIES',a.parties,'served tables / parties')+metricCard('GUESTS',a.guests,'total guests')+metricCard('AVG PARTY',a.parties?a.avgParty.toFixed(1):'0','guests per party')+metricCard('ROTATION TURNS',a.rotationTurns,'Board seating boxes')+metricCard('TOP SERVER',topServer?topServer.server:'—',topServer?(topServer.parties+' parties'):'')+metricCard('TOP TABLE',topTable?topTable.table:'—',topTable?(topTable.parties+' uses'):'')+metricCard('BUSIEST DATE',topDate?topDate.date:'—',topDate?(topDate.parties+' parties'):'')+metricCard('MOST ROTATION',topRotation?topRotation.server:'—',topRotation?(topRotation.rotationTurns+' turns'):'')+'</div><section class="fzAConclusion"><h3>Analysis Conclusion</h3><p>'+escHtml(analyticsConclusion(a,range))+'</p></section>'+barList('Servers • Tables/Parties Served',a.servers,'server','parties',15)+barList('Servers • Board Rotation Turns',a.servers,'server','rotationTurns',15)+barList('Most-Used Tables',a.tables,'table','parties',15)+(range.from===range.to?hourList(a.hours):barList('Traffic by Date',a.dates,'date','parties',31))+barList('Traffic by Weekday',a.weekdays,'weekday','parties',7)+barList('Traffic by Shift',a.shifts,'shift','parties',2)+barList('Sections',a.sections,'section','parties',12)+'<section class="fzASection"><h3>Synced Data</h3><div class="fzATableWrap"><table class="fzATable"><thead><tr><th>Date</th><th>Shift</th><th>Parties</th><th>Guests</th><th>Rotation</th><th>Manual Skip</th><th>BAR Auto</th><th>Last Sync</th></tr></thead><tbody>'+records.map(r=>'<tr><td>'+escHtml(r.date)+'</td><td>'+escHtml(r.shift)+'</td><td>'+safeInt(r.summary&&r.summary.parties,0)+'</td><td>'+safeInt(r.summary&&r.summary.guests,0)+'</td><td>'+safeInt(r.summary&&r.summary.rotationTurns,0)+'</td><td>'+safeInt(r.summary&&r.summary.manualSkips,0)+'</td><td>'+safeInt(r.summary&&r.summary.barAutoSkips,0)+'</td><td>'+escHtml(r.syncedAt?new Date(r.syncedAt).toLocaleString():'—')+'</td></tr>').join('')+'</tbody></table></div></section>';
  }catch(e){body.innerHTML='<div class="fzAError">'+escHtml((e&&e.message)||'Could not load Analytics')+'</div>'}
}
function setAnalyticsMode(mode){
  analyticsUi.mode=mode;document.querySelectorAll('[data-fza-mode]').forEach(b=>b.classList.toggle('active',b.dataset.fzaMode===mode));
  const d=document.getElementById('fzADailyFields'),m=document.getElementById('fzAMonthlyFields'),c=document.getElementById('fzACustomFields');if(d)d.hidden=mode!=='daily';if(m)m.hidden=mode!=='monthly';if(c)c.hidden=mode!=='custom';renderAnalyticsReport();
}
function openAnalytics(){
  if(typeof quickRequireManager==='function'&&!quickRequireManager(null,'Analytics'))return;
  const mount=quickPrepareLegacy('Analytics • Permanent History');const today=selectedDate(),month=today.slice(0,7);analyticsUi={mode:'daily',from:today,to:today,month};
  mount.innerHTML='<div class="fzAnalytics"><div class="fzAHead"><div><h2>Business Analytics</h2><p>Analytics is stored separately from the live Board. Clear Shift does not delete it.</p></div><button id="fzASync" class="fzAPrimary" type="button">SYNC TODAY • AM + PM</button></div><div class="fzAModes"><button data-fza-mode="daily" class="active">DAILY</button><button data-fza-mode="monthly">MONTHLY</button><button data-fza-mode="custom">CUSTOM RANGE</button></div><div class="fzAFilters"><div id="fzADailyFields"><label>DATE</label><input id="fzADay" type="date" value="'+escHtml(today)+'"></div><div id="fzAMonthlyFields" hidden><label>MONTH</label><input id="fzAMonth" type="month" value="'+escHtml(month)+'"></div><div id="fzACustomFields" hidden class="fzACustom"><div><label>FROM</label><input id="fzAFrom" type="date" value="'+escHtml(today)+'"></div><div><label>TO</label><input id="fzATo" type="date" value="'+escHtml(today)+'"></div></div><button id="fzARefresh" type="button">REFRESH ANALYSIS</button><button id="fzACsv" type="button">DOWNLOAD CSV</button></div><div id="fzAReport"></div></div>';
  document.querySelectorAll('[data-fza-mode]').forEach(b=>b.onclick=()=>setAnalyticsMode(b.dataset.fzaMode));
  document.getElementById('fzARefresh').onclick=renderAnalyticsReport;document.getElementById('fzADay').onchange=renderAnalyticsReport;document.getElementById('fzAMonth').onchange=renderAnalyticsReport;document.getElementById('fzAFrom').onchange=renderAnalyticsReport;document.getElementById('fzATo').onchange=renderAnalyticsReport;
  document.getElementById('fzASync').onclick=async()=>{const b=document.getElementById('fzASync');b.disabled=true;b.textContent='SYNCING…';try{await syncAnalyticsToday();await renderAnalyticsReport()}catch(e){toast((e&&e.message)||'Analytics Sync failed')}finally{b.disabled=false;b.textContent='SYNC TODAY • AM + PM'}};
  document.getElementById('fzACsv').onclick=()=>{const body=document.getElementById('fzAReport');if(body&&body._analytics&&body._range)downloadAnalyticsCsv(body._analytics,body._range);else toast('Refresh Analytics first')};
  quickSetOpen('quickLegacyPanel',true);renderAnalyticsReport();
}
function openShiftCorrection(){
  if(shiftCorrectionBusy||clearShiftInFlight)return toast('AN OPERATION IS STILL SAVING…');
  const source=shift(),target=source==='AM'?'PM':'AM',mount=quickPrepareLegacy('Correct Wrong AM / PM');
  const current=normalizeBoard(board||{}),barRows=current.rows.filter(r=>isBarSection(r.section)),barParties=barRows.reduce((n,r)=>n+r.turns.filter(t=>t&&!t.skipped&&t.table).length,0),barAuto=barRows.reduce((n,r)=>n+r.turns.filter(isBarAuto).length,0),allParties=current.rows.reduce((n,r)=>n+r.turns.filter(t=>t&&!t.skipped&&t.table).length,0);
  mount.innerHTML='<div class="fzShiftFix"><div class="fzShiftArrow"><span>'+escHtml(source)+'</span><b>→</b><span>'+escHtml(target)+'</span></div><div class="fzShiftFacts">'+metricCard('DATE',selectedDate())+metricCard('PARTIES',allParties)+metricCard('BAR PARTIES',barParties)+metricCard('CURRENT BAR AUTO',barAuto)+'</div><div class="fzShiftNote"><b>What this does</b><p>Moves the complete live Board/history to '+escHtml(target)+' without resetting table rotation. Manual SKIPs, server rows, Floor links, formation, assignments and active seated tables move with it.</p><p><b>BAR rule:</b> '+(target==='AM'?'all BAR PM AUTO SKIPs are removed.':'BAR AUTO SKIP is rebuilt automatically: every 2 actual BAR parties = 1 AUTO SKIP.')+'</p><p>If the '+escHtml(target)+' Board already has table/SKIP history, the operation stops instead of overwriting it.</p></div><div id="fzShiftProgress" class="fzShiftProgress">READY</div><button id="fzShiftConfirm" class="fzShiftConfirm" type="button">MOVE '+escHtml(source)+' HISTORY TO '+escHtml(target)+'</button></div>';
  document.getElementById('fzShiftConfirm').onclick=async()=>{if(!confirm('CORRECT SHIFT '+source+' → '+target+'?\n\nAll current history moves to '+target+'. Table rotation stays in the same chronological order.\n\nBAR AUTO SKIP rules will be rebuilt for '+target+'.'))return;const btn=document.getElementById('fzShiftConfirm'),p=document.getElementById('fzShiftProgress');btn.disabled=true;try{const result=await correctCurrentShift(target,msg=>{if(p)p.textContent=msg});if(p)p.textContent='COMPLETE • '+result.targetKey+' • BAR AUTO '+result.barAuto;setTimeout(()=>{try{quickCloseLegacy()}catch(_){}},500)}catch(e){if(p)p.textContent='STOPPED • '+((e&&e.message)||'Shift correction failed');toast((e&&e.message)||'Shift correction failed');btn.disabled=false}};
  quickSetOpen('quickLegacyPanel',true);
}
function injectStyles(){
  if(document.getElementById('fzShiftAnalyticsStyles'))return;const s=document.createElement('style');s.id='fzShiftAnalyticsStyles';s.textContent=`
.fzAnalytics{padding:12px 14px 40px;color:#eaf4fb}.fzAHead{display:flex;gap:12px;justify-content:space-between;align-items:center;margin-bottom:12px}.fzAHead h2{margin:0;font-size:25px}.fzAHead p{margin:4px 0 0;color:#9db6c9;font-size:11px;font-weight:800}.fzAPrimary,.fzARefresh,.fzAFilters button{min-height:44px;border:1px solid #45d483;border-radius:10px;background:#14864c;color:#fff;padding:0 13px;font-weight:1000}.fzAModes{display:flex;gap:6px;margin:8px 0}.fzAModes button{min-height:38px;border:1px solid #385c75;border-radius:9px;background:#0b2233;color:#b9cede;font-weight:1000;padding:0 12px}.fzAModes button.active{background:#2563eb;border-color:#7fb2ff;color:#fff}.fzAFilters{display:flex;align-items:end;gap:8px;flex-wrap:wrap;padding:10px;border:1px solid #2b4d64;border-radius:12px;background:#091a27}.fzAFilters label{display:block;color:#8fb0c8;font-size:9px;font-weight:1000;margin-bottom:4px}.fzAFilters input{height:40px;border:1px solid #45667d;border-radius:8px;background:#102b40;color:#fff;padding:0 9px;font-weight:900}.fzACustom{display:flex;gap:8px}.fzASummaryGrid,.fzShiftFacts{display:grid;grid-template-columns:repeat(4,minmax(120px,1fr));gap:8px;margin:12px 0}.fzAStat{min-height:84px;padding:10px;border:1px solid #31546a;border-radius:12px;background:linear-gradient(180deg,#102d42,#0a1c2a);display:flex;flex-direction:column;justify-content:center}.fzAStat small{color:#88a8bf;font-size:9px;font-weight:1000}.fzAStat strong{font-size:21px;line-height:24px;margin-top:4px;overflow-wrap:anywhere}.fzAStat span{color:#9fb8c9;font-size:9px;font-weight:800;margin-top:3px}.fzAConclusion{padding:13px;border:1px solid #42667d;border-radius:12px;background:#0d2638}.fzAConclusion h3,.fzASection h3{margin:0 0 8px;font-size:15px}.fzAConclusion p{margin:0;line-height:1.55;color:#d8e8f3;font-size:12px;font-weight:800}.fzASection{margin-top:12px;padding:12px;border:1px solid #2e5066;border-radius:12px;background:#091b29}.fzABars{display:grid;gap:7px}.fzABarRow{display:grid;grid-template-columns:minmax(145px,240px) 1fr;gap:9px;align-items:center}.fzABarLabel{display:flex;justify-content:space-between;gap:6px}.fzABarLabel b{font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.fzABarLabel span{font-size:9px;color:#91adbf;white-space:nowrap}.fzABarTrack{height:14px;border-radius:99px;background:#102b3e;overflow:hidden}.fzABarTrack i{display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,#2563eb,#2dd4bf)}.fzAHours{display:flex;gap:6px;align-items:end;overflow-x:auto;padding-top:8px}.fzAHour{min-width:55px;text-align:center;font-size:8px;color:#a7bfd0}.fzAHour>div{height:96px;display:flex;align-items:end;justify-content:center}.fzAHour i{display:block;width:24px;background:linear-gradient(180deg,#2dd4bf,#2563eb);border-radius:6px 6px 2px 2px}.fzAHour b{display:block;white-space:nowrap}.fzAHour span{font-weight:1000;color:#fff}.fzATableWrap{overflow:auto}.fzATable{width:100%;border-collapse:collapse;min-width:720px}.fzATable th,.fzATable td{padding:7px;border-bottom:1px solid #26485e;text-align:left;font-size:10px}.fzATable th{color:#9fc1d7}.fzAEmpty,.fzALoading,.fzAError{padding:18px;text-align:center;color:#9fb8c9;font-weight:900}.fzAError{color:#fecaca}.fzShiftFix{width:min(720px,100%);margin:0 auto;padding:20px}.fzShiftArrow{display:flex;align-items:center;justify-content:center;gap:20px;margin:5px 0 15px}.fzShiftArrow span{min-width:110px;text-align:center;padding:13px;border:2px solid #60a5fa;border-radius:13px;background:#102d49;font-size:30px;font-weight:1000}.fzShiftArrow b{font-size:31px;color:#facc15}.fzShiftNote{padding:14px;border:1px solid #42657c;border-radius:12px;background:#0a1d2c;color:#dbe9f2;font-size:12px;line-height:1.5}.fzShiftNote p{margin:8px 0}.fzShiftProgress{margin:12px 0;padding:10px;border:1px solid #34566d;border-radius:9px;text-align:center;color:#bae6fd;font-weight:1000}.fzShiftConfirm{width:100%;min-height:58px;border:1px solid #f59e0b;border-radius:12px;background:#9a4b08;color:#fff;font-size:16px;font-weight:1000}.fzShiftConfirm:disabled,.fzAPrimary:disabled{opacity:.45}
@media(max-width:700px){.fzAHead{align-items:stretch;flex-direction:column}.fzAPrimary{width:100%}.fzASummaryGrid,.fzShiftFacts{grid-template-columns:1fr 1fr}.fzABarRow{grid-template-columns:1fr}.fzABarLabel{min-width:0}.fzACustom{width:100%}.fzACustom>div{flex:1}.fzAFilters>div:not([hidden]){width:100%}.fzAFilters input{width:100%}.fzAFilters button{flex:1}.fzShiftFix{padding:10px}.fzShiftArrow span{min-width:90px;font-size:24px}}
`;
  document.head.appendChild(s);
}
function addMenuButton(grid,id,title,sub,className='quickMenuBtn'){
  if(document.getElementById(id)||!grid)return null;const b=document.createElement('button');b.id=id;b.className=className;b.type='button';b.innerHTML='<strong>'+title+'</strong><span>'+sub+'</span>';grid.appendChild(b);return b;
}
function install(){
  injectStyles();
  const shiftGrid=document.getElementById('quickFormation')&&document.getElementById('quickFormation').parentElement;const dataGrid=document.getElementById('quickReservations')&&document.getElementById('quickReservations').parentElement;
  const shiftBtn=addMenuButton(shiftGrid,'quickShiftCorrection','Correct Wrong AM / PM','All roles • move live history without resetting rotation');if(shiftBtn)shiftBtn.onclick=openShiftCorrection;
  const analyticsBtn=addMenuButton(dataGrid,'quickAnalytics','Analytics','Manager / Owner • Daily, Monthly, Custom Range','quickMenuBtn quickManagerOnly');if(analyticsBtn)analyticsBtn.onclick=openAnalytics;
  try{if(typeof quickApplyAccessVisibility==='function')quickApplyAccessVisibility()}catch(_){}
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();

})(typeof window!=='undefined'?window:globalThis);
