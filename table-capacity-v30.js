/* FZ Quick Board R3M.8.36 — Owner Table Capacity Setup
   Persists maximum guest capacity per physical table in Firebase and local cache.
   Unknown legacy capacities are never guessed. */
(function(root){
  'use strict';
  const VERSION='R3M.8.36';
  const CACHE_KEY='fzqb_table_capacity_v1';
  const RANGE_MIN=1,RANGE_MAX=30;
  const KNOWN_DEFAULTS={
    'Bar 1':3,'Bar 2':3,'Bar 3':3,'Bar 4':3,'Bar 5':3,'Bar 6':3,
    'Bar 7':3,'Bar 8':3,'Bar 9':3,'Bar 10':3,'Bar 11':3,'Bar 12':3,
    'H1':4,'H2':6,'H3':6,'H4':6,
    'M1':6,'M2':6,
    'C1':4,'C2':6,'C3':6,'C4':6,
    'D1':4,'D2':4,'D3':4,
    'E1':4,'E2':4,'E3':4,'E4':4,'E5':4,
    'F1':4,'F2':4,'F3':4,'F4':4,'F5':4,'F6':4,
    'R1':4,'R2':4,'R3':4,'R4':4,'R5':7,'R6':7,'R7':7
  };
  const LEGACY_UNSET=new Set(['A1','A2','A3','A4','B1','B2','B3','L1','L2','L3','L4','L5','L6']);
  const GROUPS=[
    ['A / B',['A1','A2','A3','A4','B1','B2','B3']],
    ['L',['L1','L2','L3','L4','L5','L6']],
    ['BAR',['Bar 1','Bar 2','Bar 3','Bar 4','Bar 5','Bar 6','Bar 7','Bar 8','Bar 9','Bar 10','Bar 11','Bar 12']],
    ['H / M',['H1','H2','H3','H4','M1','M2']],
    ['C / D',['C1','C2','C3','C4','D1','D2','D3']],
    ['E / F',['E1','E2','E3','E4','E5','F1','F2','F3','F4','F5','F6']],
    ['R',['R1','R2','R3','R4','R5','R6','R7']]
  ];
  const path=()=>ROOT+'/tableCapacityV1';
  root.FZ_TABLE_CAPACITY_STATE=root.FZ_TABLE_CAPACITY_STATE||{};
  root.FZ_TABLE_CAPACITY_DEFAULTS=Object.freeze({...KNOWN_DEFAULTS});

  function cleanCap(v){
    const n=Number(v);
    return Number.isInteger(n)&&n>=RANGE_MIN&&n<=RANGE_MAX?n:null;
  }
  function normalize(raw){
    const source=raw&&raw.capacities&&typeof raw.capacities==='object'?raw.capacities:(raw&&typeof raw==='object'?raw:{}),out={};
    Object.entries(source).forEach(([id,v])=>{const n=cleanCap(v);if(n!==null)out[id]=n});
    return out;
  }
  function merged(){return {...KNOWN_DEFAULTS,...(root.FZ_TABLE_CAPACITY_STATE||{})}}
  function missing(){const m=merged();return TABLE_IDS.filter(id=>cleanCap(m[id])===null)}
  function updateButtonStatus(){const b=document.getElementById('quickTableCapacity');if(!b)return;const span=b.querySelector('span'),n=missing().length;if(span)span.textContent=n?('Owner • '+n+' capacities need setup'):('Owner • all '+TABLE_IDS.length+' capacities synced')}
  function notify(){
    updateButtonStatus();
    try{updateNextServerSuggestion()}catch(e){}
    try{quickRenderNextTables()}catch(e){}
    try{if(typeof quickRenderBoard==='function')quickRenderBoard()}catch(e){}
  }
  function readLocal(){
    try{const raw=JSON.parse(localStorage.getItem(CACHE_KEY)||'null');if(raw)root.FZ_TABLE_CAPACITY_STATE=normalize(raw)}catch(e){}
  }
  function writeLocal(state){try{localStorage.setItem(CACHE_KEY,JSON.stringify({capacities:state,updatedAt:Date.now()}))}catch(e){}}
  async function load(){
    readLocal();notify();
    try{
      const raw=await readJ(path()+'.json');
      const state=normalize(raw);
      root.FZ_TABLE_CAPACITY_STATE=state;writeLocal(state);notify();
    }catch(e){/* retain local cache / defaults */}
  }
  function styles(){if(document.getElementById('fzCapacityStyle'))return;const s=document.createElement('style');s.id='fzCapacityStyle';s.textContent=`
    .fzCapOverlay{position:fixed;inset:0;z-index:2147483300;background:rgba(1,8,18,.88);display:none;align-items:center;justify-content:center;padding:14px}.fzCapOverlay.show{display:flex}
    .fzCapCard{width:min(980px,98vw);max-height:94vh;overflow:auto;border:1px solid #49718c;border-radius:18px;background:linear-gradient(180deg,#102c42,#071723);box-shadow:0 26px 90px #000b;color:#eef7ff}
    .fzCapHead{position:sticky;top:0;z-index:3;display:flex;justify-content:space-between;gap:12px;align-items:center;padding:16px 18px;background:#0b2233;border-bottom:1px solid #365971}.fzCapHead h2{margin:0;font-size:24px}.fzCapHead p{margin:4px 0 0;color:#9eb8ca;font-size:11px;font-weight:800}.fzCapClose{width:42px;height:42px;border:1px solid #57758a;border-radius:10px;background:#122f44;color:#fff;font-size:24px;font-weight:1000}
    .fzCapBody{padding:14px 18px}.fzCapNotice{padding:12px;border:1px solid #8b6a21;border-radius:12px;background:#33270b;color:#fde68a;font-size:12px;font-weight:850;line-height:1.45}.fzCapNotice strong{color:#fff}
    .fzCapGroup{margin-top:14px}.fzCapGroup h3{margin:0 0 7px;color:#9bd4f5;font-size:12px;letter-spacing:.8px}.fzCapGrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(112px,1fr));gap:7px}.fzCapField{display:grid;gap:4px;padding:8px;border:1px solid #31536a;border-radius:10px;background:#0b2030}.fzCapField.missing{border-color:#c78b2a;background:#2c220d}.fzCapField label{font-size:11px;font-weight:1000}.fzCapField input{width:100%;height:38px;box-sizing:border-box;border:1px solid #4a6d83;border-radius:8px;background:#102c40;color:#fff;padding:0 9px;font-size:15px;font-weight:1000}.fzCapField small{color:#8facbf;font-size:8px;font-weight:800}
    .fzCapFoot{position:sticky;bottom:0;z-index:3;display:flex;gap:8px;align-items:center;padding:12px 18px;background:#0a1d2c;border-top:1px solid #365971}.fzCapStatus{flex:1;color:#b7cad8;font-size:10px;font-weight:850}.fzCapSave{min-width:180px;height:48px;border:1px solid #43d483;border-radius:10px;background:#14864c;color:#fff;font-weight:1000}.fzCapSave:disabled{opacity:.5}
    @media(max-width:620px){.fzCapOverlay{padding:4px}.fzCapCard{width:100vw;max-height:100dvh;border-radius:0}.fzCapGrid{grid-template-columns:repeat(3,1fr)}.fzCapFoot{display:grid;grid-template-columns:1fr}.fzCapSave{width:100%}}
  `;document.head.appendChild(s)}
  function ensureModal(){
    styles();let o=document.getElementById('fzCapacityOverlay');if(o)return o;
    o=document.createElement('div');o.id='fzCapacityOverlay';o.className='fzCapOverlay';o.innerHTML='<div class="fzCapCard" role="dialog" aria-modal="true"><div class="fzCapHead"><div><h2>Table Capacity Setup</h2><p>Owner • maximum guests per physical table • synced to all devices</p></div><button id="fzCapClose" class="fzCapClose" type="button">×</button></div><div class="fzCapBody"><div id="fzCapNotice" class="fzCapNotice"></div><div id="fzCapGroups"></div></div><div class="fzCapFoot"><div id="fzCapStatus" class="fzCapStatus">—</div><button id="fzCapSave" class="fzCapSave" type="button">SAVE &amp; SYNC CAPACITIES</button></div></div>';
    document.body.appendChild(o);document.getElementById('fzCapClose').onclick=close;document.getElementById('fzCapSave').onclick=save;o.addEventListener('click',e=>{if(e.target===o)close()});return o;
  }
  function render(){
    const state=merged(),host=document.getElementById('fzCapGroups');if(!host)return;
    host.innerHTML=GROUPS.map(([name,ids])=>'<section class="fzCapGroup"><h3>'+name+'</h3><div class="fzCapGrid">'+ids.map(id=>{const v=cleanCap(state[id]);const isMissing=v===null;return '<div class="fzCapField '+(isMissing?'missing':'')+'"><label>'+id+'</label><input data-table="'+id+'" type="number" inputmode="numeric" min="1" max="30" value="'+(v===null?'':v)+'" placeholder="Set"><small>'+(LEGACY_UNSET.has(id)&&!(id in (root.FZ_TABLE_CAPACITY_STATE||{}))?'legacy value not found':'maximum guests')+'</small></div>'}).join('')+'</div></section>').join('');
    const miss=missing(),notice=document.getElementById('fzCapNotice');notice.innerHTML=miss.length?'<strong>'+miss.length+' tables still need a capacity:</strong> '+miss.join(', ')+'. These legacy values were never recovered, so the app will not guess them.':'<strong>All table capacities are set.</strong> NEXT SERVER and Smart Seating can show capacity for every READY table.';
    document.getElementById('fzCapStatus').textContent='Known defaults are prefilled. Only saved overrides are written to Firebase.';
  }
  function open(){if(!ownerRoleUnlocked)return toast('Owner only');ensureModal().classList.add('show');render()}
  function close(){const o=document.getElementById('fzCapacityOverlay');if(o)o.classList.remove('show')}
  async function save(){
    if(!ownerRoleUnlocked)return toast('Owner only');
    const btn=document.getElementById('fzCapSave'),inputs=[...document.querySelectorAll('#fzCapacityOverlay input[data-table]')],all={};let bad=[];
    inputs.forEach(input=>{const id=input.dataset.table,n=cleanCap(input.value);if(n===null)bad.push(id);else all[id]=n});
    if(bad.length){document.getElementById('fzCapStatus').textContent='Set a valid capacity (1–30) for: '+bad.join(', ');return}
    const overrides={};TABLE_IDS.forEach(id=>{const n=all[id],d=KNOWN_DEFAULTS[id];if(d===undefined||n!==d)overrides[id]=n});
    const payload={version:1,build:VERSION,capacities:overrides,updatedAt:Date.now(),updatedBy:'Owner'};
    btn.disabled=true;document.getElementById('fzCapStatus').textContent='Saving and verifying…';
    try{
      await writeJ(path()+'.json',payload,'PUT');
      const confirmed=await readJ(path()+'.json'),verified=normalize(confirmed);
      for(const [id,n] of Object.entries(overrides))if(verified[id]!==n)throw new Error('Capacity verification failed for '+id);
      root.FZ_TABLE_CAPACITY_STATE=verified;writeLocal(verified);notify();render();document.getElementById('fzCapStatus').textContent='SAVED & SYNCED • '+TABLE_IDS.length+' tables have capacity values';toast('TABLE CAPACITIES SAVED');
    }catch(e){document.getElementById('fzCapStatus').textContent=(e&&e.message)||'Capacity save failed';toast('Capacity save failed')}
    finally{btn.disabled=false}
  }
  function ensureButton(){
    const anchor=document.getElementById('quickEditFormation');if(!anchor||document.getElementById('quickTableCapacity'))return;
    const b=document.createElement('button');b.id='quickTableCapacity';b.className='quickMenuBtn quickOwnerOnly';b.type='button';b.innerHTML='<strong>Table Capacities</strong><span>Owner • set maximum guests for every table</span>';b.onclick=open;anchor.insertAdjacentElement('afterend',b);updateButtonStatus();
    try{quickSetManagerUi()}catch(e){}
  }
  root.FZTableCapacityV30={VERSION,KNOWN_DEFAULTS,cleanCap,normalize,merged,missing,load,open,save};
  ensureButton();load();
})(globalThis);
