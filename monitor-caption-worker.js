// Optional local inference. No audio is sent to an inference API.
let asr,translator;
self.onmessage=async({data})=>{
 try{
 if(data.type==='init'){
  const {pipeline,env}=await import('https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/dist/transformers.min.js');
  env.allowLocalModels=false;env.backends.onnx.wasm.numThreads=1;
  const progress_callback=p=>{if(p.status==='progress')postMessage({type:'status',text:'Downloading AI model: '+Math.round(p.progress||0)+'%'})};
  asr=await pipeline('automatic-speech-recognition','Xenova/whisper-tiny',{quantized:true,progress_callback});
  translator=await pipeline('translation','Xenova/opus-mt-en-id',{quantized:true,progress_callback});
  postMessage({type:'ready'});return;
 }
 if(data.type==='audio'){
  const options={task:'transcribe',language:data.language,return_timestamps:false,max_new_tokens:96};
  const original=(await asr(data.audio,options)).text.trim();
  let translated=original;
  if(original&&data.language!=='indonesian'){
   const english=data.language==='english'?original:(await asr(data.audio,{...options,task:'translate'})).text.trim();
   translated=(await translator(english,{max_new_tokens:128}))[0].translation_text;
  }
  postMessage({type:'result',original,translated});
 }
 }catch(e){postMessage({type:'error',text:e.message||'Local AI failed'})}
};
