/* FZ Quick Board R3M.8.53: verified atomic seating transport.
   Conditional lock requests intentionally never use print=silent. */
(function(root,factory){
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.FZFastSeat=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(root){
  'use strict';
  function createClient(options={}){
    const transport=options.fetch||((url,init)=>root.fetch(url,init));
    const now=options.now||(()=>Date.now());
    const delay=options.wait||(ms=>new Promise(resolve=>setTimeout(resolve,ms)));
    const timeoutMs=Number(options.timeoutMs)>0?Number(options.timeoutMs):10000;
    const pending=new Map();let pendingLoaded=false;
    function storage(){try{return options.storage||root.localStorage}catch(_){return null}}
    function loadPending(){
      if(pendingLoaded)return;pendingLoaded=true;
      try{const records=JSON.parse(storage()?.getItem('fzqb_pending_seats_v53')||'[]');if(Array.isArray(records))records.forEach(record=>{if(record&&record.boardKey&&record.table&&record.entryId)pending.set(record.boardKey+'|'+record.table,record)})}catch(_){}
    }
    function persistPending(){try{storage()?.setItem('fzqb_pending_seats_v53',JSON.stringify([...pending.values()]))}catch(_){} }
    async function exchange(url,init={}){
      const controller=new AbortController();let timer,rejectTimeout;
      const expired=new Promise((_,reject)=>{rejectTimeout=reject});
      timer=setTimeout(()=>{const error=new Error('Database connection timed out. Check the table before retrying.');error.code='FAST_SEAT_TIMEOUT';controller.abort(error);rejectTimeout(error)},timeoutMs);
      try{
        const response=await Promise.race([transport(url,{...init,cache:'no-store',signal:controller.signal}),expired]);
        const value=response.status===204?null:await Promise.race([response.json(),expired]);
        return {ok:response.ok,status:response.status,etag:response.headers&&response.headers.get('etag'),value};
      }finally{clearTimeout(timer)}
    }
    function requireOk(reply,label){
      if(reply.ok)return reply;
      const error=new Error(label+' (HTTP '+reply.status+').');error.status=reply.status;error.code='FAST_SEAT_HTTP';throw error;
    }
    async function readJson(url,init={}){return requireOk(await exchange(url,init),'Live seating data could not load').value}
    async function writeJson(url,data){return requireOk(await exchange(url,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}),'Seating could not save').value}
    function createLocks(config){
      const leaseMs=Number(config.leaseMs)||120000,held=config.held||new Map();
      const key=config.key||(name=>String(name).replace(/[.#$\[\]\/]/g,'_').replace(/\s+/g,'_'));
      const lockNow=config.now||now,wait=config.wait||delay;
      const mark=config.markClaiming||(()=>{}),unmark=config.unmarkClaiming||(()=>{}),isClaiming=config.isClaiming||(()=>false);
      const session=String(config.session||''),device=config.device||(()=>''),limit=Number(config.limit)||8;
      const path=name=>config.root+'/'+key(name)+'.json';
      async function batch(names,fn){const out=[];for(let start=0;start<names.length;start+=limit)out.push(...await Promise.all(names.slice(start,start+limit).map(fn)));return out}
      async function inspect(name){
        const reply=requireOk(await exchange(path(name),{headers:{'X-Firebase-ETag':'true'}}),'Could not check '+name+' lock');
        if(!reply.etag)throw new Error('Lock version is missing for '+name+'. No data was changed.');
        return {name,etag:reply.etag,current:reply.value};
      }
      async function prepareRelease(lease){
        if(!lease)return [];
        return batch(lease.names,async name=>{const snapshot=await inspect(name);snapshot.owned=!!snapshot.current&&String(snapshot.current.owner||'')===String(lease.owner);return snapshot});
      }
      async function release(lease,prepared){
        if(!lease)return true;
        let snapshots=prepared;
        try{if(!snapshots)snapshots=await prepareRelease(lease)}catch(_){snapshots=null}
        let ok=true;
        if(snapshots){
          const results=await batch(snapshots,async snapshot=>{
            if(!snapshot.owned)return true;
            if(!snapshot.etag)return false;
            try{const reply=await exchange(path(snapshot.name),{method:'DELETE',headers:{'If-Match':snapshot.etag}});return reply.ok||reply.status===412}catch(_){return false}
          });ok=results.every(Boolean);
        }else ok=false;
        lease.names.forEach(name=>{if(held.get(key(name))===String(lease.owner))held.delete(key(name))});
        return ok;
      }
      async function claim(names,owner,waitMs=4500){
        names=[...new Set(names.filter(Boolean).map(String))].sort();
        const deadline=lockNow()+Math.max(0,Number(waitMs)||0);
        do{
          const snapshots=await batch(names,inspect),stamp=lockNow();
          const blocked=snapshots.some(snapshot=>{
            const current=snapshot.current;if(!current||Number(current.expiresAt||0)<=stamp||String(current.owner||'')===String(owner))return false;
            const sameRuntime=String(current.sessionId||'')===session;
            return !sameRuntime||held.get(key(snapshot.name))===String(current.owner||'')||isClaiming(key(snapshot.name),current.owner);
          });
          if(!blocked){
            const lease={names,owner:String(owner),expiresAt:stamp+leaseMs};
            const results=await batch(snapshots,async snapshot=>{
              const current=snapshot.current,payload={owner:String(owner),table:snapshot.name,deviceId:device(),sessionId:session,createdAt:stamp,expiresAt:lease.expiresAt,reclaimedOrphan:!!current&&Number(current.expiresAt||0)>stamp&&String(current.owner||'')!==String(owner)};
              mark(key(snapshot.name),owner);
              try{const reply=await exchange(path(snapshot.name),{method:'PUT',headers:{'Content-Type':'application/json','If-Match':snapshot.etag},body:JSON.stringify(payload)});if(reply.ok){held.set(key(snapshot.name),String(owner));return {ok:true}}if(reply.status===412)return {ok:false};return {ok:false,error:new Error('Could not lock '+snapshot.name+' (HTTP '+reply.status+').')}}
              catch(error){return {ok:false,error}}
              finally{unmark(key(snapshot.name),owner)}
            });
            if(results.every(result=>result.ok))return lease;
            /* A failed response can follow a successful conditional PUT. Inspect
               every attempted lock before cleanup, not only known successes. */
            await release(lease);
            const failed=results.find(result=>result.error);if(failed)throw failed.error;
          }
          if(lockNow()>=deadline)return null;
          await wait(180);
        }while(true);
      }
      function assertValid(lease){if(!lease||lockNow()+500>=lease.expiresAt||lease.names.some(name=>held.get(key(name))!==String(lease.owner)))throw new Error('Seating locks expired. No new seating was sent. Please retry.');return true}
      return {claim,prepareRelease,release,assertValid};
    }
    return {readJson,writeJson,createLocks,
      getPending:(boardKey,table)=>{loadPending();return pending.get(boardKey+'|'+table)||null},
      putPending:record=>{loadPending();pending.set(record.boardKey+'|'+record.table,record);persistPending()},
      dropPending:(boardKey,table)=>{loadPending();pending.delete(boardKey+'|'+table);persistPending()},
      clearPending:()=>{loadPending();pending.clear();persistPending()}};
  }
  return {...createClient(),createClient};
});
