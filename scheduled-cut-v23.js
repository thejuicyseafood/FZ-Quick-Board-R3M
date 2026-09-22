/* R3M.8.23: scheduled CUT selection only; existing CUT persistence is reused. */
(function(){
 const originalRules=scheduledRulesForToday,originalCandidates=scheduledCandidates;
 const weekday=d=>d.getDay()>=1&&d.getDay()<=4;
 const ws=r=>String(r.workShift||'').toLowerCase().replace(/\s/g,'');
 const isDouble=r=>ws(r)==='double'||ws(r)==='doubleshift';
 const isLong=r=>ws(r).startsWith('long');
 const protectedPM=n=>scheduledIsBarServer(n)||scheduledSectionsForServer(n).includes('1');
 function earlyRemaining(){
   const rows=board&&board.rows||[];
   const longs=rows.filter(r=>r&&r.server&&isLong(r)&&staffDutyState(r.server,board).state==='ACTIVE'&&!scheduledIsBarServer(r.server)).length;
   const used=rows.filter(r=>r&&r.cutReason==='SCHEDULED V23_EARLY_LONG').length;
   return Math.max(0,longs-used);
 }
 scheduledRulesForToday=function(d=new Date()){
   const wd=weekday(d),normal=wd?15*60+30:15*60;
   const rules=[{id:'V23_EARLY_LONG',hour:14,minute:0,until:normal,boardShift:'AM',kind:'V23_EARLY',title:'LONG SHIFT ARRIVAL • SELECT DOUBLE TO CUT',message:'Select one Double for each active Long Shift arrival.',rule:'2:00 PM • 1 Long arrival = 1 Double CUT • BAR excluded'},
     {id:'V23_DOUBLE_NORMAL',hour:15,minute:wd?30:0,boardShift:'AM',kind:'DOUBLE_BREAK',title:'DOUBLE SHIFT • SCHEDULED CUT',message:'Select the remaining Double employees to CUT.',rule:(wd?'Monday–Thursday • 3:30 PM':'Friday–Sunday • 3:00 PM')+' • BAR excluded'}];
   // Keep existing evening Double/Long times; protect S1 as well as BAR.
   originalRules(d).filter(r=>r.kind==='DOUBLE_LONG').forEach(r=>rules.push({...r,id:'V23_'+r.id}));
   rules.push({id:'V23_PM_CHECKLIST',hour:wd?21:22,minute:0,boardShift:'PM',kind:'PM_EXCEPT',protected:['1'],retain:wd?1:2,title:'PM SHIFT • SELECT SERVERS TO CUT',message:'Check only the servers to CUT. Unchecked servers stay active.',rule:(wd?'Monday–Thursday • 9:00 PM':'Friday–Sunday • 10:00 PM')+' • Keep BAR, S1 and '+(wd?'1':'2')+' additional PM section(s) until last.'});
   return rules;
 };
 scheduledCandidates=function(rule){
   if(rule.kind==='V23_EARLY')return scheduledActiveRows().filter(isDouble).map(r=>({server:r.server,shift:workShiftLabel(r.workShift),sections:scheduledSectionsForServer(r.server)}));
   return originalCandidates(rule).filter(c=>rule.boardShift!=='PM'||!protectedPM(c.server));
 };
 scheduledShow=function(rule,candidates){
   if(scheduledCutEvent||!candidates.length)return;
   const limit=rule.kind==='V23_EARLY'?Math.min(earlyRemaining(),candidates.length):null;
   if(limit===0)return;
   scheduledCutEvent={rule,candidates,key:boardKey(),limit};
   $('scheduledCutTitle').textContent=rule.title;
   $('scheduledCutMessage').textContent=rule.message+(limit?' Select exactly '+limit+'.':'');
   $('scheduledCutRule').textContent=rule.rule;
   $('scheduledCutNames').innerHTML=candidates.map((c,i)=>'<label class="scheduledCutName"><input type="checkbox" data-cut-v23="'+i+'" style="width:24px;height:24px"><span>'+esc(c.server)+'</span><small>'+esc(c.shift+' • '+c.sections.map(s=>'S'+s).join(', '))+'</small></label>').join('');
   document.querySelector('#scheduledCutModal .scheduledCutNote').textContent='Only checked employees are CUT on Submit. History and SKIPs stay saved. NOT NOW makes no changes.';
   const submit=$('scheduledCutClose');submit.disabled=false;submit.textContent='SUBMIT CUT';submit.onclick=scheduledCloseAndCut;
   let cancel=$('scheduledNotNow23');if(!cancel){cancel=document.createElement('button');cancel.id='scheduledNotNow23';cancel.className='btn';cancel.textContent='NOT NOW';submit.before(cancel)}
   cancel.disabled=false;cancel.onclick=()=>{if(scheduledCutBusy)return;deferUntil=Date.now()+5*60000;scheduledCutEvent=null;closeM('scheduledCutModal')};
   openM('scheduledCutModal');
 };
 let deferUntil=0;
 scheduledCloseAndCut=async function(){
   if(!scheduledCutEvent||scheduledCutBusy)return;
   const event=scheduledCutEvent,rule=event.rule,key=event.key;
   const chosen=[...document.querySelectorAll('[data-cut-v23]:checked')].map(e=>event.candidates[Number(e.dataset.cutV23)]).filter(Boolean);
   if(!chosen.length)return toast('Choose at least one server to CUT, or NOT NOW.');
   if(rule.kind==='V23_EARLY'&&chosen.length!==event.limit)return toast('Select exactly '+event.limit+' Double employee(s).');
   if(key!==boardKey())return toast('Date / shift changed. Close and reopen this notice.');
   scheduledCutBusy=true;$('scheduledCutClose').disabled=true;$('scheduledNotNow23').disabled=true;
   const owner=operationId('scheduled23');let locks=[];
   try{
     locks=await claimTableLocks(['SCHEDULED CUT '+key],owner);if(!locks.length)throw new Error('Another device is processing CUT. Try again.');
     board=await readBoardStrict(key,'SCHEDULED CUT REVIEW');boardBaseline=cloneBoard(board);loadedBoardKey=key;
     if(key!==boardKey())throw new Error('Shift changed. No further CUT applied.');
     const active=scheduledCandidates(rule),names=new Set(active.map(c=>c.server));
     const targets=chosen.filter(c=>names.has(c.server));
     if(rule.kind==='V23_EARLY'&&targets.length>earlyRemaining())throw new Error('Long/Double coverage changed. Close and review again.');
     if(rule.retain){
       const selected=new Set(targets.map(c=>c.server));
       const all=new Set(active.flatMap(c=>c.sections).filter(s=>s!=='1'&&!s.toUpperCase().includes('BAR')));
       const remaining=new Set(active.filter(c=>!selected.has(c.server)).flatMap(c=>c.sections).filter(s=>s!=='1'&&!s.toUpperCase().includes('BAR')));
       if(remaining.size<Math.min(rule.retain,all.size))throw new Error('Leave '+Math.min(rule.retain,all.size)+' additional PM section(s) unchecked to CUT last.');
     }
     for(const c of targets){
       if(key!==boardKey())throw new Error('Shift changed. Stopped remaining CUTs.');
       await performStaffDutyChange(c.server,'CUT','',{skipConfirm:true,reason:'SCHEDULED '+rule.id});
     }
     board=await readBoardStrict(key,'SCHEDULED CUT VERIFY');boardBaseline=cloneBoard(board);
     if(targets.some(c=>staffDutyState(c.server,board).state==='ACTIVE'))throw new Error('Some selected employees were not CUT. Review and retry.');
     if(rule.kind!=='V23_EARLY')localStorage.setItem(scheduledAckKey(rule.id),String(Date.now()));
     scheduledCutEvent=null;closeM('scheduledCutModal');toast('Selected employees CUT • history preserved');
   }catch(e){toast(e.message||'CUT failed. Review employee status before retrying.')}finally{
     for(const l of locks)await releaseTableLock(l,owner);
     scheduledCutBusy=false;$('scheduledCutClose').disabled=false;$('scheduledNotNow23').disabled=false;
   }
 };
 scheduledCheck=function(){
   if(Date.now()<deferUntil||scheduledCutEvent||scheduledCutBusy||clearShiftInFlight||formationSaveInFlight||staffDutyInFlight)return;
   if(!board||!Array.isArray(board.rows)||loadedBoardKey!==boardKey())return;
   const now=new Date();if(boardKey().split('_')[0]!==scheduledDateKey(now))return;
   const minutes=now.getHours()*60+now.getMinutes();
   for(const r of scheduledRulesForToday(now)){
     if(r.boardShift!==shift()||minutes<r.hour*60+r.minute||(r.until&&minutes>=r.until))continue;
     if(r.kind==='V23_EARLY'&&!earlyRemaining())continue;
     try{if(localStorage.getItem(scheduledAckKey(r.id,now)))continue}catch(e){}
     const candidates=scheduledCandidates(r);if(candidates.length){scheduledShow(r,candidates);return}
   }
 };
})();
