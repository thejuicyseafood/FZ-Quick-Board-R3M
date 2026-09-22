/* R3M.8.22: advisory only. No seating, rotation, skip or database writes. */
(function(root){
 'use strict';
 function recommend(candidates,party){
   const evaluated=candidates.map(c=>({...c,fit:c.ready.filter(t=>!party||(t.capacity&&t.capacity>=party))}));
   const next=evaluated.find(c=>c.fit.length&&!c.warnings.length)||evaluated.find(c=>c.fit.length)||null;
   return {original:evaluated[0]||null,next,after:next?evaluated.slice(evaluated.indexOf(next)+1).find(c=>c.fit.length)||null:null,evaluated};
 }
 if(typeof module!=='undefined'&&module.exports){module.exports={recommend};return}
 let events=[],eventKey='',busy=false,lastRead=0,lastMarkup='';
 function panel(){
   let box=document.getElementById('smartNext20');if(box)return box;
   const dash=document.getElementById('rotationDash');if(!dash)return null;
   box=document.createElement('div');box.id='smartNext20';
   box.innerHTML='<label class="sn-input">PARTY SIZE <input id="snParty20" type="number" min="1" max="120" placeholder="Any" aria-label="Party size for recommendation"></label><div id="snResult20" role="status" aria-live="polite"></div>';
   dash.prepend(box);box.querySelector('input').addEventListener('input',render);return box;
 }
 function snapshot(){
   const now=Date.now(),key=boardKey();
   const live=Object.entries(tableState||{}).filter(([,v])=>v&&!v.secondaryOf&&operationalTableStatus(v)==='seated').map(([table,v])=>({server:v.server,table,people:Number(v.people||v.partyPeople)||0,at:Number(v.updatedAt)||0}));
   const recent=[...live,...(eventKey===key?events:[])].filter(e=>e.at<=now&&now-e.at<DOUBLE_SEAT_GUARD_MS);
   const owners=(floorFormation&&floorFormation.sectionServers)||{};
   const stats=rotationStats().filter(c=>serverCanReceive(c.row.server)).map(c=>{
     const sections=Object.entries(owners).filter(([,name])=>breaktimeServerKey(name)===breaktimeServerKey(c.row.server)).map(([sec])=>sec).sort((a,b)=>sectionSortKey(a)-sectionSortKey(b));
     return {...c,row:{...c.row,section:sections[0]||''},assigned:sections.length>0};
   }).filter(c=>c.assigned);
   const position=c=>(c.row.turns||[]).reduce((last,t,i)=>t&&(t.table||t.people||t.skipped||Number.isInteger(t.master)||t.entryId)?i+1:last,0);
   stats.sort((a,b)=>position(a)-position(b)||sectionSortKey(a.row.section)-sectionSortKey(b.row.section)||a.ri-b.ri);
   return stats.map(c=>{
     const name=c.row.server,k=doubleSeatGuardKey(name),mine=recent.filter(e=>doubleSeatGuardKey(e.server)===k).sort((a,b)=>b.at-a.at),warnings=[];
     if(isDoubleSeatGuardServer(name)&&mine.length)warnings.push('Double-seat caution: seated '+Math.max(1,Math.ceil((now-mine[0].at)/60000))+' min ago');
     const large=mine.find(e=>e.people>5);if(large)warnings.push('Recent large party: '+large.people+' guests at '+large.table);
     // READY table ownership uses existing manual-assignment/formation resolver.
     const ready=TABLE_IDS.filter(id=>operationalTableStatus(tableState[id]||{})==='ready'&&breaktimeServerKey(serverForTable(id))===breaktimeServerKey(name)).map(id=>({id,capacity:tableGuestCapacity(id)}));
     return {name,section:c.row.section,ready,warnings};
   });
 }
 function render(){try{
   if(!panel()||!board)return;
   const field=document.getElementById('snParty20'),raw=field.value,party=raw?Number(raw):0;
   if(raw&&(!Number.isInteger(party)||party<1||party>120)){document.getElementById('snResult20').textContent='Enter a party size from 1 to 120.';return}
   const result=recommend(snapshot(),party),n=result.next,o=result.original;
   const label=c=>esc(c.name)+' · '+esc(String(c.section).toUpperCase()==='BAR'?'BAR':'S'+c.section);
   let html='<div class="sn-kicker">SMART SEATING · ADVISORY ONLY</div>';
   html+='<strong class="sn-next">'+(n?'RECOMMENDED NEXT: '+label(n):'NO SUITABLE READY TABLE')+'</strong>';
   if(o)html+='<div>Rotation due: '+label(o)+'</div>';
   if(n){
     html+='<div class="sn-tables">'+n.ready.map(t=>'<span>'+esc(t.id)+' · '+(t.capacity?'up to '+t.capacity+' guests':'capacity not set')+(party&&t.capacity&&t.capacity<party?' · too small':'')+'</span>').join('')+'</div>';
     const ahead=result.evaluated.slice(0,result.evaluated.indexOf(n));
     ahead.forEach(c=>{const reason=!c.ready.length?'has no READY tables':!c.fit.length?'has no confirmed single table fitting this party':c.warnings.join('; ');html+='<div class="sn-reason">'+esc(c.name)+' '+esc(reason)+'.</div>'});
     n.warnings.forEach(w=>html+='<div class="sn-reason">⚠ '+esc(w)+' — check with the server before seating.</div>');
     if(result.after)html+='<div>Next alternative: '+label(result.after)+(result.after.warnings.length?' · seating caution':'')+'</div>';
   }else html+='<div>Check the Floor'+(party?' for a suitable table or a host-confirmed combination':'')+'. Unknown capacities are not assumed to fit.</div>';
   if(eventKey!==boardKey())html+='<div class="sn-reason">Recent seating history not synced yet; existing seating confirmations still apply.</div>';
   html+='<small>Live Floor status · no automatic SKIP · host confirms seating</small>';
   if(html!==lastMarkup){document.getElementById('snResult20').innerHTML=html;lastMarkup=html}
 }catch(e){const el=document.getElementById('snResult20');if(el)el.textContent='Recommendation temporarily unavailable. Use the existing rotation and check the Floor.'}}
 async function tick(){render();try{quickRenderNextTables()}catch(e){}if(busy||Date.now()-lastRead<15000||typeof board==='undefined'||!board)return;busy=true;lastRead=Date.now();const key=boardKey();try{const raw=await readJ(RECENT_SEAT_ROOT+'/'+key+'.json');if(key===boardKey()){events=Object.values(raw||{});eventKey=key;render()}}catch(e){eventKey=''}finally{busy=false}}
 // Retire only the new full-section popup; keep the original seating guards.
 checkNextServerFloorFull=function(){render()};
 const old=document.getElementById('nextFullOverlay');if(old)old.remove();
 setInterval(tick,3000);tick();
})(globalThis);
