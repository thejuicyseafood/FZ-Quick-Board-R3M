/* FZ host day boundary. No archives; one current completion marker only. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.FZHostDailyClear=api;})(typeof window==='object'?window:globalThis,function(){
 'use strict';
 const TZ='America/Chicago',LEASE_MS=120000;
 function clock(now=new Date()){
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(now).map(p=>[p.type,p.value]));
  const day=parts.year+'-'+parts.month+'-'+parts.day,hour=Number(parts.hour);
  const prior=new Date(day+'T12:00:00Z');if(hour<4)prior.setUTCDate(prior.getUTCDate()-1);
  return {day,hour,cycle:hour<4?prior.toISOString().slice(0,10):day};
 }
 const key=name=>String(name).replace(/[.#$\[\]\/]/g,'_').replace(/\s+/g,'_');
 function ready(s,now){return {status:'ready',available:true,reserved:false,server:'',people:'',partyPeople:'',secondaryOf:'',secondaryTables:[],partyId:'',boardRef:null,primaryBoardRef:null,moveOperationId:'',updatedBy:'Daily Host Reset',updatedAt:now};}
 function patchFor(floor,date,now,cycle){
  const patch={tables:{},rotationBoardV31:{},floorAssignmentsV64:null,floorFormationV66:null,
    floorHistoryV2:null,rotationBoardBackupsV1094:null,rotationSkipLocksV101:null,staffCutUndoV11:null,recentSeatGuardV1:null,
    breaktimeTransfersV1096:null,sectionTransfersV1097:null,hostUndoDeleteV54:null,beeperHistoryV1:null,analyticsV1:null,
    hostDailyClearV54:{completedDay:cycle,completedAt:now,boardDate:date,cutoff:'04:00',timeZone:TZ}};
  for(const [id,state]of Object.entries(floor||{}))patch.tables[id]=ready(state,now);
  for(const shift of ['AM','PM'])patch.rotationBoardV31[date+'_'+shift]={rows:[],formation:'',cleared:true,clearShift:true,clearedAt:now,updatedAt:now,date,shift};
  return patch;
 }
 function create({root,fetch:request,now=()=>Date.now(),tableIds=[]}){
  async function http(path,{method='GET',body,etag,withEtag=false}={}){
   const headers={'Content-Type':'application/json'};if(etag)headers['If-Match']=etag;if(withEtag)headers['X-Firebase-ETag']='true';
   const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),12000);
   try{const r=await request(root+(path==='.json'?'.json':'/'+path),{method,headers,signal:ctrl.signal,...(body!==undefined?{body:JSON.stringify(body)}:{})});if(!r.ok){const e=new Error('Daily clear request failed ('+r.status+')');e.status=r.status;throw e;}return {value:await r.json(),etag:r.headers.get('etag')};}finally{clearTimeout(timer);}
  }
  async function read(path){return (await http(path)).value;}
  async function run({force=false,scheduled=false,date}={}){
   const current=clock(new Date(now())),marker=await http('hostDailyClearV54.json',{withEtag:true});
   if(scheduled&&current.hour!==4)return {outsideSchedule:true};
   if(!force&&marker.value&&marker.value.completedDay>=current.cycle)return {alreadyCleared:true};
   if(!force&&!scheduled&&!marker.value){
    if(!marker.etag)throw Error('Daily reset marker ETag missing');
    try{await http('hostDailyClearV54.json',{method:'PUT',etag:marker.etag,body:{completedDay:current.cycle,armedAt:now(),cutoff:'04:00',timeZone:TZ}});}catch(e){if(e.status!==412)throw e;}
    return {initialized:true};
   }
   const owner='daily_'+now()+'_'+Math.random().toString(36).slice(2,10),held=[];
   async function acquire(name){const path='tableOperationLocksV109/'+key(name)+'.json',snapshot=await http(path,{withEtag:true});if(!snapshot.etag)throw Error('Daily clear lock ETag missing');if(snapshot.value&&Number(snapshot.value.expiresAt)>now())throw Error('Operation still saving; daily clear will retry.');await http(path,{method:'PUT',etag:snapshot.etag,body:{owner,table:name,deviceId:'daily-reset',sessionId:owner,createdAt:now(),expiresAt:now()+LEASE_MS}});held.push(path);}
   async function release(path){try{const s=await http(path,{withEtag:true});if(s.value?.owner===owner&&s.etag)await http(path,{method:'DELETE',etag:s.etag});}catch(_){} }
   try{
    await acquire('HOST DAILY CLEAR');
    const [floor,boards]=await Promise.all([read('tables.json'),read('rotationBoardV31.json?shallow=true')]);
    if(!floor||typeof floor!=='object')throw Error('Floor missing. Daily clear stopped safely.');
    const names=[...new Set([...tableIds,...Object.keys(floor),...[...new Set([...Object.keys(boards||{}),(date||current.day)+'_AM',(date||current.day)+'_PM'])].map(k=>'BOARD '+k+' CLEAR')])].sort();
    for(let i=0;i<names.length;i+=8){const results=await Promise.allSettled(names.slice(i,i+8).map(acquire));const failed=results.find(r=>r.status==='rejected');if(failed)throw failed.reason;}
    const latestMarker=await read('hostDailyClearV54.json');
    if(!force&&latestMarker?.completedDay>=current.cycle)return {alreadyCleared:true};
    const live=await read('tables.json');if(!live)throw Error('Floor unavailable. Nothing cleared.');
    const fullFloor={...Object.fromEntries(tableIds.map(id=>[id,{}])),...live};
    const ts=now(),patch=patchFor(fullFloor,date||current.day,ts,current.cycle);
    for(let i=0;i<held.length;i+=8){await Promise.all(held.slice(i,i+8).map(async path=>{const s=await http(path,{withEtag:true});if(!s.etag||s.value?.owner!==owner||Number(s.value.expiresAt)<now()+10000)throw Error('Daily clear lock expired. Nothing cleared.');await http(path,{method:'PUT',etag:s.etag,body:{...s.value,expiresAt:now()+LEASE_MS}});}));}
    await http('.json',{method:'PATCH',body:patch});
    const [verifiedFloor,verifiedMarker,verifiedBoards]=await Promise.all([read('tables.json'),read('hostDailyClearV54.json'),read('rotationBoardV31.json')]);
    if(['AM','PM'].some(shift=>{const b=verifiedBoards?.[(date||current.day)+'_'+shift];return !b||b.clearedAt!==ts||Object.keys(b.rows||{}).length;}))throw Error('Empty Board could not be verified.');
    if(verifiedMarker?.completedAt!==ts||Object.keys(fullFloor).some(id=>{const t=verifiedFloor?.[id];return !t||t.status!=='ready'||t.partyId||t.secondaryOf||t.boardRef||t.primaryBoardRef||t.server||t.people;}))throw Error('Daily clear verification failed. Reload before using Board.');
    return {cleared:true,completedAt:ts,boardDate:date||current.day};
   }finally{for(let i=0;i<held.length;i+=8)await Promise.all(held.slice(i,i+8).map(release));}
  }
  return {run};
 }
 return {clock,key,ready,patchFor,create};
});
