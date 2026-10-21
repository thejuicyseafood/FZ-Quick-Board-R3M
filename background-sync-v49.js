/* FZ Quick Board R3M.8.49 — paced, single-flight background refresh. */
(function(global){
'use strict';
const slots=new Map();
const BACKGROUND_LIMIT=2;
let backgroundActive=0;
function mutationBusy(){try{return typeof quickMutationBusy==='function'&&quickMutationBusy()}catch(_){return false}}
function permittedDuringMutation(slot){
  const value=slot.options.allowDuringMutation;
  try{return typeof value==='function'?!!value():value===true}catch(_){return false}
}
function intervalMs(value){const n=Number(value);return Number.isFinite(n)&&n>0?Math.max(100,n):3000}
function schedule(slot,delay){
  if(!slot.enabled||slot.timer!==null||slot.pending)return;
  slot.timer=setTimeout(()=>{slot.timer=null;void run(slot)},delay===undefined?slot.interval:delay);
}
function stateFor(name){
  const key=String(name||'');
  if(!key)throw new Error('A background refresh name is required');
  let slot=slots.get(key);
  if(!slot){slot={name:key,callback:null,options:{},interval:3000,enabled:false,timer:null,pending:null};slots.set(key,slot)}
  return slot;
}
function run(slot){
  if(slot.pending)return slot.pending;
  const urgent=permittedDuringMutation(slot);
  if(!urgent&&mutationBusy()){schedule(slot);return Promise.resolve(false)}
  if(!urgent&&backgroundActive>=BACKGROUND_LIMIT){schedule(slot,300);return Promise.resolve(false)}
  if(typeof slot.callback!=='function')return Promise.resolve(false);
  if(!urgent)backgroundActive++;
  /* Promise.resolve().then keeps pending assigned even when callback is synchronous
     or throws. A slow request never starts another copy on the next timer tick. */
  const pending=Promise.resolve().then(()=>slot.callback()).catch(error=>{
    if(typeof slot.options.onError==='function')try{slot.options.onError(error)}catch(_){}
    return false;
  }).finally(()=>{
    if(!urgent)backgroundActive--;
    slot.pending=null;
    schedule(slot);
  });
  slot.pending=pending;
  return pending;
}
function startQuickPoll(name,callback,ms,options={}){
  const slot=stateFor(name);
  slot.callback=callback;slot.interval=intervalMs(ms);slot.options=options||{};slot.enabled=true;
  schedule(slot);
  return slot.name;
}
function runQuickPoll(name,callback,options){
  const slot=stateFor(name);
  if(typeof callback==='function')slot.callback=callback;
  if(options)slot.options=options;
  return run(slot);
}
function stopQuickPoll(name){
  const slot=slots.get(String(name||''));if(!slot)return;
  slot.enabled=false;
  if(slot.timer!==null){clearTimeout(slot.timer);slot.timer=null}
}
global.startQuickPoll=startQuickPoll;
global.runQuickPoll=runQuickPoll;
global.stopQuickPoll=stopQuickPoll;
global.FZQBBackgroundSync={start:startQuickPoll,run:runQuickPoll,stop:stopQuickPoll};
})(typeof window!=='undefined'?window:globalThis);
