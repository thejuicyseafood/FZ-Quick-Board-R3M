/* FZ Quick Board R3M.8.36 — Weekly/Monthly Decision Intelligence • Larger Readable PDF Text */
(function(global){
'use strict';

const BUILD='R3M.8.36';
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
function buildWeekdayPatterns(records){
  const order=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'],map=new Map();
  const ensure=wd=>{if(!map.has(wd))map.set(wd,{weekday:wd,dates:new Set(),parties:0,guests:0,rotationTurns:0,hours:new Map()});return map.get(wd)};
  for(const rec of records||[]){
    if(!rec||!rec.date)continue;
    const date=text(rec.date),wd=weekdayForDate(date),events=snapshotEvents(rec);
    if(!wd||!events.length)continue;
    const x=ensure(wd);x.dates.add(date);
    for(const e of events){
      const people=safeInt(e.people,0),slots=Math.max(1,safeInt(e.rotationSlots,1));x.parties++;x.guests+=people;x.rotationTurns+=slots;
      const h=Number(e.hour);if(Number.isInteger(h)){if(!x.hours.has(h))x.hours.set(h,{hour:h,parties:0,guests:0});const hx=x.hours.get(h);hx.parties++;hx.guests+=people}
    }
  }
  return order.map(wd=>map.get(wd)).filter(Boolean).map(x=>{
    const hours=[...x.hours.values()].sort((a,b)=>a.hour-b.hour),peak=hours.slice().sort((a,b)=>safeInt(b.parties,0)-safeInt(a.parties,0)||safeInt(b.guests,0)-safeInt(a.guests,0)||safeInt(a.hour,0)-safeInt(b.hour,0))[0]||null,days=x.dates.size;
    return {weekday:x.weekday,recordedDays:days,parties:x.parties,guests:x.guests,rotationTurns:x.rotationTurns,avgTables:days?x.parties/days:0,avgGuests:days?x.guests/days:0,guestsPerTable:x.parties?x.guests/x.parties:0,peakHour:peak?peak.hour:null,peakHourParties:peak?safeInt(peak.parties,0):0,peakHourGuests:peak?safeInt(peak.guests,0):0,hours}
  })
}
function isMonthlyRange(range){
  if(!range||!range.from||!range.to)return false;if(range.mode==='monthly')return true;
  if(range.from.slice(0,7)!==range.to.slice(0,7)||!/-01$/.test(range.from))return false;
  const [y,m]=range.from.slice(0,7).split('-').map(Number),last=new Date(y,m,0).getDate();return range.to===range.from.slice(0,8)+pad2(last)
}
function analyticsReading(a,range){
  if(!a||!a.parties)return {overview:'No seating data is available for '+text(range&&range.label)+'.',demand:'No demand pattern can be calculated yet.',people:'No server comparison is available yet.',floor:'No table or section comparison is available yet.'};
  const srvTables=analyticsTop(a.servers,'parties'),srvGuests=analyticsTop(a.servers,'guests'),tbl=analyticsTop(a.tables),day=analyticsTop(a.dates),sec=analyticsTop(a.sections),rot=analyticsTop(a.servers,'rotationTurns'),hour=(a.hours||[]).slice().sort((x,y)=>safeInt(y.parties,0)-safeInt(x.parties,0)||safeInt(y.guests,0)-safeInt(x.guests,0))[0],sh=analyticsTop(a.shifts),patterns=(a.weekdayPatterns||[]).slice().sort((x,y)=>Number(y.avgTables||0)-Number(x.avgTables||0)||Number(y.avgGuests||0)-Number(x.avgGuests||0)),p=patterns[0];
  const overview='The period recorded '+a.parties+' tables/parties and '+a.guests+' guests, averaging '+a.avgParty.toFixed(1)+' guests per table/party.';
  let demand='';
  if(isMonthlyRange(range)&&p)demand=p.weekday+' had the highest average demand across '+p.recordedDays+' recorded '+p.weekday+(p.recordedDays===1?'':'s')+': '+p.avgTables.toFixed(1)+' tables and '+p.avgGuests.toFixed(1)+' guests per recorded day'+(Number.isInteger(p.peakHour)?', with the strongest '+p.weekday+' hour at '+formatHour(p.peakHour)+' ('+p.peakHourParties+' tables / '+p.peakHourGuests+' guests).':'.');
  else{const bits=[];if(day)bits.push('busiest date '+day.date+' ('+day.parties+' tables / '+day.guests+' guests)');if(hour)bits.push('peak recorded hour '+formatHour(Number(hour.hour))+' ('+hour.parties+' tables)');if(sh)bits.push('higher-volume shift '+sh.shift+' ('+sh.parties+' tables / '+sh.guests+' guests)');demand=bits.length?'Demand pattern: '+bits.join('; ')+'.':'Demand pattern is not available.'}
  const people=(srvTables?'Most tables: '+srvTables.server+' ('+srvTables.parties+' tables / '+srvTables.guests+' guests). ':'')+(srvGuests?'Most guests: '+srvGuests.server+' ('+srvGuests.guests+' guests across '+srvGuests.parties+' tables). ':'')+(rot?'Rotation leader: '+rot.server+' ('+rot.rotationTurns+' turns).':'');
  const floor=(tbl?'Most-used table: '+tbl.table+' ('+tbl.parties+' seatings / '+tbl.guests+' guests). ':'')+(sec?'Highest-volume section: '+sec.section+' ('+sec.parties+' tables / '+sec.guests+' guests).':'')+' Manual SKIPs: '+a.manualSkips+'; BAR AUTO SKIPs: '+a.barAutoSkips+'.';
  return {overview,demand,people,floor}
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
    servers:sort([...server.values()]),tables:sort([...table.values()]),sections:sort([...section.values()]),dates:sort([...date.values()]),weekdays:sort([...weekday.values()]),weekdayPatterns:buildWeekdayPatterns(records),hours:[...hour.values()].sort((a,b)=>a.hour-b.hour),shifts:sort([...shiftMap.values()])};
}
function isoDate(d){return d.toISOString().slice(0,10)}
function isoWeekValue(dateValue){
  const m=text(dateValue).match(/^(\d{4})-(\d{2})-(\d{2})$/),d=m?new Date(Date.UTC(+m[1],+m[2]-1,+m[3])):new Date();
  const day=d.getUTCDay()||7;d.setUTCDate(d.getUTCDate()+4-day);const year=d.getUTCFullYear(),yearStart=new Date(Date.UTC(year,0,1)),week=Math.ceil((((d-yearStart)/86400000)+1)/7);return year+'-W'+pad2(week)
}
function isoWeekRange(value){
  const m=text(value).match(/^(\d{4})-W(\d{2})$/);if(!m){const v=isoWeekValue(new Date().toISOString().slice(0,10));return isoWeekRange(v)}
  const year=+m[1],week=+m[2],jan4=new Date(Date.UTC(year,0,4)),jan4Day=jan4.getUTCDay()||7,monday=new Date(jan4);monday.setUTCDate(jan4.getUTCDate()-(jan4Day-1)+(week-1)*7);const sunday=new Date(monday);sunday.setUTCDate(monday.getUTCDate()+6);
  return {from:isoDate(monday),to:isoDate(sunday),label:value+' • '+isoDate(monday)+' → '+isoDate(sunday)}
}
function periodRange(mode,valueA,valueB){
  if(mode==='weekly')return isoWeekRange(valueA);
  if(mode==='monthly'){
    const month=/^\d{4}-\d{2}$/.test(valueA)?valueA:new Date().toISOString().slice(0,7),[y,m]=month.split('-').map(Number),last=new Date(y,m,0).getDate();
    return {from:month+'-01',to:month+'-'+pad2(last),label:month};
  }
  if(mode==='custom'){const a=valueA||'',b=valueB||a;return {from:a<=b?a:b,to:a<=b?b:a,label:(a<=b?a:b)+' → '+(a<=b?b:a)}}
  const d=valueA||new Date().toISOString().slice(0,10);return {from:d,to:d,label:d};
}
function datesInRange(range,maxDays=370){
  const out=[],a=new Date(range.from+'T12:00:00Z'),b=new Date(range.to+'T12:00:00Z');if(Number.isNaN(a.getTime())||Number.isNaN(b.getTime())||b<a)return out;
  for(let d=new Date(a);d<=b&&out.length<maxDays;d.setUTCDate(d.getUTCDate()+1))out.push(d.toISOString().slice(0,10));return out;
}
function formatHour(h){if(!Number.isInteger(h))return '—';const suffix=h>=12?'PM':'AM',n=h%12||12;return n+':00 '+suffix}


function normalizePdfLanguage(value){return /^(id|indo|indonesia)$/i.test(text(value).trim())?'id':'en'}
function pdfWeekdayName(name,lang='en'){
  if(normalizePdfLanguage(lang)!=='id')return text(name);
  return ({Monday:'Senin',Tuesday:'Selasa',Wednesday:'Rabu',Thursday:'Kamis',Friday:'Jumat',Saturday:'Sabtu',Sunday:'Minggu'})[text(name)]||text(name)
}
function analyticsExecutiveSummary(a,range,lang='en'){
  lang=normalizePdfLanguage(lang);const id=lang==='id',srvTables=analyticsTop(a&&a.servers,'parties'),srvGuests=analyticsTop(a&&a.servers,'guests'),tbl=analyticsTop(a&&a.tables),sec=analyticsTop(a&&a.sections),day=analyticsTop(a&&a.dates),rot=analyticsTop(a&&a.servers,'rotationTurns'),hour=(a&&a.hours||[]).slice().sort((x,y)=>safeInt(y.parties,0)-safeInt(x.parties,0)||safeInt(y.guests,0)-safeInt(x.guests,0))[0],patterns=(a&&a.weekdayPatterns||[]).slice().sort((x,y)=>Number(y.avgTables||0)-Number(x.avgTables||0)||Number(y.avgGuests||0)-Number(x.avgGuests||0)),pat=patterns[0];
  if(!a||!a.parties)return id?{
    overview:'Belum ada data seating yang tercatat untuk periode ini.',
    demand:'Pola hari dan jam ramai belum dapat dihitung.',
    servers:'Perbandingan kinerja server belum tersedia.',
    floor:'Penggunaan meja dan section belum dapat dibandingkan.',
    action:'Lakukan Sync setelah Board memiliki history seating agar Executive Summary dapat dibuat.',
    note:'Ringkasan hanya menggunakan data seating yang tercatat.'
  }:{overview:'No recorded seating data is available for this period.',demand:'Day and peak-hour patterns cannot be calculated yet.',servers:'Server performance cannot be compared yet.',floor:'Table and section usage cannot be compared yet.',action:'Run Sync after the Board has seating history so the Executive Summary can be generated.',note:'The summary uses recorded seating history only.'};
  const overview=id?('Pada periode '+range.from+(range.to!==range.from?' sampai '+range.to:'')+', tercatat '+a.parties+' meja/party dengan '+a.guests+' tamu. Rata-rata '+a.avgParty.toFixed(1)+' tamu per meja/party dan total '+a.rotationTurns+' rotation turns.'):
    ('From '+range.from+(range.to!==range.from?' through '+range.to:'')+', the Board recorded '+a.parties+' tables/parties and '+a.guests+' guests. Average party size was '+a.avgParty.toFixed(1)+' guests, with '+a.rotationTurns+' rotation turns.');
  let demand='';
  if(isMonthlyRange(range)&&pat){const wd=pdfWeekdayName(pat.weekday,lang);demand=id?(wd+' memiliki rata-rata demand tertinggi: '+pat.avgTables.toFixed(1)+' meja dan '+pat.avgGuests.toFixed(1)+' tamu per '+wd+' yang tercatat'+(Number.isInteger(pat.peakHour)?'. Jam terpadat pada '+wd+' adalah '+formatHour(pat.peakHour)+' dengan '+pat.peakHourParties+' meja dan '+pat.peakHourGuests+' tamu.':'.')):(pat.weekday+' had the highest average demand: '+pat.avgTables.toFixed(1)+' tables and '+pat.avgGuests.toFixed(1)+' guests per recorded '+pat.weekday+(Number.isInteger(pat.peakHour)?'. Its busiest hour was '+formatHour(pat.peakHour)+' with '+pat.peakHourParties+' tables and '+pat.peakHourGuests+' guests.':'.'))}
  else demand=id?('Tanggal teramai '+(day?day.date:'-')+(day?' dengan '+day.parties+' meja dan '+day.guests+' tamu':'')+(hour?'. Jam terpadat yang tercatat adalah '+formatHour(Number(hour.hour))+' dengan '+hour.parties+' meja dan '+hour.guests+' tamu.':'.')):('Busiest date: '+(day?day.date:'-')+(day?' with '+day.parties+' tables and '+day.guests+' guests':'')+(hour?'. The busiest recorded hour was '+formatHour(Number(hour.hour))+' with '+hour.parties+' tables and '+hour.guests+' guests.':'.'));
  const servers=id?((srvTables?srvTables.server+' melayani meja terbanyak: '+srvTables.parties+' meja dan '+srvTables.guests+' tamu. ':'')+(srvGuests?'Untuk jumlah tamu, '+srvGuests.server+' tertinggi dengan '+srvGuests.guests+' tamu dari '+srvGuests.parties+' meja. ':'')+(rot?'Rotation turns terbanyak: '+rot.server+' ('+rot.rotationTurns+').':'')):
    ((srvTables?srvTables.server+' served the most tables: '+srvTables.parties+' tables and '+srvTables.guests+' guests. ':'')+(srvGuests?srvGuests.server+' served the most guests: '+srvGuests.guests+' guests across '+srvGuests.parties+' tables. ':'')+(rot?'Rotation-turn leader: '+rot.server+' ('+rot.rotationTurns+').':''));
  const floor=id?((tbl?'Meja '+tbl.table+' paling sering dipakai dengan '+tbl.parties+' seating dan '+tbl.guests+' tamu. ':'')+(sec?'Section '+sec.section+' mencatat volume tertinggi dengan '+sec.parties+' meja dan '+sec.guests+' tamu.':'')+' Manual SKIP '+a.manualSkips+'; BAR AUTO SKIP '+a.barAutoSkips+'.'):
    ((tbl?'Table '+tbl.table+' was used most often with '+tbl.parties+' seatings and '+tbl.guests+' guests. ':'')+(sec?'Section '+sec.section+' carried the highest volume with '+sec.parties+' tables and '+sec.guests+' guests.':'')+' Manual SKIPs: '+a.manualSkips+'; BAR AUTO SKIPs: '+a.barAutoSkips+'.');
  const peakLabel=isMonthlyRange(range)&&pat&&Number.isInteger(pat.peakHour)?(pdfWeekdayName(pat.weekday,lang)+' '+formatHour(pat.peakHour)):(hour?formatHour(Number(hour.hour)):'waktu ramai yang tercatat');
  const action=id?('Tindakan: perkuat kesiapan server/floor sebelum '+peakLabel+'. Ranking meja dan jumlah tamu bisa memiliki leader yang berbeda.'):
    ('Action: strengthen server/floor readiness before '+peakLabel+'. Table and guest rankings may have different leaders.');
  const note=id?'Catatan: rata-rata pola weekday hanya memakai tanggal yang memiliki history seating; tanggal tanpa data tidak dianggap nol.':'Note: weekday averages use only dates with recorded seating history; missing dates are not treated as zero.';
  return {overview,demand,servers,floor,action,note}
}
function analyticsPdfLabels(lang='en'){
  const id=normalizePdfLanguage(lang)==='id';return id?{
    summary:'RINGKASAN EKSEKUTIF',summarySub:'Penjelasan sederhana untuk membaca data operasional',activity:'1. RINGKASAN AKTIVITAS',demand:'2. KAPAN PALING RAMAI',servers:'3. KINERJA SERVER',floor:'4. FLOOR & ARAH TINDAKAN',
    serverPerf:'KINERJA SERVER',serverPerfSub:'Ranking meja terlayani dan tamu terlayani dibaca terpisah',topTables:'SERVER TERATAS - MEJA TERLAYANI',topGuests:'SERVER TERATAS - TAMU TERLAYANI',mostTables:'MEJA TERBANYAK',mostGuests:'TAMU TERBANYAK',rotationLeader:'ROTASI TERBANYAK',
    tableUse:'PENGGUNAAN MEJA & SECTION',tableUseSub:'Melihat area tempat volume seating terkonsentrasi',mostUsed:'MEJA PALING SERING DIPAKAI',sectionLoad:'BEBAN SECTION',largestParty:'PARTY TERBESAR',
    traffic:'ANALISIS TRAFIK',trafficSub:'Daily / weekly / monthly menggabungkan AM + PM',partiesHour:'MEJA/PARTY PER JAM',partiesDate:'MEJA/PARTY PER TANGGAL',weekdayPattern:'POLA HARI BULANAN - RATA-RATA PER HARI TERCATAT',highestWeekday:'RATA-RATA HARI TERTINGGI',peakOn:'JAM TERPADAT - ',weekdayShift:'POLA WEEKDAY / SHIFT',busiestWeekday:'WEEKDAY TERAMAI',peakHour:'JAM TERPADAT',
    conclusion:'KESIMPULAN MANAJEMEN',conclusionSub:'Cara baca akhir: apa yang terjadi, kapan, siapa, dan dimana',what:'1. APA YANG TERJADI',when:'2. KAPAN DEMAND TERKUAT',who:'3. SERVER / ROTASI',where:'4. FLOOR / CONTROL',period:'Periode',page:'Halaman',generated:'Dibuat',tables:'MEJA / PARTY',guests:'TAMU',avgParty:'RATA-RATA PARTY',rotation:'ROTASI',manualSkip:'MANUAL SKIP',barAuto:'BAR AUTO',recorded:'history tercatat'
  }:{
    summary:'EXECUTIVE SUMMARY',summarySub:'Simple-language management reading of the operating data',activity:'1. ACTIVITY SUMMARY',demand:'2. WHEN DEMAND WAS STRONGEST',servers:'3. SERVER PERFORMANCE',floor:'4. FLOOR & ACTION READING',
    serverPerf:'SERVER PERFORMANCE',serverPerfSub:'Separate ranking by tables served vs guests served',topTables:'TOP SERVERS BY TABLES SERVED',topGuests:'TOP SERVERS BY GUESTS SERVED',mostTables:'MOST TABLES',mostGuests:'MOST GUESTS',rotationLeader:'ROTATION LEADER',
    tableUse:'TABLE & SECTION UTILIZATION',tableUseSub:'Where seating volume is concentrated',mostUsed:'MOST-USED TABLES',sectionLoad:'SECTION LOAD',largestParty:'LARGEST PARTY',
    traffic:'TRAFFIC INTELLIGENCE',trafficSub:'Daily / weekly / monthly AM + PM combined',partiesHour:'PARTIES BY HOUR',partiesDate:'PARTIES BY DATE',weekdayPattern:'MONTHLY WEEKDAY PATTERN - AVERAGE PER RECORDED DAY',highestWeekday:'HIGHEST AVERAGE WEEKDAY',peakOn:'PEAK HOUR ON ',weekdayShift:'WEEKDAY / SHIFT MIX',busiestWeekday:'BUSIEST WEEKDAY',peakHour:'PEAK HOUR',
    conclusion:'MANAGEMENT CONCLUSION',conclusionSub:'Guided reading: what happened, when, who, and where',what:'1. WHAT HAPPENED',when:'2. WHEN DEMAND WAS STRONGEST',who:'3. SERVER / ROTATION READING',where:'4. FLOOR / CONTROL READING',period:'Period',page:'Page',generated:'Generated',tables:'TABLES / PARTIES',guests:'GUESTS',avgParty:'AVG PARTY',rotation:'ROTATION',manualSkip:'MANUAL SKIP',barAuto:'BAR AUTO',recorded:'recorded history'
  }
}
function analyticsTop(arr,key='parties'){return arr&&arr.length?arr.slice().sort((a,b)=>safeInt(b[key],0)-safeInt(a[key],0)||safeInt(b.guests,0)-safeInt(a.guests,0))[0]:null}
function analyticsPdfAscii(value){return text(value).normalize('NFKD').replace(/[^\x20-\x7E]/g,'').replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)')}
function pdfRgb(hex){const h=text(hex).replace('#','').padEnd(6,'0').slice(0,6);return [parseInt(h.slice(0,2),16)/255,parseInt(h.slice(2,4),16)/255,parseInt(h.slice(4,6),16)/255].map(n=>Number.isFinite(n)?n:0)}
function pdfWrapWords(value,maxChars){const words=text(value).normalize('NFKD').replace(/[^\x20-\x7E]/g,'').split(/\s+/).filter(Boolean),lines=[];let line='';for(const w of words){const next=line?line+' '+w:w;if(next.length>maxChars&&line){lines.push(line);line=w}else line=next}if(line)lines.push(line);return lines}
function analyticsRecordedDayStats(a){
  const days=(a&&a.dates||[]).filter(x=>safeInt(x.parties,0)>0).map(x=>({date:text(x.date),parties:safeInt(x.parties,0),guests:safeInt(x.guests,0)})).sort((x,y)=>x.date.localeCompare(y.date));
  const count=days.length,totalTables=days.reduce((s,x)=>s+x.parties,0),totalGuests=days.reduce((s,x)=>s+x.guests,0),rank=days.slice().sort((x,y)=>y.parties-x.parties||y.guests-x.guests||x.date.localeCompare(y.date)),slow=days.slice().sort((x,y)=>x.parties-y.parties||x.guests-y.guests||x.date.localeCompare(y.date));
  return {days,count,avgTables:count?totalTables/count:0,avgGuests:count?totalGuests/count:0,busiest:rank[0]||null,slowest:slow[0]||null}
}
function analyticsHourlyAverages(a){
  const dayCount=Math.max(1,analyticsRecordedDayStats(a).count),hours=(a&&a.hours||[]).filter(x=>safeInt(x.parties,0)>0).map(x=>({hour:Number(x.hour),parties:safeInt(x.parties,0),guests:safeInt(x.guests,0),avgTables:safeInt(x.parties,0)/dayCount,avgGuests:safeInt(x.guests,0)/dayCount})).sort((x,y)=>x.hour-y.hour);
  const peak=hours.slice().sort((x,y)=>y.avgTables-x.avgTables||y.avgGuests-x.avgGuests||x.hour-y.hour)[0]||null,slow=hours.slice().sort((x,y)=>x.avgTables-y.avgTables||x.avgGuests-y.avgGuests||x.hour-y.hour)[0]||null;
  return {hours,dayCount,peak,slow}
}
function analyticsWeekdayHourProfiles(a){
  return (a&&a.weekdayPatterns||[]).map(x=>{
    const days=Math.max(1,safeInt(x.recordedDays,0)),hours=(x.hours||[]).filter(h=>safeInt(h.parties,0)>0).map(h=>({hour:Number(h.hour),parties:safeInt(h.parties,0),guests:safeInt(h.guests,0),avgTables:safeInt(h.parties,0)/days,avgGuests:safeInt(h.guests,0)/days}));
    const peak=hours.slice().sort((m,n)=>n.avgTables-m.avgTables||n.avgGuests-m.avgGuests||m.hour-n.hour)[0]||null,slow=hours.slice().sort((m,n)=>m.avgTables-n.avgTables||m.avgGuests-n.avgGuests||m.hour-n.hour)[0]||null;
    return {...x,peakAverage:peak,slowAverage:slow}
  })
}
function analyticsDecisionReading(a,range,lang='en'){
  lang=normalizePdfLanguage(lang);const id=lang==='id',days=analyticsRecordedDayStats(a),hours=analyticsHourlyAverages(a),profiles=analyticsWeekdayHourProfiles(a),patterns=(a&&a.weekdayPatterns||[]).slice().sort((x,y)=>Number(y.avgTables||0)-Number(x.avgTables||0)||Number(y.avgGuests||0)-Number(x.avgGuests||0)),peakWd=patterns[0]||null,slowWd=patterns.length?patterns[patterns.length-1]:null,topTables=analyticsTop(a&&a.servers,'parties'),topGuests=analyticsTop(a&&a.servers,'guests'),topRot=analyticsTop(a&&a.servers,'rotationTurns'),topSec=analyticsTop(a&&a.sections),topTable=analyticsTop(a&&a.tables);
  const mode=text(range&&range.mode||'');
  const peakDay=(mode==='monthly'&&peakWd)?(pdfWeekdayName(peakWd.weekday,lang)+' '+peakWd.avgTables.toFixed(1)+' '+(id?'meja':'tables')+' / '+peakWd.avgGuests.toFixed(1)+' '+(id?'tamu':'guests')):(days.busiest?(days.busiest.date+' '+days.busiest.parties+' '+(id?'meja':'tables')+' / '+days.busiest.guests+' '+(id?'tamu':'guests')):'-');
  const slowDay=(mode==='monthly'&&slowWd)?(pdfWeekdayName(slowWd.weekday,lang)+' '+slowWd.avgTables.toFixed(1)+' '+(id?'meja':'tables')+' / '+slowWd.avgGuests.toFixed(1)+' '+(id?'tamu':'guests')):(days.slowest?(days.slowest.date+' '+days.slowest.parties+' '+(id?'meja':'tables')+' / '+days.slowest.guests+' '+(id?'tamu':'guests')):'-');
  const peakHour=hours.peak?(formatHour(hours.peak.hour)+' '+hours.peak.avgTables.toFixed(1)+' '+(id?'meja/hari':'tables/day')+' / '+hours.peak.avgGuests.toFixed(1)+' '+(id?'tamu/hari':'guests/day')):'-';
  const slowHour=hours.slow?(formatHour(hours.slow.hour)+' '+hours.slow.avgTables.toFixed(1)+' '+(id?'meja/hari':'tables/day')+' / '+hours.slow.avgGuests.toFixed(1)+' '+(id?'tamu/hari':'guests/day')):'-';
  const staffing=id?('Perkuat jumlah server/floor 30-60 menit sebelum '+(hours.peak?formatHour(hours.peak.hour):'jam puncak')+'. '+(hours.slow?'Gunakan sekitar '+formatHour(hours.slow.hour)+' sebagai kandidat waktu break/cut hanya jika kondisi live, reservasi, dan daftar tunggu memungkinkan.':'') ):
    ('Strengthen coverage 30-60 minutes before '+(hours.peak?formatHour(hours.peak.hour):'the peak window')+'. '+(hours.slow?'Treat around '+formatHour(hours.slow.hour)+' as a break/cut candidate only when live demand, reservations, and the waiting list allow it.':''));
  const server=id?((topTables?topTables.server+' memimpin jumlah meja. ':'')+(topGuests?topGuests.server+' memimpin jumlah tamu. ':'')+(topRot?topRot.server+' memiliki rotation turns terbanyak. ':'')+'Gunakan ketiga angka bersama; jumlah meja saja tidak cukup untuk menilai beban kerja.'):
    ((topTables?topTables.server+' leads tables served. ':'')+(topGuests?topGuests.server+' leads guests served. ':'')+(topRot?topRot.server+' has the most rotation turns. ':'')+'Read all three together; table count alone is not enough to judge workload.');
  const floor=id?((topSec?'Section '+topSec.section+' membawa volume terbesar. ':'')+(topTable?'Meja '+topTable.table+' paling sering digunakan. ':'')+'Prioritaskan readiness, cleaning, dan coverage di area tersebut sebelum periode ramai.'):
    ((topSec?'Section '+topSec.section+' carries the highest volume. ':'')+(topTable?'Table '+topTable.table+' is used most often. ':'')+'Prioritize readiness, cleaning, and coverage there before the busy period.');
  const planning=id?('Pola terkuat: '+peakDay+'. Pola paling lambat: '+slowDay+'. Rata-rata per hari tercatat: '+days.avgTables.toFixed(1)+' meja dan '+days.avgGuests.toFixed(1)+' tamu.'):
    ('Strongest day pattern: '+peakDay+'. Slowest day pattern: '+slowDay+'. Average recorded day: '+days.avgTables.toFixed(1)+' tables and '+days.avgGuests.toFixed(1)+' guests.');
  return {days,hours,profiles,peakDay,slowDay,peakHour,slowHour,staffing,server,floor,planning}
}
function buildAnalyticsPdf5D(a,range,generatedAt=Date.now(),language='en'){
  const lang=normalizePdfLanguage(language),L=analyticsPdfLabels(lang),id=lang==='id',W=792,H=612,pages=[],mode=text(range&&range.mode||''),monthly=mode==='monthly'||isMonthlyRange(range),weekly=mode==='weekly';
  const C={bg:'#071522',panel:'#0c2537',panel2:'#11334a',cyan:'#2dd4bf',blue:'#3b82f6',purple:'#8b5cf6',pink:'#ec4899',gold:'#f59e0b',white:'#f8fbff',muted:'#9db6c9',line:'#24495f',green:'#22c55e',red:'#ef4444'};
  const rgb=h=>pdfRgb(h).join(' '),fill=h=>rgb(h)+' rg\n',stroke=h=>rgb(h)+' RG\n';
  const pdfFontSize=size=>{const n=Number(size)||7;const scale=n<=7?1.28:n<=9?1.24:n<=14?1.18:1.12;return Math.round(n*scale*10)/10};
  const txt=(x,y,size,value,bold=false,color=C.white)=>fill(color)+'BT /'+(bold?'F2':'F1')+' '+pdfFontSize(size)+' Tf '+x+' '+y+' Td ('+analyticsPdfAscii(value)+') Tj ET\n';
  const rect=(x,y,w,h,color,strokeColor='')=>fill(color)+(strokeColor?stroke(strokeColor)+'0.7 w\n':'')+x+' '+y+' '+w+' '+h+' re '+(strokeColor?'B':'f')+'\n';
  const line=(x1,y1,x2,y2,color=C.line,width=1)=>stroke(color)+width+' w\n'+x1+' '+y1+' m '+x2+' '+y2+' l S\n';
  const poly=(pts,color)=>fill(color)+pts.map((p,i)=>(i?p[0]+' '+p[1]+' l':p[0]+' '+p[1]+' m')).join(' ')+' h f\n';
  const bar3d=(x,y,w,h,pct,front=C.blue,side='#1e40af')=>{const bw=Math.max(2,w*Math.max(0,Math.min(1,pct))),d=4;let q=rect(x+3,y-3,w,h,'#04111d')+rect(x,y,w,h,'#10283a');q+=rect(x,y,bw,h,front);if(bw>8)q+=poly([[x+bw,y],[x+bw+d,y+d],[x+bw+d,y+h+d],[x+bw,y+h]],side)+poly([[x,y+h],[x+d,y+h+d],[x+bw+d,y+h+d],[x+bw,y+h]],'#67e8f9');return q};
  const card=(x,y,w,h,title,value,sub,accent=C.cyan)=>{const compact=h<=54,v=analyticsPdfAscii(value),vSize=compact?(v.length>22?8:v.length>15?10:v.length>10?12:14):(v.length>20?12:v.length>14?15:18);let q=rect(x+4,y-4,w,h,'#03101a')+rect(x,y,w,h,C.panel2,C.line)+rect(x,y+h-4,w,4,accent);q+=txt(x+11,y+h-(compact?13:18),compact?6.5:7.3,title,true,C.muted)+txt(x+11,y+(compact?16:26),vSize,value,true,C.white);if(sub)q+=txt(x+11,y+(compact?6:10),compact?5.5:6.5,sub,false,C.muted);return q};
  const totalPages=monthly?8:(weekly?6:5);
  const pageBase=(title,sub,pageNo)=>{let q=rect(0,0,W,H,C.bg);q+=rect(0,H-64,W,64,'#091d2c')+rect(0,H-5,W,5,C.cyan);q+=txt(28,H-34,17,title,true,C.white)+txt(28,H-50,7.5,sub,false,C.muted);q+=txt(W-164,H-34,7.5,'FZ QUICK BOARD',true,C.cyan)+txt(W-164,H-49,6.6,'5D EXECUTIVE ANALYTICS',true,C.white);q+=line(24,28,W-24,28,C.line,.7)+txt(28,14,6.5,L.period+': '+range.from+(range.to!==range.from?' - '+range.to:''),false,C.muted)+txt(W-122,14,6.5,L.page+' '+pageNo+'/'+totalPages,false,C.muted);return q};
  const textBlock=(x,y,w,h,title,body,accent=C.cyan,maxChars=56,maxLines=7)=>{let q=rect(x+4,y-4,w,h,'#03101a')+rect(x,y,w,h,C.panel2,C.line)+rect(x,y+h-4,w,4,accent)+txt(x+12,y+h-20,7.5,title,true,accent);const wrapChars=Math.max(30,Math.floor(maxChars*0.92));pdfWrapWords(body,wrapChars).slice(0,maxLines).forEach((ln,i)=>q+=txt(x+12,y+h-39-i*13.2,7,ln,false,C.white));return q};
  const hbarRows=(items,x,y,w,rowH,labelFn,valueFn,maxFn,accent=C.cyan,maxRows=12)=>{let q='',rows=(items||[]).slice(0,maxRows),max=Math.max(1,...rows.map(maxFn));rows.forEach((it,i)=>{const yy=y-i*rowH;q+=txt(x,yy+10,7,labelFn(it,i),true,C.white)+bar3d(x+126,yy+2,w-210,8,maxFn(it)/max,i<3?accent:C.blue,i<3?(accent===C.gold?'#92400e':accent===C.purple?'#6d28d9':'#0f766e'):'#1e40af')+txt(x+w-76,yy+4,6.6,valueFn(it),true,C.white)});return q};
  const twoColRows=(items,titleA,titleB,rowFn,startY=476,rowH=24)=>{let q=txt(28,510,7.2,titleA,true,C.cyan)+txt(410,510,7.2,titleB,true,C.purple),mid=Math.ceil(items.length/2);items.slice(0,mid).forEach((it,i)=>q+=rowFn(it,i,28,startY-i*rowH,C.cyan));items.slice(mid).forEach((it,i)=>q+=rowFn(it,i+mid,410,startY-i*rowH,C.purple));return q};
  const summary=analyticsExecutiveSummary(a,range,lang),decision=analyticsDecisionReading(a,range,lang),days=decision.days,hours=decision.hours,profiles=decision.profiles;
  const topServerTables=analyticsTop(a.servers,'parties'),topServerGuests=analyticsTop(a.servers,'guests'),topTable=analyticsTop(a.tables),topRotation=analyticsTop(a.servers,'rotationTurns'),topSection=analyticsTop(a.sections);

  let p=pageBase(L.summary,L.summarySub,1);p+=txt(28,519,7,L.generated+' '+new Date(generatedAt).toLocaleString(id?'id-ID':'en-US'),false,C.muted);
  [[L.tables,String(a.parties),id?'total seating':'served parties',C.cyan],[L.guests,String(a.guests),id?'total tamu':'total guests',C.blue],[L.avgParty,a.parties?a.avgParty.toFixed(1):'0',id?'tamu per meja':'guests / party',C.purple],[L.rotation,String(a.rotationTurns),id?'Board turns':'Board turns',C.pink]].forEach((c,i)=>p+=card(28+i*186,454,168,56,c[0],c[1],c[2],c[3]));
  p+=textBlock(28,304,354,122,L.activity,summary.overview,C.cyan,51,7)+textBlock(410,304,354,122,L.demand,summary.demand,C.gold,51,7)+textBlock(28,142,354,132,L.servers,summary.servers,C.purple,51,8)+textBlock(410,142,354,132,L.floor,summary.floor+' '+summary.action,C.blue,51,8)+txt(32,48,6.4,summary.note,true,C.muted);pages.push(p);

  const serverPage=(pageNo)=>{let q=pageBase(L.serverPerf,L.serverPerfSub,pageNo),byTables=(a.servers||[]).slice().sort((x,y)=>safeInt(y.parties,0)-safeInt(x.parties,0)||safeInt(y.guests,0)-safeInt(x.guests,0)).slice(0,8),byGuests=(a.servers||[]).slice().sort((x,y)=>safeInt(y.guests,0)-safeInt(x.guests,0)||safeInt(y.parties,0)-safeInt(x.parties,0)).slice(0,8),tm=Math.max(1,...byTables.map(x=>safeInt(x.parties,0))),gm=Math.max(1,...byGuests.map(x=>safeInt(x.guests,0)));q+=txt(28,516,8.5,L.topTables,true,C.cyan)+txt(410,516,8.5,L.topGuests,true,C.purple);byTables.forEach((x,i)=>{const y=482-i*42;q+=txt(30,y+16,7.1,(i+1)+'. '+text(x.server).slice(0,23),true,C.white)+bar3d(30,y,245,8,safeInt(x.parties,0)/tm,i<3?C.cyan:C.blue,i<3?'#0f766e':'#1e40af')+txt(285,y+1,7,x.parties+' '+(id?'meja':'tables'),true,C.white)});byGuests.forEach((x,i)=>{const y=482-i*42;q+=txt(412,y+16,7.1,(i+1)+'. '+text(x.server).slice(0,23),true,C.white)+bar3d(412,y,245,8,safeInt(x.guests,0)/gm,i<3?C.purple:C.blue,i<3?'#6d28d9':'#1e40af')+txt(667,y+1,7,x.guests+' '+(id?'tamu':'guests'),true,C.white)});q+=card(28,58,226,54,L.mostTables,topServerTables?text(topServerTables.server):'-',topServerTables?(topServerTables.parties+' '+(id?'meja / ':'tables / ')+topServerTables.guests+' '+(id?'tamu':'guests')):'',C.cyan)+card(276,58,226,54,L.mostGuests,topServerGuests?text(topServerGuests.server):'-',topServerGuests?(topServerGuests.guests+' '+(id?'tamu / ':'guests / ')+topServerGuests.parties+' '+(id?'meja':'tables')):'',C.purple)+card(524,58,240,54,L.rotationLeader,topRotation?text(topRotation.server):'-',topRotation?(topRotation.rotationTurns+' Board turns'):'',C.pink);return q};
  const floorPage=(pageNo)=>{let q=pageBase(L.tableUse,L.tableUseSub,pageNo),tables=(a.tables||[]).slice(0,12),tmax=Math.max(1,...tables.map(x=>safeInt(x.parties,0)));q+=txt(28,516,8.5,L.mostUsed,true,C.cyan);tables.forEach((x,i)=>{const y=486-i*31;q+=txt(30,y+4,7.2,(i+1)+'. '+text(x.table),true,C.white)+bar3d(108,y,300,8,safeInt(x.parties,0)/tmax,i<3?C.purple:C.blue,i<3?'#6d28d9':'#1e40af')+txt(420,y+2,7,x.parties+' '+(id?'pakai':'uses'),true,C.white)+txt(478,y+2,6.4,x.guests+' '+(id?'tamu':'guests'),false,C.muted)});const secs=(a.sections||[]).slice(0,8),sm=Math.max(1,...secs.map(x=>safeInt(x.parties,0)));q+=txt(560,516,8.5,L.sectionLoad,true,C.gold);secs.forEach((x,i)=>{const y=480-i*44;q+=txt(560,y+13,7.2,text(x.section).slice(0,16),true,C.white)+bar3d(560,y,150,8,safeInt(x.parties,0)/sm,C.gold,'#92400e')+txt(720,y+1,6.8,x.parties+' T',true,C.white)});q+=card(560,80,204,58,L.largestParty,a.largest?String(safeInt(a.largest.people,0)):'-',a.largest?(text(a.largest.table)+' / '+text(a.largest.server)):'',C.pink);return q};
  const dayAnalysisPage=(pageNo,title)=>{let q=pageBase(title,id?'Analisa hari: rata-rata, paling ramai, dan paling lambat':'Day analysis: average, busiest, and slowest',pageNo),list=days.days,avgMax=Math.max(1,...list.map(x=>x.parties));q+=txt(28,516,8.5,id?'VOLUME PER HARI TERCATAT':'RECORDED DAY VOLUME',true,C.cyan);q+=hbarRows(list,30,480,720,34,x=>x.date,x=>x.parties+' '+(id?'meja / ':'tables / ')+x.guests+' '+(id?'tamu':'guests'),x=>x.parties,C.cyan,10);q+=card(28,82,230,64,id?'RATA-RATA HARI':'AVERAGE RECORDED DAY',days.avgTables.toFixed(1)+' '+(id?'meja':'tables'),days.avgGuests.toFixed(1)+' '+(id?'tamu':'guests'),C.blue)+card(280,82,230,64,id?'HARI PALING RAMAI':'BUSIEST DAY',days.busiest?days.busiest.date:'-',days.busiest?(days.busiest.parties+' '+(id?'meja / ':'tables / ')+days.busiest.guests+' '+(id?'tamu':'guests')):'',C.pink)+card(532,82,232,64,id?'HARI PALING LAMBAT':'SLOWEST DAY',days.slowest?days.slowest.date:'-',days.slowest?(days.slowest.parties+' '+(id?'meja / ':'tables / ')+days.slowest.guests+' '+(id?'tamu':'guests')):'',C.gold);return q};
  const hourAnalysisPage=(pageNo,title)=>{let q=pageBase(title,id?'Rata-rata per jam dihitung terhadap hari yang memiliki history seating':'Hourly averages use recorded seating days as the denominator',pageNo),list=hours.hours,hm=Math.max(1,...list.map(x=>x.avgTables));q+=txt(28,530,8.5,id?'RATA-RATA TRAFIK PER JAM':'AVERAGE TRAFFIC BY HOUR',true,C.cyan);const row=(it,i,x,y,accent)=>txt(x,y+10,7,formatHour(it.hour),true,C.white)+bar3d(x+78,y+2,210,8,it.avgTables/hm,accent,accent===C.purple?'#6d28d9':'#0f766e')+txt(x+300,y+3,6.5,it.avgTables.toFixed(1)+' T / '+it.avgGuests.toFixed(1)+' G',true,C.white);const mid=Math.ceil(list.length/2),rh=Math.min(30,Math.max(22,255/Math.max(1,mid-1)));q+=twoColRows(list,id?'JAM AKTIF':'ACTIVE HOURS',id?'LANJUTAN':'CONTINUED',row,476,rh);q+=card(28,92,230,66,id?'RATA-RATA JAM TERAMAI':'BUSIEST AVERAGE HOUR',hours.peak?formatHour(hours.peak.hour):'-',hours.peak?(hours.peak.avgTables.toFixed(1)+' '+(id?'meja/hari / ':'tables/day / ')+hours.peak.avgGuests.toFixed(1)+' '+(id?'tamu/hari':'guests/day')):'',C.pink)+card(280,92,230,66,id?'RATA-RATA JAM TERLAMBAT':'SLOWEST ACTIVE HOUR',hours.slow?formatHour(hours.slow.hour):'-',hours.slow?(hours.slow.avgTables.toFixed(1)+' '+(id?'meja/hari / ':'tables/day / ')+hours.slow.avgGuests.toFixed(1)+' '+(id?'tamu/hari':'guests/day')):'',C.gold)+card(532,92,232,66,id?'HARI TERCATAT':'RECORDED DAYS',String(days.count),id?'tanggal dengan seating history':'dates with seating history',C.blue);return q};
  const weekdayAnalysisPage=(pageNo)=>{let q=pageBase(id?'ANALISA HARI DALAM BULAN':'MONTHLY WEEKDAY INTELLIGENCE',id?'Rata-rata setiap Senin-Minggu, bukan hanya total bulanan':'Average Monday-Sunday demand, not only monthly totals',pageNo),pats=(a.weekdayPatterns||[]).slice(),pm=Math.max(1,...pats.map(x=>Number(x.avgTables)||0));q+=txt(28,516,8.5,id?'RATA-RATA PER WEEKDAY':'AVERAGE BY WEEKDAY',true,C.cyan);pats.forEach((x,i)=>{const y=482-i*47;q+=txt(30,y+16,7.5,pdfWeekdayName(x.weekday,lang),true,C.white)+bar3d(120,y+5,300,9,(Number(x.avgTables)||0)/pm,i<2?C.cyan:C.blue,i<2?'#0f766e':'#1e40af')+txt(434,y+5,7,x.avgTables.toFixed(1)+' T / '+x.avgGuests.toFixed(1)+' G',true,C.white)+txt(560,y+5,6.5,x.recordedDays+' '+(id?'hari':'days'),false,C.muted)});const sorted=pats.slice().sort((x,y)=>Number(y.avgTables||0)-Number(x.avgTables||0)||Number(y.avgGuests||0)-Number(x.avgGuests||0)),hi=sorted[0],lo=sorted[sorted.length-1];q+=card(28,72,230,66,id?'RATA-RATA WEEKDAY':'AVERAGE RECORDED DAY',days.avgTables.toFixed(1)+' '+(id?'meja':'tables'),days.avgGuests.toFixed(1)+' '+(id?'tamu':'guests'),C.blue)+card(280,72,230,66,id?'WEEKDAY PALING RAMAI':'BUSIEST AVG WEEKDAY',hi?pdfWeekdayName(hi.weekday,lang):'-',hi?(hi.avgTables.toFixed(1)+' T / '+hi.avgGuests.toFixed(1)+' G'):'',C.pink)+card(532,72,232,66,id?'WEEKDAY PALING LAMBAT':'SLOWEST AVG WEEKDAY',lo?pdfWeekdayName(lo.weekday,lang):'-',lo?(lo.avgTables.toFixed(1)+' T / '+lo.avgGuests.toFixed(1)+' G'):'',C.gold);return q};
  const weekdayHourPage=(pageNo)=>{let q=pageBase(id?'POLA JAM PER HARI':'WEEKDAY PEAK & SLOW HOURS',id?'Jam teramai dan jam aktif paling lambat untuk setiap weekday':'Busiest and slowest active hour for each weekday',pageNo);q+=txt(28,516,7.2,id?'WEEKDAY':'WEEKDAY',true,C.muted)+txt(150,516,7.2,id?'HARI TERCATAT':'DAYS',true,C.muted)+txt(230,516,7.2,id?'JAM TERAMAI - RATA2':'BUSIEST HOUR - AVG',true,C.muted)+txt(480,516,7.2,id?'JAM TERLAMBAT - RATA2':'SLOWEST ACTIVE HOUR - AVG',true,C.muted);profiles.forEach((x,i)=>{const y=480-i*53;q+=rect(28,y-8,736,42,i%2?C.panel:C.panel2,C.line)+txt(40,y+9,8,pdfWeekdayName(x.weekday,lang),true,C.white)+txt(160,y+9,7,String(x.recordedDays),true,C.white)+txt(230,y+9,7,x.peakAverage?formatHour(x.peakAverage.hour):'-',true,C.cyan)+txt(324,y+9,6.5,x.peakAverage?(x.peakAverage.avgTables.toFixed(1)+' T / '+x.peakAverage.avgGuests.toFixed(1)+' G'):'-',false,C.white)+txt(480,y+9,7,x.slowAverage?formatHour(x.slowAverage.hour):'-',true,C.gold)+txt(574,y+9,6.5,x.slowAverage?(x.slowAverage.avgTables.toFixed(1)+' T / '+x.slowAverage.avgGuests.toFixed(1)+' G'):'-',false,C.white)});q+=txt(28,82,7,id?'Catatan: jam lambat hanya dibandingkan di jam yang pernah memiliki seating; ini bukan berarti jam kosong = nol.':'Note: slow hours compare active hours only; an unrecorded hour is not automatically treated as zero.',true,C.muted);return q};
  const trendPage=(pageNo)=>{let q=pageBase(id?'TREN TRAFIK HARIAN':'DAILY TRAFFIC TREND',id?'Semua tanggal tercatat dalam bulan, AM + PM digabung':'All recorded dates in the month, AM + PM combined',pageNo),list=days.days,dm=Math.max(1,...list.map(x=>x.parties));q+=txt(28,530,8.5,id?'TANGGAL / MEJA / TAMU':'DATE / TABLES / GUESTS',true,C.cyan);const row=(it,i,x,y,accent)=>txt(x,y+9,6.7,it.date.slice(5),true,C.white)+bar3d(x+48,y+2,190,8,it.parties/dm,accent,accent===C.purple?'#6d28d9':'#0f766e')+txt(x+250,y+3,6.3,it.parties+' T / '+it.guests+' G',true,C.white);const mid=Math.ceil(list.length/2),rh=Math.min(24,Math.max(18,320/Math.max(1,mid-1)));q+=twoColRows(list,id?'AWAL PERIODE':'FIRST HALF',id?'LANJUTAN':'SECOND HALF',row,476,rh);q+=card(28,70,230,62,id?'RATA-RATA HARI':'AVERAGE DAY',days.avgTables.toFixed(1)+' '+(id?'meja':'tables'),days.avgGuests.toFixed(1)+' '+(id?'tamu':'guests'),C.blue)+card(280,70,230,62,id?'TANGGAL TERAMAI':'BUSIEST DATE',days.busiest?days.busiest.date:'-',days.busiest?(days.busiest.parties+' T / '+days.busiest.guests+' G'):'',C.pink)+card(532,70,232,62,id?'TANGGAL TERLAMBAT':'SLOWEST DATE',days.slowest?days.slowest.date:'-',days.slowest?(days.slowest.parties+' T / '+days.slowest.guests+' G'):'',C.gold);return q};
  const strategyPage=(pageNo)=>{let q=pageBase(id?'ARAH STRATEGI & KEPUTUSAN':'STRATEGY & DECISION GUIDE',id?'Data diterjemahkan menjadi tindakan operasional sederhana':'Turning the data into practical operating decisions',pageNo);q+=textBlock(28,382,354,122,id?'1. STAFFING & CUT / BREAK':'1. STAFFING & CUT / BREAK',decision.staffing,C.cyan,52,7)+textBlock(410,382,354,122,id?'2. POLA HARI':'2. DAY PATTERN',decision.planning,C.gold,52,7)+textBlock(28,224,354,126,id?'3. SERVER & ROTASI':'3. SERVER & ROTATION',decision.server,C.purple,52,7)+textBlock(410,224,354,126,id?'4. FLOOR & MEJA':'4. FLOOR & TABLES',decision.floor,C.blue,52,7);q+=card(28,82,230,66,id?'RATA-RATA JAM TERAMAI':'BUSIEST AVG HOUR',hours.peak?formatHour(hours.peak.hour):'-',hours.peak?(hours.peak.avgTables.toFixed(1)+' '+(id?'meja/hari - ':'T/day - ')+hours.peak.avgGuests.toFixed(1)+' '+(id?'tamu/hari':'G/day')):'',C.pink)+card(280,82,230,66,id?'RATA-RATA JAM TERLAMBAT':'SLOWEST ACTIVE HOUR',hours.slow?formatHour(hours.slow.hour):'-',hours.slow?(hours.slow.avgTables.toFixed(1)+' '+(id?'meja/hari - ':'T/day - ')+hours.slow.avgGuests.toFixed(1)+' '+(id?'tamu/hari':'G/day')):'',C.gold)+card(532,82,232,66,id?'KUALITAS DATA':'DATA QUALITY',String(days.count)+' '+(id?'hari tercatat':'recorded days'),id?'Tanggal tanpa history tidak dianggap nol':'Missing dates are not treated as zero',C.blue);return q};

  if(weekly){pages.push(dayAnalysisPage(2,id?'ANALISA HARI MINGGUAN':'WEEKLY DAY ANALYSIS'));pages.push(hourAnalysisPage(3,id?'ANALISA JAM MINGGUAN':'WEEKLY HOUR ANALYSIS'));pages.push(serverPage(4));pages.push(floorPage(5));pages.push(strategyPage(6))}
  else if(monthly){pages.push(trendPage(2));pages.push(weekdayAnalysisPage(3));pages.push(hourAnalysisPage(4,id?'ANALISA JAM BULANAN':'MONTHLY HOUR ANALYSIS'));pages.push(weekdayHourPage(5));pages.push(serverPage(6));pages.push(floorPage(7));pages.push(strategyPage(8))}
  else{pages.push(serverPage(2));pages.push(floorPage(3));pages.push(hourAnalysisPage(4,id?'ANALISA TRAFIK JAM':'HOURLY TRAFFIC ANALYSIS'));pages.push(strategyPage(5))}

  const objects=[];objects[1]='<< /Type /Catalog /Pages 2 0 R >>';objects[3]='<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';objects[4]='<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>';const kids=[];let oid=5;for(const content of pages){const pageId=oid++,contentId=oid++;kids.push(pageId+' 0 R');objects[pageId]='<< /Type /Page /Parent 2 0 R /MediaBox [0 0 '+W+' '+H+'] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents '+contentId+' 0 R >>';objects[contentId]='<< /Length '+content.length+' >>\nstream\n'+content+'endstream'}objects[2]='<< /Type /Pages /Kids ['+kids.join(' ')+'] /Count '+kids.length+' >>';let pdf='%PDF-1.4\n%FZQuickBoard5D\n',offsets=[0];for(let i=1;i<objects.length;i++){offsets[i]=pdf.length;pdf+=i+' 0 obj\n'+objects[i]+'\nendobj\n'}const xref=pdf.length;pdf+='xref\n0 '+objects.length+'\n0000000000 65535 f \n';for(let i=1;i<objects.length;i++)pdf+=String(offsets[i]).padStart(10,'0')+' 00000 n \n';pdf+='trailer\n<< /Size '+objects.length+' /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF\n';return pdf
}

function analyticsBarValueText(item,valueKey='parties',mode='default'){
  const value=safeInt(item&&item[valueKey],0);
  if(mode==='tables')return value+' table'+(value===1?'':'s');
  if(mode==='guests')return value+' guest'+(value===1?'':'s');
  const guests=safeInt(item&&item.guests,0);
  return value+' table'+(value===1?'':'s')+' • '+guests+' guest'+(guests===1?'':'s');
}
const API={BUILD,BAR_AUTO,CAPACITY,normalizeBoard,hasBoardHistory,hasBoardSetup,isBarAuto,isBarSection,boardTurnUnits,rebuildBarRow,transformBoardForShift,buildSkipLocksFromBoard,rewriteTableRefs,recursiveBoardKeyReplace,extractAnalyticsSnapshot,aggregateAnalytics,periodRange,isoWeekValue,isoWeekRange,datesInRange,formatHour,buildAnalyticsPdf5D,analyticsBarValueText,buildWeekdayPatterns,isMonthlyRange,analyticsReading,analyticsExecutiveSummary,analyticsPdfLabels,normalizePdfLanguage,pdfWeekdayName,analyticsRecordedDayStats,analyticsHourlyAverages,analyticsWeekdayHourProfiles,analyticsDecisionReading};
if(typeof module==='object'&&module.exports){module.exports=API;return}
global.FZShiftAnalyticsV29=API;global.FZShiftAnalyticsV28=API;global.FZShiftAnalyticsV27=API;

/* ========================= BROWSER INTEGRATION ========================= */
const ANALYTICS_CHILD='analyticsV1';
const PDF_LANG_KEY='fzAnalyticsPdfLangV1';
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
function barList(title,items,labelKey='server',valueKey='parties',limit=12,valueMode='default'){
  const arr=(items||[]).slice(0,limit),max=Math.max(1,...arr.map(x=>safeInt(x[valueKey],0)));
  return '<section class="fzASection"><h3>'+escHtml(title)+'</h3><div class="fzABars">'+(arr.length?arr.map((x,i)=>'<div class="fzABarRow"><div class="fzABarLabel"><b>'+escHtml((i+1)+'. '+text(x[labelKey]))+'</b><span>'+escHtml(analyticsBarValueText(x,valueKey,valueMode))+'</span></div><div class="fzABarTrack"><i style="width:'+Math.max(2,Math.round(safeInt(x[valueKey],0)*100/max))+'%"></i></div></div>').join(''):'<div class="fzAEmpty">No data in this period.</div>')+'</div></section>';
}
function hourList(items){
  const arr=(items||[]),max=Math.max(1,...arr.map(x=>safeInt(x.parties,0)));
  return '<section class="fzASection"><h3>Traffic by Hour</h3><div class="fzAHours">'+(arr.length?arr.map(x=>'<div class="fzAHour"><b>'+escHtml(formatHour(Number(x.hour)))+'</b><div><i style="height:'+Math.max(5,Math.round(safeInt(x.parties,0)*90/max))+'px"></i></div><span>'+safeInt(x.parties,0)+'</span></div>').join(''):'<div class="fzAEmpty">Seating timestamps are unavailable for this period.</div>')+'</div></section>';
}
function managementReadingSection(a,range){
  const r=analyticsReading(a,range),items=[['1. WHAT HAPPENED',r.overview],['2. WHEN DEMAND WAS STRONGEST',r.demand],['3. SERVER / ROTATION READING',r.people],['4. FLOOR / CONTROL READING',r.floor]];
  return '<section class="fzAReading"><h3>Management Reading • What the Numbers Mean</h3><div class="fzAReadGrid">'+items.map(x=>'<article><small>'+escHtml(x[0])+'</small><p>'+escHtml(x[1])+'</p></article>').join('')+'</div></section>'
}
function monthlyWeekdaySection(a){
  const rows=a.weekdayPatterns||[];if(!rows.length)return '<section class="fzASection"><h3>Monthly Weekday Pattern</h3><div class="fzAEmpty">No recorded weekday history is available for this month.</div></section>';
  const max=Math.max(1,...rows.map(x=>Number(x.avgTables)||0));
  const bars='<div class="fzABars">'+rows.map((x,i)=>'<div class="fzABarRow"><div class="fzABarLabel"><b>'+escHtml((i+1)+'. '+x.weekday)+'</b><span>'+escHtml(x.avgTables.toFixed(1)+' avg tables • '+x.avgGuests.toFixed(1)+' avg guests • peak '+(Number.isInteger(x.peakHour)?formatHour(x.peakHour):'—'))+'</span></div><div class="fzABarTrack"><i style="width:'+Math.max(2,Math.round((Number(x.avgTables)||0)*100/max))+'%"></i></div></div>').join('')+'</div>';
  const table='<div class="fzATableWrap"><table class="fzATable"><thead><tr><th>Weekday</th><th>Recorded Days</th><th>Avg Tables / Day</th><th>Avg Guests / Day</th><th>Guests / Table</th><th>Peak Hour</th><th>Peak-Hour Load</th></tr></thead><tbody>'+rows.map(x=>'<tr><td><b>'+escHtml(x.weekday)+'</b></td><td>'+x.recordedDays+'</td><td>'+x.avgTables.toFixed(1)+'</td><td>'+x.avgGuests.toFixed(1)+'</td><td>'+x.guestsPerTable.toFixed(1)+'</td><td>'+escHtml(Number.isInteger(x.peakHour)?formatHour(x.peakHour):'—')+'</td><td>'+x.peakHourParties+' tables • '+x.peakHourGuests+' guests</td></tr>').join('')+'</tbody></table></div>';
  return '<section class="fzASection fzAMonthlyPattern"><h3>Monthly Weekday Pattern • Average per Recorded Day</h3><p class="fzASectionIntro">This compares Mondays with Mondays, Tuesdays with Tuesdays, and so on. Averages use recorded dates that contain seating history; missing/unrecorded dates are not treated as zero.</p>'+bars+table+'</section>'
}
function analyticsConclusion(a,range){
  if(!a.parties)return 'No synced seating data is available for '+range.label+'. Press SYNC TODAY after the Board has live history.';
  const srvTables=topItem(a.servers,'parties'),srvGuests=topItem(a.servers,'guests'),tbl=topItem(a.tables),day=topItem(a.dates),wd=topItem(a.weekdays),sec=topItem(a.sections),rot=topItem(a.servers,'rotationTurns'),hour=(a.hours||[]).slice().sort((x,y)=>y.parties-x.parties)[0],sh=topItem(a.shifts),lp=a.largest;
  const parts=['Analysis '+range.from+(range.to!==range.from?' through '+range.to:'')+': '+a.parties+' tables/parties / '+a.guests+' guests were recorded.'];
  if(day)parts.push('Busiest date: '+day.date+' ('+day.parties+' parties, '+day.guests+' guests).');
  if(isMonthlyRange(range)&&a.weekdayPatterns&&a.weekdayPatterns.length){const p=a.weekdayPatterns.slice().sort((x,y)=>Number(y.avgTables||0)-Number(x.avgTables||0)||Number(y.avgGuests||0)-Number(x.avgGuests||0))[0];parts.push('Highest average weekday: '+p.weekday+' ('+p.avgTables.toFixed(1)+' tables and '+p.avgGuests.toFixed(1)+' guests per recorded '+p.weekday+', across '+p.recordedDays+' recorded day'+(p.recordedDays===1?'':'s')+(Number.isInteger(p.peakHour)?'; peak '+formatHour(p.peakHour):'')+').');}else if(wd)parts.push('Busiest weekday: '+wd.weekday+' ('+wd.parties+' parties).');
  if(srvTables)parts.push('Server with the most tables served: '+srvTables.server+' ('+srvTables.parties+' tables, '+srvTables.guests+' guests).');
  if(srvGuests)parts.push('Server with the most guests served: '+srvGuests.server+' ('+srvGuests.guests+' guests across '+srvGuests.parties+' tables, '+(srvGuests.parties?(srvGuests.guests/srvGuests.parties).toFixed(1):'0')+' guests/table).');
  if(rot)parts.push('Most Board rotation turns: '+rot.server+' ('+rot.rotationTurns+' turns).');
  if(tbl)parts.push('Most-used table: '+tbl.table+' ('+tbl.parties+' seatings, '+tbl.guests+' guests).');
  if(sec)parts.push('Busiest section: '+sec.section+' ('+sec.parties+' parties).');
  if(hour)parts.push('Busiest recorded hour: '+formatHour(Number(hour.hour))+' ('+hour.parties+' parties).');
  if(sh)parts.push('Higher-volume synced shift: '+sh.shift+' ('+sh.parties+' parties).');
  if(lp)parts.push('Largest party: '+safeInt(lp.people,0)+' guests at '+lp.table+' served by '+lp.server+'.');
  parts.push('Average party size: '+a.avgParty.toFixed(1)+'. Manual SKIPs: '+a.manualSkips+'. BAR AUTO SKIPs: '+a.barAutoSkips+'.');return parts.join(' ');
}
function analyticsSnapshotSignature(s){return JSON.stringify({p:safeInt(s&&s.summary&&s.summary.parties,0),g:safeInt(s&&s.summary&&s.summary.guests,0),r:safeInt(s&&s.summary&&s.summary.rotationTurns,0),m:safeInt(s&&s.summary&&s.summary.manualSkips,0),b:safeInt(s&&s.summary&&s.summary.barAutoSkips,0),e:snapshotEvents(s).map(x=>[x.entryId||x.id,x.table,x.server,x.people,x.rotationSlots])})}
async function loadAnalyticsRange(range){
  const savedRaw=(await readJ(analyticsRoot()+'.json'))||{},map=new Map();
  Object.values(savedRaw).forEach(r=>{if(r&&r.date&&r.date>=range.from&&r.date<=range.to)map.set(text(r.boardKey||r.date+'_'+r.shift),r)});
  const dates=datesInRange(range,370);let liveImported=0,liveScanned=false;
  if(dates.length&&dates.length<370){
    liveScanned=true;const keys=dates.flatMap(d=>[d+'_AM',d+'_PM']);
    for(let start=0;start<keys.length;start+=14){
      const chunk=keys.slice(start,start+14),settled=await Promise.allSettled(chunk.map(k=>readJ(BOARD_ROOT+'/'+k+'.json')));
      for(let i=0;i<chunk.length;i++){
        const item=settled[i];if(item.status!=='fulfilled')continue;const raw=item.value,key=chunk[i];if(!raw||raw.cleared===true||!hasBoardHistory(raw))continue;
        const snap=analyticsBuildSnapshot(raw,key,'AUTO REPORT LIVE');const prev=map.get(key);map.set(key,snap);liveImported++;
        if(!prev||analyticsSnapshotSignature(prev)!==analyticsSnapshotSignature(snap)){try{await writeJ(analyticsRoot()+'/'+key+'.json',snap,'PUT')}catch(e){console.warn('Analytics live snapshot persistence failed',key,e)}}
      }
    }
  }
  const records=[...map.values()].sort((a,b)=>text(a.date).localeCompare(text(b.date))||text(a.shift).localeCompare(text(b.shift)));records._liveImported=liveImported;records._liveScanned=liveScanned;return records
}
function csvEscape(v){const s=text(v);return /[",\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s}
function downloadAnalyticsCsv(a,range){
  const rows=[['Period From',range.from],['Period To',range.to],['Total Tables / Parties',a.parties],['Total Guests',a.guests],['Average Party',a.avgParty.toFixed(2)],['Rotation Turns',a.rotationTurns],['Manual Skips',a.manualSkips],['BAR Auto Skips',a.barAutoSkips],[],['SERVER','TABLES SERVED','GUESTS SERVED','GUESTS PER TABLE','ROTATION TURNS'],...a.servers.map(x=>[x.server,x.parties,x.guests,x.parties?(x.guests/x.parties).toFixed(2):'0.00',x.rotationTurns]),[],['TABLE','SEATINGS','GUESTS'],...a.tables.map(x=>[x.table,x.parties,x.guests]),[],['WEEKDAY','RECORDED DAYS','AVG TABLES / DAY','AVG GUESTS / DAY','GUESTS / TABLE','PEAK HOUR','PEAK-HOUR TABLES','PEAK-HOUR GUESTS'],...(a.weekdayPatterns||[]).map(x=>[x.weekday,x.recordedDays,x.avgTables.toFixed(2),x.avgGuests.toFixed(2),x.guestsPerTable.toFixed(2),Number.isInteger(x.peakHour)?formatHour(x.peakHour):'',x.peakHourParties,x.peakHourGuests]),[],['DATE','TABLES / PARTIES','GUESTS'],...a.dates.map(x=>[x.date,x.parties,x.guests])];
  const blob=new Blob(['\ufeff'+rows.map(r=>r.map(csvEscape).join(',')).join('\n')],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='FZ_Quick_Board_Analytics_'+range.from+'_'+range.to+'.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function renderAnalyticsReport(){
  if(ownerRoleUnlocked!==true)return toast('Analytics • Owner only');
  const mode=analyticsUi.mode,fromEl=document.getElementById('fzAFrom'),toEl=document.getElementById('fzATo'),monthEl=document.getElementById('fzAMonth'),weekEl=document.getElementById('fzAWeek'),dailyEl=document.getElementById('fzADay');
  let range;if(mode==='weekly')range=periodRange('weekly',weekEl&&weekEl.value);else if(mode==='monthly')range=periodRange('monthly',monthEl&&monthEl.value);else if(mode==='custom')range=periodRange('custom',fromEl&&fromEl.value,toEl&&toEl.value);else range=periodRange('daily',dailyEl&&dailyEl.value);
  range.mode=mode;
  const body=document.getElementById('fzAReport');if(!body)return;body.innerHTML='<div class="fzALoading">Loading saved Analytics + live Board history…</div>';
  try{
    const records=await loadAnalyticsRange(range),a=aggregateAnalytics(records);body._analytics=a;body._range=range;body._records=records;
    const topServerTables=topItem(a.servers,'parties'),topServerGuests=topItem(a.servers,'guests'),topTable=topItem(a.tables),topDate=topItem(a.dates),topRotation=topItem(a.servers,'rotationTurns');
    const liveNote=records._liveImported?('<div class="fzALiveNote">LIVE BOARD INCLUDED • '+records._liveImported+' AM/PM shift'+(records._liveImported===1?'':'s')+' found in this period and merged automatically.</div>'):'';
    const byGuests=(a.servers||[]).slice().sort((x,y)=>safeInt(y.guests,0)-safeInt(x.guests,0)||safeInt(y.parties,0)-safeInt(x.parties,0));
    const serverMatrix='<section class="fzASection"><h3>Server Detail • Tables vs Guests</h3><div class="fzATableWrap"><table class="fzATable"><thead><tr><th>Server</th><th>Tables Served</th><th>Guests Served</th><th>Guests / Table</th><th>Rotation Turns</th></tr></thead><tbody>'+(a.servers||[]).map(x=>'<tr><td><b>'+escHtml(x.server)+'</b></td><td>'+safeInt(x.parties,0)+'</td><td>'+safeInt(x.guests,0)+'</td><td>'+(safeInt(x.parties,0)?(safeInt(x.guests,0)/safeInt(x.parties,0)).toFixed(1):'0.0')+'</td><td>'+safeInt(x.rotationTurns,0)+'</td></tr>').join('')+'</tbody></table></div></section>';
    const guidedReading=managementReadingSection(a,range),monthlyPattern=mode==='monthly'?monthlyWeekdaySection(a):'';
    body.innerHTML=liveNote+'<div class="fzASummaryGrid">'+metricCard('TABLES / PARTIES',a.parties,'AM + PM combined')+metricCard('GUESTS',a.guests,'total guests')+metricCard('AVG PARTY',a.parties?a.avgParty.toFixed(1):'0','guests per table/party')+metricCard('ROTATION TURNS',a.rotationTurns,'Board seating boxes')+metricCard('TOP BY TABLES',topServerTables?topServerTables.server:'—',topServerTables?(topServerTables.parties+' tables / '+topServerTables.guests+' guests'):'')+metricCard('TOP BY GUESTS',topServerGuests?topServerGuests.server:'—',topServerGuests?(topServerGuests.guests+' guests / '+topServerGuests.parties+' tables'):'')+metricCard('TOP TABLE',topTable?topTable.table:'—',topTable?(topTable.parties+' uses'):'')+metricCard('MOST ROTATION',topRotation?topRotation.server:'—',topRotation?(topRotation.rotationTurns+' turns'):'')+'</div>'+guidedReading+monthlyPattern+'<section class="fzAConclusion"><h3>Full Automatic Analysis</h3><p>'+escHtml(analyticsConclusion(a,range))+'</p></section>'+barList('Servers • Tables Served',a.servers,'server','parties',15,'tables')+barList('Servers • Guests Served',byGuests,'server','guests',15,'guests')+serverMatrix+barList('Servers • Board Rotation Turns',a.servers.slice().sort((x,y)=>safeInt(y.rotationTurns,0)-safeInt(x.rotationTurns,0)),'server','rotationTurns',15)+barList('Most-Used Tables',a.tables,'table','parties',15)+(range.from===range.to?hourList(a.hours):barList('Traffic by Date',a.dates.slice().sort((x,y)=>text(x.date).localeCompare(text(y.date))),'date','parties',40))+barList(mode==='monthly'?'Traffic by Weekday • Monthly Totals':'Traffic by Weekday',a.weekdays,'weekday','parties',7)+barList('Traffic by Shift • AM + PM',a.shifts,'shift','parties',2)+barList('Sections',a.sections,'section','parties',12)+'<section class="fzASection"><h3>Analytics Source Data</h3><div class="fzATableWrap"><table class="fzATable"><thead><tr><th>Date</th><th>Shift</th><th>Parties</th><th>Guests</th><th>Rotation</th><th>Manual Skip</th><th>BAR Auto</th><th>Source / Sync</th></tr></thead><tbody>'+records.map(r=>'<tr><td>'+escHtml(r.date)+'</td><td>'+escHtml(r.shift)+'</td><td>'+safeInt(r.summary&&r.summary.parties,0)+'</td><td>'+safeInt(r.summary&&r.summary.guests,0)+'</td><td>'+safeInt(r.summary&&r.summary.rotationTurns,0)+'</td><td>'+safeInt(r.summary&&r.summary.manualSkips,0)+'</td><td>'+safeInt(r.summary&&r.summary.barAutoSkips,0)+'</td><td>'+escHtml(text(r.syncSource||'SYNC')+(r.syncedAt?(' • '+new Date(r.syncedAt).toLocaleString()):''))+'</td></tr>').join('')+'</tbody></table></div></section>';
  }catch(e){body.innerHTML='<div class="fzAError">'+escHtml((e&&e.message)||'Could not load Analytics')+'</div>'}
}
function setAnalyticsMode(mode){
  analyticsUi.mode=mode;document.querySelectorAll('[data-fza-mode]').forEach(b=>b.classList.toggle('active',b.dataset.fzaMode===mode));
  const d=document.getElementById('fzADailyFields'),w=document.getElementById('fzAWeeklyFields'),m=document.getElementById('fzAMonthlyFields'),c=document.getElementById('fzACustomFields');if(d)d.hidden=mode!=='daily';if(w)w.hidden=mode!=='weekly';if(m)m.hidden=mode!=='monthly';if(c)c.hidden=mode!=='custom';renderAnalyticsReport();
}
function analyticsPdfFilename(range,lang='en'){return 'FZ_Quick_Board_5D_Analytics_'+range.from+'_'+range.to+'_'+normalizePdfLanguage(lang).toUpperCase()+'.pdf'}
function downloadAnalyticsPdf(){
  if(ownerRoleUnlocked!==true)return toast('Analytics • Owner only');const body=document.getElementById('fzAReport');if(!body||!body._analytics||!body._range)return toast('Refresh Analytics first');const langEl=document.getElementById('fzAPdfLang'),lang=normalizePdfLanguage(langEl&&langEl.value);try{localStorage.setItem(PDF_LANG_KEY,lang)}catch(_){}const filename=analyticsPdfFilename(body._range,lang),pdf=buildAnalyticsPdf5D(body._analytics,body._range,Date.now(),lang);
  try{if(window.AndroidBridge&&typeof AndroidBridge.saveFile==='function'){const result=AndroidBridge.saveFile(filename,'application/pdf',pdf);toast(String(result||'5D Analytics PDF saved'));return}}catch(e){}
  if(typeof savePdfBrowser==='function')savePdfBrowser(filename,pdf);else{const blob=new Blob([pdf],{type:'application/pdf'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}toast('5D Analytics PDF downloaded');
}
function openAnalytics(){
  if(ownerRoleUnlocked!==true)return toast('Analytics • Owner only');
  const mount=quickPrepareLegacy('Owner Analytics • 5D Presentation');const today=selectedDate(),month=today.slice(0,7),week=isoWeekValue(today);analyticsUi={mode:'daily',from:today,to:today,month,week};let pdfLang='en';try{pdfLang=normalizePdfLanguage(localStorage.getItem(PDF_LANG_KEY)||'en')}catch(_){}
  mount.innerHTML='<div class="fzAnalytics"><div class="fzAHead"><div><h2>5D Business Analytics</h2><p>OWNER ONLY • Daily, Weekly and Monthly combine AM + PM • Separate server ranking by Tables and Guests. Saved Analytics survives Clear Shift.</p></div><button id="fzASync" class="fzAPrimary" type="button">SYNC TODAY • AM + PM</button></div><div class="fzAModes"><button data-fza-mode="daily" class="active">DAILY</button><button data-fza-mode="weekly">WEEKLY</button><button data-fza-mode="monthly">MONTHLY</button><button data-fza-mode="custom">CUSTOM RANGE</button></div><div class="fzAFilters"><div id="fzADailyFields"><label>DATE • AM + PM</label><input id="fzADay" type="date" value="'+escHtml(today)+'"></div><div id="fzAWeeklyFields" hidden><label>WEEK • MON–SUN • AM + PM</label><input id="fzAWeek" type="week" value="'+escHtml(week)+'"></div><div id="fzAMonthlyFields" hidden><label>MONTH • AM + PM</label><input id="fzAMonth" type="month" value="'+escHtml(month)+'"></div><div id="fzACustomFields" hidden class="fzACustom"><div><label>FROM</label><input id="fzAFrom" type="date" value="'+escHtml(today)+'"></div><div><label>TO</label><input id="fzATo" type="date" value="'+escHtml(today)+'"></div></div><div class="fzAPdfLang"><label>PDF LANGUAGE</label><select id="fzAPdfLang"><option value="en"'+(pdfLang==='en'?' selected':'')+'>English</option><option value="id"'+(pdfLang==='id'?' selected':'')+'>Bahasa Indonesia</option></select></div><button id="fzARefresh" type="button">REFRESH + LIVE IMPORT</button><button id="fzAPdf" type="button" class="fzAPdf">DOWNLOAD 5D PDF</button><button id="fzACsv" type="button">DOWNLOAD CSV</button></div><div id="fzAReport"></div></div>';
  document.querySelectorAll('[data-fza-mode]').forEach(b=>b.onclick=()=>setAnalyticsMode(b.dataset.fzaMode));
  ['fzADay','fzAWeek','fzAMonth','fzAFrom','fzATo'].forEach(id=>{const el=document.getElementById(id);if(el)el.onchange=renderAnalyticsReport});const pdfLangEl=document.getElementById('fzAPdfLang');if(pdfLangEl)pdfLangEl.onchange=()=>{try{localStorage.setItem(PDF_LANG_KEY,normalizePdfLanguage(pdfLangEl.value))}catch(_){}};document.getElementById('fzARefresh').onclick=renderAnalyticsReport;
  document.getElementById('fzASync').onclick=async()=>{const b=document.getElementById('fzASync');b.disabled=true;b.textContent='SYNCING…';try{await syncAnalyticsToday();await renderAnalyticsReport()}catch(e){toast((e&&e.message)||'Analytics Sync failed')}finally{b.disabled=false;b.textContent='SYNC TODAY • AM + PM'}};
  document.getElementById('fzAPdf').onclick=downloadAnalyticsPdf;document.getElementById('fzACsv').onclick=()=>{const body=document.getElementById('fzAReport');if(body&&body._analytics&&body._range)downloadAnalyticsCsv(body._analytics,body._range);else toast('Refresh Analytics first')};
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
.fzAnalytics{padding:12px 14px 40px;color:#eaf4fb}.fzAHead{display:flex;gap:12px;justify-content:space-between;align-items:center;margin-bottom:12px}.fzAHead h2{margin:0;font-size:25px}.fzAHead p{margin:4px 0 0;color:#9db6c9;font-size:11px;font-weight:800}.fzAPrimary,.fzARefresh,.fzAFilters button{min-height:44px;border:1px solid #45d483;border-radius:10px;background:#14864c;color:#fff;padding:0 13px;font-weight:1000}.fzAModes{display:flex;gap:6px;margin:8px 0}.fzAModes button{min-height:38px;border:1px solid #385c75;border-radius:9px;background:#0b2233;color:#b9cede;font-weight:1000;padding:0 12px}.fzAModes button.active{background:#2563eb;border-color:#7fb2ff;color:#fff}.fzAFilters{display:flex;align-items:end;gap:8px;flex-wrap:wrap;padding:10px;border:1px solid #2b4d64;border-radius:12px;background:#091a27}.fzAFilters label{display:block;color:#8fb0c8;font-size:9px;font-weight:1000;margin-bottom:4px}.fzAFilters input,.fzAFilters select{height:40px;border:1px solid #45667d;border-radius:8px;background:#102b40;color:#fff;padding:0 9px;font-weight:900}.fzAPdfLang{min-width:165px}.fzAPdfLang select{width:100%}.fzACustom{display:flex;gap:8px}.fzASummaryGrid,.fzShiftFacts{display:grid;grid-template-columns:repeat(4,minmax(120px,1fr));gap:8px;margin:12px 0}.fzAStat{min-height:84px;padding:10px;border:1px solid #31546a;border-radius:12px;background:linear-gradient(180deg,#102d42,#0a1c2a);display:flex;flex-direction:column;justify-content:center}.fzAStat small{color:#88a8bf;font-size:9px;font-weight:1000}.fzAStat strong{font-size:21px;line-height:24px;margin-top:4px;overflow-wrap:anywhere}.fzAStat span{color:#9fb8c9;font-size:9px;font-weight:800;margin-top:3px}.fzAConclusion{padding:13px;border:1px solid #42667d;border-radius:12px;background:#0d2638}.fzAConclusion h3,.fzASection h3{margin:0 0 8px;font-size:15px}.fzAConclusion p{margin:0;line-height:1.55;color:#d8e8f3;font-size:12px;font-weight:800}.fzASection{margin-top:12px;padding:12px;border:1px solid #2e5066;border-radius:12px;background:#091b29}.fzABars{display:grid;gap:7px}.fzABarRow{display:grid;grid-template-columns:minmax(145px,240px) 1fr;gap:9px;align-items:center}.fzABarLabel{display:flex;justify-content:space-between;gap:6px}.fzABarLabel b{font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.fzABarLabel span{font-size:9px;color:#91adbf;white-space:nowrap}.fzABarTrack{height:14px;border-radius:99px;background:#102b3e;overflow:hidden}.fzABarTrack i{display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,#2563eb,#2dd4bf)}.fzAHours{display:flex;gap:6px;align-items:end;overflow-x:auto;padding-top:8px}.fzAHour{min-width:55px;text-align:center;font-size:8px;color:#a7bfd0}.fzAHour>div{height:96px;display:flex;align-items:end;justify-content:center}.fzAHour i{display:block;width:24px;background:linear-gradient(180deg,#2dd4bf,#2563eb);border-radius:6px 6px 2px 2px}.fzAHour b{display:block;white-space:nowrap}.fzAHour span{font-weight:1000;color:#fff}.fzATableWrap{overflow:auto}.fzATable{width:100%;border-collapse:collapse;min-width:720px}.fzATable th,.fzATable td{padding:7px;border-bottom:1px solid #26485e;text-align:left;font-size:10px}.fzATable th{color:#9fc1d7}.fzAEmpty,.fzALoading,.fzAError{padding:18px;text-align:center;color:#9fb8c9;font-weight:900}.fzAError{color:#fecaca}.fzShiftFix{width:min(720px,100%);margin:0 auto;padding:20px}.fzShiftArrow{display:flex;align-items:center;justify-content:center;gap:20px;margin:5px 0 15px}.fzShiftArrow span{min-width:110px;text-align:center;padding:13px;border:2px solid #60a5fa;border-radius:13px;background:#102d49;font-size:30px;font-weight:1000}.fzShiftArrow b{font-size:31px;color:#facc15}.fzShiftNote{padding:14px;border:1px solid #42657c;border-radius:12px;background:#0a1d2c;color:#dbe9f2;font-size:12px;line-height:1.5}.fzShiftNote p{margin:8px 0}.fzShiftProgress{margin:12px 0;padding:10px;border:1px solid #34566d;border-radius:9px;text-align:center;color:#bae6fd;font-weight:1000}.fzShiftConfirm{width:100%;min-height:58px;border:1px solid #f59e0b;border-radius:12px;background:#9a4b08;color:#fff;font-size:16px;font-weight:1000}.fzShiftConfirm:disabled,.fzAPrimary:disabled{opacity:.45}
.fzAStat{position:relative;overflow:hidden;box-shadow:0 12px 24px rgba(0,0,0,.32),inset 0 1px 0 rgba(255,255,255,.08);transform:translateZ(0)}.fzAStat:after{content:"";position:absolute;right:-22px;top:-28px;width:88px;height:88px;border-radius:50%;background:radial-gradient(circle,rgba(45,212,191,.25),transparent 68%);filter:blur(1px)}.fzAConclusion,.fzASection{box-shadow:0 14px 30px rgba(0,0,0,.28),inset 0 1px 0 rgba(255,255,255,.055)}.fzABarTrack{height:17px;position:relative;overflow:visible;box-shadow:inset 0 4px 8px rgba(0,0,0,.55),0 6px 12px rgba(0,0,0,.18);transform:perspective(500px) rotateX(4deg)}.fzABarTrack i{position:relative;box-shadow:0 5px 12px rgba(45,212,191,.35),inset 0 2px 1px rgba(255,255,255,.35);transform:skewX(-6deg);transform-origin:left center}.fzABarTrack i:after{content:"";position:absolute;right:-5px;top:3px;width:5px;height:100%;background:#1757a5;transform:skewY(-38deg);transform-origin:left top;border-radius:0 3px 3px 0}.fzAHour i{position:relative;box-shadow:6px 7px 14px rgba(0,0,0,.32),inset 3px 0 2px rgba(255,255,255,.28);transform:perspective(280px) rotateY(-8deg)}.fzAHour i:after{content:"";position:absolute;right:-6px;top:4px;width:6px;height:calc(100% - 2px);background:#1d4ed8;transform:skewY(-35deg);transform-origin:left top}.fzALiveNote{margin:11px 0;padding:11px 13px;border:1px solid #2dd4bf;border-radius:11px;background:linear-gradient(135deg,rgba(13,148,136,.28),rgba(37,99,235,.18));box-shadow:0 10px 24px rgba(0,0,0,.26);font-size:10px;font-weight:1000;color:#ccfbf1}.fzAPdf{background:linear-gradient(135deg,#7c3aed,#2563eb)!important;border-color:#c4b5fd!important;box-shadow:0 8px 18px rgba(124,58,237,.28)}.fzAnalytics:before{content:"OWNER • 5D ANALYTICS";display:block;width:max-content;max-width:100%;margin:0 0 8px;padding:5px 10px;border:1px solid #5eead4;border-radius:999px;background:linear-gradient(90deg,rgba(45,212,191,.18),rgba(139,92,246,.18));color:#ccfbf1;font-size:9px;font-weight:1000;letter-spacing:.8px;box-shadow:0 7px 17px rgba(0,0,0,.22)}
.fzAReading{margin:12px 0;padding:13px;border:1px solid #2dd4bf;border-radius:12px;background:linear-gradient(135deg,#0b2b33,#10233f);box-shadow:0 14px 30px rgba(0,0,0,.3)}.fzAReading h3{margin:0 0 10px;font-size:16px;color:#ccfbf1}.fzAReadGrid{display:grid;grid-template-columns:1fr 1fr;gap:8px}.fzAReadGrid article{padding:10px 12px;border:1px solid #31566f;border-radius:10px;background:rgba(5,20,31,.72)}.fzAReadGrid small{display:block;color:#5eead4;font-size:9px;font-weight:1000;letter-spacing:.4px}.fzAReadGrid p{margin:5px 0 0;color:#e6f2f8;font-size:11px;font-weight:800;line-height:1.45}.fzASectionIntro{margin:0 0 10px;color:#9db6c9;font-size:10px;font-weight:800;line-height:1.45}.fzAMonthlyPattern .fzATableWrap{margin-top:12px}.fzAMonthlyPattern .fzABarLabel span{white-space:normal;text-align:right}.fzAMonthlyPattern{border-color:#8b5cf6;background:linear-gradient(160deg,#0b1d2b,#151c3a)}
@media(max-width:700px){.fzAReadGrid{grid-template-columns:1fr}.fzAHead{align-items:stretch;flex-direction:column}.fzAPrimary{width:100%}.fzASummaryGrid,.fzShiftFacts{grid-template-columns:1fr 1fr}.fzABarRow{grid-template-columns:1fr}.fzABarLabel{min-width:0}.fzACustom{width:100%}.fzACustom>div{flex:1}.fzAFilters>div:not([hidden]){width:100%}.fzAFilters input{width:100%}.fzAFilters button{flex:1}.fzShiftFix{padding:10px}.fzShiftArrow span{min-width:90px;font-size:24px}}
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
  const analyticsBtn=addMenuButton(dataGrid,'quickAnalytics','5D Analytics','Owner only • Daily, Weekly, Monthly, Custom • AM + PM','quickMenuBtn quickOwnerOnly');if(analyticsBtn)analyticsBtn.onclick=openAnalytics;
  try{if(typeof quickApplyAccessVisibility==='function')quickApplyAccessVisibility()}catch(_){}
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();

})(typeof window!=='undefined'?window:globalThis);
