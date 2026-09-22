(()=>{
 const video=document.getElementById('r3mVideo');if(!video)return;
 const box=document.createElement('div');box.style.cssText='position:absolute;bottom:8px;left:3%;right:3%;background:#000c;color:white;padding:10px;border-radius:8px;text-align:center;pointer-events:none';box.hidden=true;
 const original=document.createElement('div'),translated=document.createElement('div');translated.style.color='#fde68a';box.append(original,translated);video.parentElement.append(box);
 const panel=document.createElement('div');panel.className='r3mCard';
 panel.innerHTML='<b>Local AI subtitles · Experimental</b><p>Original + Bahasa Indonesia. First use downloads large AI models; use Wi-Fi. Processing may be slow on phones. Speech and translation can be inaccurate, especially with music.</p><label>Spoken language <select id="r3mCaptionLang"><option value="english">English</option><option value="spanish">Español</option><option value="chinese">中文</option><option value="indonesian">Indonesia</option></select></label> <button class="r3mBtn" id="r3mCaptionToggle">Enable subtitles</button><p id="r3mCaptionState" role="status">OFF · No models downloaded until enabled.</p>';
 video.parentElement.parentElement.append(panel);
 const button=panel.querySelector('button'),status=panel.querySelector('[role=status]'),lang=panel.querySelector('select');
 let active=null;
 function stop(message='OFF'){
  const c=active;active=null;if(c){clearTimeout(c.timer);clearTimeout(c.fade);if(c.worker)c.worker.terminate();if(c.processor){c.processor.onaudioprocess=null;c.processor.disconnect()}try{c.source?.disconnect();c.gain?.disconnect();c.ctx?.close()}catch(e){}try{if(r3mOwnerContext?.channel?.readyState==='open')r3mOwnerContext.channel.send('captions:off')}catch(e){}}
  box.hidden=true;original.textContent='';translated.textContent='';button.textContent='Enable subtitles';status.textContent=message;
 }
 async function start(){
  if(active){stop();return}
  const stream=video.srcObject;
  if(!stream||!stream.getAudioTracks().length||r3mOwnerPc?.connectionState!=='connected'){status.textContent='Start a live monitor connection first.';return}
  const c={worker:null,frames:[],count:0,busy:false,ready:false};active=c;button.textContent='Stop subtitles';status.textContent='Loading local AI models…';
  try{
   c.ctx=new AudioContext({sampleRate:16000});await c.ctx.resume();if(active!==c){c.ctx.close();return}
   c.worker=new Worker(new URL('monitor-caption-worker.js',document.baseURI),{type:'module'});
   c.timer=setTimeout(()=>{if(active===c)stop('Model loading timed out. Retry on Wi-Fi.')},300000);
   c.worker.onerror=()=>{if(active===c)stop('Local AI unavailable on this browser. Monitor remains usable.')};
   c.worker.onmessage=({data})=>{if(active!==c)return;
    if(data.type==='status')status.textContent=data.text;
    if(data.type==='error'){stop('Subtitle error: '+data.text);return}
    if(data.type==='ready'){
     clearTimeout(c.timer);c.ready=true;status.textContent='Listening · AI subtitles may be delayed or inaccurate';
     try{if(r3mOwnerContext?.channel?.readyState==='open')r3mOwnerContext.channel.send('captions:on')}catch(e){}
     c.source=c.ctx.createMediaStreamSource(stream);c.processor=c.ctx.createScriptProcessor(4096,1,1);c.gain=c.ctx.createGain();c.gain.gain.value=0;
     c.source.connect(c.processor);c.processor.connect(c.gain);c.gain.connect(c.ctx.destination);
     c.processor.onaudioprocess=e=>{
      if(active!==c||c.busy)return;
      const samples=new Float32Array(e.inputBuffer.getChannelData(0));c.frames.push(samples);c.count+=samples.length;
      if(c.count<16000*8)return;
      const audio=new Float32Array(c.count);let at=0,energy=0;for(const frame of c.frames){audio.set(frame,at);at+=frame.length}for(const x of audio)energy+=x*x;c.frames=[];c.count=0;
      if(Math.sqrt(energy/audio.length)<0.008)return;
      c.busy=true;status.textContent='Transcribing and translating…';c.worker.postMessage({type:'audio',audio,language:lang.value},[audio.buffer]);
      c.timer=setTimeout(()=>{if(active===c)stop('Local AI too slow on this device. Monitor remains live.')},90000);
     };
    }
    if(data.type==='result'){
     clearTimeout(c.timer);c.busy=false;original.textContent=data.original;translated.textContent=data.translated;box.hidden=!data.original;
     clearTimeout(c.fade);c.fade=setTimeout(()=>{box.hidden=true},15000);status.textContent='Listening · '+new Date().toLocaleTimeString();
    }
   };
   c.worker.postMessage({type:'init'});
  }catch(e){if(active===c)stop('Subtitles unavailable: '+e.message)}
 }
 button.onclick=start;lang.onchange=()=>{if(active)stop('Language changed. Enable subtitles again.')};
 video.onclick=()=>video.play().catch(()=>{});
 window.FZCaptions={stop};
})();
