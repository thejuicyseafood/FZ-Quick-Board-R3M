/* FZ Quick Board R3M.8.49 — bounded Firebase REST transport.
   Writes are never automatically replayed: a disconnected response may follow a
   committed write, so the calling operation must verify its saved entry first. */
(function (global) {
  'use strict';
  const DATABASE_ORIGIN='https://table-live-by-iwanto-zhang-default-rtdb.firebaseio.com';
  const DATABASE_PATH='/juicyTableLive/JUICY-HUNTSVILLE/';
  const DATABASE_REQUEST_TIMEOUT_MS=15000;
  const nativeFetch=global.fetch.bind(global);
  const state={inFlight:0,lastDurationMs:0,lastStatus:0,lastTimedOut:false};

  function timeoutError(){
    const error=new Error('Database connection timed out. Check the live table before retrying.');
    error.name='TimeoutError';error.code='DATABASE_TIMEOUT';return error;
  }
  function abortError(signal){
    if(signal&&signal.reason instanceof Error)return signal.reason;
    const error=new Error('Database request cancelled.');error.name='AbortError';return error;
  }
  async function databaseFetch(input,options){
    const init={...(options||{})};
    const silent=init.databaseSilent===true;
    const configuredTimeout=Number(init.databaseTimeoutMs);
    delete init.databaseSilent;delete init.databaseTimeoutMs;
    let url;
    try{url=new URL(typeof input==='string'?input:input.url||String(input))}catch(_){return nativeFetch(input,init)}
    if(url.origin!==DATABASE_ORIGIN||!url.pathname.startsWith(DATABASE_PATH))return nativeFetch(input,init);
    const method=String(init.method||(input&&input.method)||'GET').toUpperCase();
    if(silent&&(method==='PUT'||method==='PATCH'))url.searchParams.set('print','silent');
    const timeoutMs=Number.isFinite(configuredTimeout)&&configuredTimeout>0
      ?Math.min(configuredTimeout,60000):DATABASE_REQUEST_TIMEOUT_MS;
    const controller=new AbortController(),callerSignal=init.signal||(input&&input.signal);
    if(callerSignal&&callerSignal.aborted)throw abortError(callerSignal);
    init.signal=controller.signal;init.cache='no-store';
    const started=Date.now();let timer,rejectWait,onAbort,timedOut=false;
    const interrupted=new Promise((_,reject)=>{rejectWait=reject});
    if(callerSignal){
      onAbort=()=>{const error=abortError(callerSignal);controller.abort(error);rejectWait(error)};
      callerSignal.addEventListener('abort',onAbort,{once:true});
    }
    timer=setTimeout(()=>{timedOut=true;const error=timeoutError();controller.abort(error);rejectWait(error)},timeoutMs);
    state.inFlight++;
    try{
      const requestInput=typeof input==='string'||input instanceof URL?url.href:new Request(url.href,input);
      const response=await Promise.race([nativeFetch(requestInput,init),interrupted]);
      /* Keep the same deadline through body download, rather than clearing it
         when only the response headers have arrived. All callers consume JSON
         or inspect status; buffering also closes unused write-response bodies. */
      const bytes=await Promise.race([response.arrayBuffer(),interrupted]);
      const noBody=response.status===204||response.status===205||response.status===304;
      const result=new Response(noBody?null:bytes,{status:response.status,statusText:response.statusText,headers:response.headers});
      state.lastStatus=response.status;return result;
    }catch(error){
      state.lastStatus=0;if(timedOut)throw timeoutError();throw error;
    }finally{
      clearTimeout(timer);if(callerSignal&&onAbort)callerSignal.removeEventListener('abort',onAbort);
      state.inFlight--;state.lastDurationMs=Math.max(0,Date.now()-started);state.lastTimedOut=timedOut;
    }
  }
  global.databaseFetch=databaseFetch;
  global.getDatabaseTransportStatus=()=>({...state});
})(globalThis);
