'use strict';
// Tokens stay in the extension service worker. No external messaging.
const API='https://www.googleapis.com/drive/v3',UPLOAD='https://www.googleapis.com/upload/drive/v3/files';
const FOLDER='application/vnd.google-apps.folder',LIMIT=24*1024*1024,FILE_SCOPE='https://www.googleapis.com/auth/drive.file',ALL_SCOPE='https://www.googleapis.com/auth/drive';
const ID=/^[A-Za-z0-9_-]{11}$/;
const LEGACY_NAME=/^slide_(\d{13})_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})_(direct|tab)_(quick|normal)\.png$/;
const SIMPLE_NAME=/^(\d{2,})-(\d{2})-(\d{2})-(\d{3})(?:_(\d{2,}))?\.png$/;
const NAME={test:name=>validSlideName(name)};
const SIDECAR_NAME='slides.json',SIDECAR_MAX=1024*1024;
const SLIDE_ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function slideFileInfo(name){
 const legacy=LEGACY_NAME.exec(String(name));
 if(legacy)return {timestampMs:Number(legacy[1]),slideId:legacy[2],source:legacy[3],mode:legacy[4],legacy:true};
 const m=SIMPLE_NAME.exec(String(name));if(!m)return null;
 const hh=Number(m[1]),mm=Number(m[2]),ss=Number(m[3]),ms=Number(m[4]);
 if(hh>99999||mm>59||ss>59||ms>999||m[5]&&Number(m[5])<2)return null;
 const timestampMs=((hh*60+mm)*60+ss)*1000+ms;
 return Number.isSafeInteger(timestampMs)?{timestampMs,sequence:Number(m[5]||1),legacy:false}:null;
}
function validSlideName(name){return !!slideFileInfo(name);}
function slideTimeName(ms,sequence=1){
 if(!Number.isSafeInteger(ms)||ms<0||ms>99999*3600000+3599999)throw Error('Invalid slide timestamp');
 const pad=(n,size)=>String(n).padStart(size,'0');
 const h=Math.floor(ms/3600000),m=Math.floor(ms/60000)%60,s=Math.floor(ms/1000)%60;
 return pad(h,2)+'-'+pad(m,2)+'-'+pad(s,2)+'-'+pad(ms%1000,3)+(sequence>1?'_'+pad(sequence,2):'')+'.png';
}

const key=(vid,name)=>vid+'/'+name;
const HISTORY_PREFIX='dg-slides-history-v2:',HISTORY_LIST_KEY='dg-slides-history-ids-v2';
const VIDEO_DIR_TTL=5*60*1000;
const videoDirCache=new Map();
const VIDEO_KEY='youtubeVideoId',INDEX_NAME='index.json',INDEX_MD='INDEX.md',INDEX_MAX=3*1024*1024,INDEX_INTERVAL=15*60*1000,INDEX_IDLE=5*60*1000,INDEX_MAX_WAIT=30*60*1000,INDEX_RETRY=5*60*1000;
let dbPromise,serial=Promise.resolve(),writeSerial=Promise.resolve();
function queueWrite(fn){const p=writeSerial.then(fn);writeSerial=p.catch(()=>{});return p;}
function queue(fn){const p=serial.then(fn);serial=p.catch(()=>{});return p;}
function openDB(){return dbPromise??=new Promise((resolve,reject)=>{const r=indexedDB.open('slides-originals-v1',1);r.onupgradeneeded=()=>{const db=r.result,meta=db.createObjectStore('meta',{keyPath:'key'});meta.createIndex('videoId','videoId');meta.createIndex('state','state');db.createObjectStore('bytes');};r.onerror=()=>reject(r.error);r.onsuccess=()=>resolve(r.result);});}
async function tx(stores,mode,fn){const db=await openDB();return new Promise((resolve,reject)=>{try{const t=db.transaction(stores,mode);let result;t.oncomplete=()=>resolve(result);t.onabort=t.onerror=()=>reject(t.error||Error('local storage error'));fn(t,v=>{result=v;});}catch(e){reject(e);}});}
function read(store,k){return tx([store],'readonly',(t,done)=>{const r=t.objectStore(store).get(k);r.onsuccess=()=>done(r.result);});}
function records(index,k){return tx(['meta'],'readonly',(t,done)=>{const os=t.objectStore('meta'),r=index?os.index(index).getAll(k):os.getAll();r.onsuccess=()=>done(r.result);});}
function saveRecord(r,blob){return tx(['meta','bytes'],'readwrite',(t,done)=>{t.objectStore('meta').put(r);if(blob)t.objectStore('bytes').put(blob,r.key);done(r);});}
async function config(){return (await chrome.storage.local.get('config')).config||null;}
let syncRunning=false,immediateSyncQueued=false,automaticRetryAfter=0;
function pendingCount(){return tx(['meta'],'readonly',(t,done)=>{const r=t.objectStore('meta').index('state').count('pending');r.onsuccess=()=>done(r.result);});}
// Isolated extension storage replaces the previous youtube.com localStorage index.
function normalizeHistoryRow(v){
 if(!ID.test(v?.videoId||'')||!Number.isSafeInteger(v.count)||v.count<0||v.count>1000000)throw Error('Invalid history row');
 return {videoId:v.videoId,count:v.count,title:typeof v.title==='string'?v.title.slice(0,350):'',updatedAt:Number.isFinite(v.updatedAt)&&v.updatedAt>0?Math.min(v.updatedAt,Date.now()+60000):0};
}
function historyStorageKey(id){return HISTORY_PREFIX+id;}
async function historySnapshot(){
 // Read only the history keyset; do not deserialize unrelated cloud index/health data.
 const manifest=await chrome.storage.local.get(HISTORY_LIST_KEY);
 const ids=Array.isArray(manifest[HISTORY_LIST_KEY])?manifest[HISTORY_LIST_KEY].filter(v=>ID.test(v)):null;
 const all=ids?await chrome.storage.local.get(ids.map(historyStorageKey)):await chrome.storage.local.get(null);
 const rows=[];
 for(const [key,value] of Object.entries(all)){
  if(!key.startsWith(HISTORY_PREFIX))continue;
  try{const id=key.slice(HISTORY_PREFIX.length),r=normalizeHistoryRow({...value,videoId:id});rows.push(r);}catch(_){}
 }
 return rows;
}
async function historyUpsert(rows){
 if(!Array.isArray(rows)||rows.length>500)throw Error('Too many history rows');
 const requested=rows.map(normalizeHistoryRow),keys=requested.map(r=>historyStorageKey(r.videoId));
 const previous=await chrome.storage.local.get([...keys,HISTORY_LIST_KEY]),updates={},merged=[];
 const storedIds=Array.isArray(previous[HISTORY_LIST_KEY])?previous[HISTORY_LIST_KEY].filter(v=>ID.test(v)):[];
 const allIds=new Set(storedIds);
 for(const r of requested){
  const key=historyStorageKey(r.videoId),prior=previous[key];
  allIds.add(r.videoId);
  const same=prior&&Number.isSafeInteger(prior.count)&&prior.count>=0?prior:null;
  const title=r.title||(same?.title||'');
  const result={count:Math.max(r.count,same?.count||0),title,updatedAt:Math.max(r.updatedAt,same?.updatedAt||0)};
  if(!same||JSON.stringify(result)!==JSON.stringify(same))updates[key]=result;
  merged.push({videoId:r.videoId,...result});
  previous[key]=result;
 }
 if(!Array.isArray(previous[HISTORY_LIST_KEY])||allIds.size!==storedIds.length)updates[HISTORY_LIST_KEY]=[...allIds];
 if(Object.keys(updates).length)await chrome.storage.local.set(updates);
 return merged;
}
async function updateHealth(patch){const old=(await chrome.storage.local.get('syncHealth')).syncHealth||{};await chrome.storage.local.set({syncHealth:{...old,...patch}});}
async function state(){
 const c=await config(),pending=await pendingCount(),data=await chrome.storage.local.get(['lastSync','syncHealth']),health=data.syncHealth||{};
 return {connected:!!c,pending,mode:c?.mode||'',lastSync:data.lastSync||'',syncing:syncRunning,indexError:health.indexError||'',lastCheckedAt:health.lastCheckedAt||0,lastUploadedAt:health.lastUploadedAt||0,lastUploadCount:health.lastUploadCount||0,checkError:health.checkError||'',syncError:health.syncError||'',clientConfigured:!!chrome.runtime.getManifest().oauth2?.client_id};
}
async function details(){const c=await config();return {...await state(),root:c?.root||'',rootName:c?.rootName||''};}
async function verifyConnection(){
 const c=await config();if(!c)throw Error('尚未登入 Google Drive');
 try{const t=await auth(c);await checkRoot(t,c);await updateHealth({lastCheckedAt:Date.now(),checkError:''});}
 catch(e){await updateHealth({checkError:String(e?.message||e).slice(0,240)});throw e;}
 return state();
}
function qstr(s){return "'"+String(s).replace(/\\/g,'\\\\').replace(/'/g,"\\'")+"'";}
async function token(scope,interactive=false){if(!chrome.runtime.getManifest().oauth2?.client_id)throw Error('請先在本機設定 OAuth Client ID（setup.html）');const r=await chrome.identity.getAuthToken({interactive,scopes:[scope]});const value=typeof r==='string'?r:r?.token;if(!value)throw Error('尚未授權 Google 帳號');if(r?.grantedScopes&&!r.grantedScopes.includes(scope))throw Error('未取得需要的 Drive 權限');return value;}
async function fetchApi(t,url,opts={}){
 const res=await fetch(url,{...opts,headers:{...opts.headers,Authorization:'Bearer '+t},signal:AbortSignal.timeout(30000)});
 if(!res.ok){if(res.status===401)await chrome.identity.removeCachedAuthToken({token:t}).catch(()=>{});throw Error('Google Drive HTTP '+res.status);}
 return res;
}
async function json(t,path,opts={}){return (await fetchApi(t,API+path,opts)).json();}
async function owner(t){const info=await json(t,'/about?fields=user(permissionId)');if(!info.user?.permissionId)throw Error('無法驗證 Drive 帳號');return info.user.permissionId;}
async function auth(c){if(!c)throw Error('尚未連接 Google Drive');const t=await token(c.scope);if(await owner(t)!==c.owner)throw Error('登入帳號不是原本連接的帳號；停止同步');return t;}
async function list(t,q){let out=[],page;do{const p=new URLSearchParams({q:"trashed = false and ("+q+")",fields:'nextPageToken,files(id,name,mimeType,size,modifiedTime,parents,trashed,appProperties)',pageSize:'1000',spaces:'drive'});if(page)p.set('pageToken',page);const r=await json(t,'/files?'+p);out.push(...(r.files||[]));page=r.nextPageToken;}while(page);return out;}
async function children(t,parent,extra){return list(t,qstr(parent)+' in parents'+(extra?' and '+extra:''));}
async function folder(t,parent,name,create=false){const matches=await children(t,parent,"mimeType = "+qstr(FOLDER)+" and name = "+qstr(name));if(matches.length>1)throw Error('重複資料夾 '+name+'；請至 Drive 整理');if(matches[0])return matches[0].id;if(!create)return null;const f=await json(t,'/files?fields=id,name',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,mimeType:FOLDER,parents:[parent]})});return f.id;}
async function checkRoot(t,c){
 const f=await json(t,'/files/'+encodeURIComponent(c.root)+'?fields=id,name,mimeType,trashed');
 if(f.id!==c.root||f.trashed||f.mimeType!==FOLDER||typeof f.name!=='string'||!f.name)throw Error('指定資料夾已無法存取或不是資料夾，停止同步');
 // Drive folder IDs, not user-editable names, identify the connection.
 if(f.name!==c.rootName){
  const installed=await config();
  if(installed?.root===c.root&&installed.owner===c.owner)
   await chrome.storage.local.set({config:{...installed,rootName:f.name}});
 }
 return f;
}
// Human-readable folders use private Drive metadata as their stable identity.
function cleanVideoTitle(title,vid){
 // Preserve meaningful punctuation, while making file names safe for Windows/macOS sync.
 let name=String(title||'').normalize('NFC').replace(/\s*-\s*YouTube\s*$/i,'');
 name=name.replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g,' ');
 name=name.replace(/^(\d{4})\s*[\/.\-]\s*(\d{1,2})\s*[\/.\-]\s*(\d{1,2})\s*[(（]([一二三四五六日天])[)）]/,(_,y,m,d,week)=>
  `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}（${week}） `);
 name=name.replace(/[\\/]/g,'／').replace(/:/g,'：').replace(/\?/g,'？').replace(/\*/g,'＊')
  .replace(/"/g,'＂').replace(/</g,'〈').replace(/>/g,'〉').replace(/\|/g,'｜')
  .replace(/〖/g,'【').replace(/〗/g,'】').replace(/\s+/g,' ').trim().replace(/^[.\s]+|[.\s]+$/g,'');
 if(/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(name))name='_'+name;
 name=Array.from(name).slice(0,108).join('').replace(/[.\s]+$/g,'');
 return name||vid;
}
function folderIdFor(r){const v=r?.appProperties?.[VIDEO_KEY];return ID.test(v||'')?v:ID.test(r?.name||'')?r.name:null;}
async function ensureFolderTag(t,dir,vid){
 if(dir.appProperties?.[VIDEO_KEY]===vid)return dir;
 if(dir.appProperties?.[VIDEO_KEY])throw Error('資料夾影片 ID 與索引衝突：'+dir.id);
 const patched=await json(t,'/files/'+encodeURIComponent(dir.id)+'?fields=id,name,mimeType,parents,trashed,appProperties',{
  method:'PATCH',headers:{'Content-Type':'application/json'},
  body:JSON.stringify({appProperties:{...(dir.appProperties||{}),[VIDEO_KEY]:vid}})
 });
 if(patched.id!==dir.id||patched.appProperties?.[VIDEO_KEY]!==vid)throw Error('無法寫入隱藏影片 ID：'+dir.id);
 return patched;
}
async function allVideoFolders(t,c,vid){
 const roots=[c.root],legacy=await folder(t,c.root,'slides-v1');if(legacy)roots.push(legacy);
 const found=[],seen=new Set();
 for(const root of roots){
  const named=await children(t,root,'mimeType = '+qstr(FOLDER)+' and name = '+qstr(vid));
  const tagged=await children(t,root,'mimeType = '+qstr(FOLDER)+' and appProperties has { key = '+qstr(VIDEO_KEY)+' and value = '+qstr(vid)+' }');
  if(tagged.length>1)throw Error('同一影片有多個標記資料夾，請先整理 Google Drive');
  for(const f of [...tagged,...named]){
   if(f.appProperties?.[VIDEO_KEY]&&f.appProperties[VIDEO_KEY]!==vid)throw Error('影片 ID 中繼資料衝突');
   if(!seen.has(f.id)){seen.add(f.id);found.push(f);}
  }
 }
 // Existing ID-only folders might have been renamed from Drive's UI. Recover them
 // by stable Drive file ID before any code path is allowed to create a new folder.
 if(!found.length){
  const index=await loadRootIndex(t,c).catch(()=>null);
  const row=index?.videos.find(v=>v.videoId===vid&&v.folderId);
  if(row){
   const meta=await json(t,'/files/'+encodeURIComponent(row.folderId)+'?fields=id,name,mimeType,parents,trashed,appProperties');
   if(meta.id!==row.folderId||meta.mimeType!==FOLDER||meta.trashed||
      !meta.parents?.some(p=>roots.includes(p))||
      (meta.appProperties?.[VIDEO_KEY]&&meta.appProperties[VIDEO_KEY]!==vid))
    throw Error('雲端索引的影片資料夾已移動或辨識衝突：'+vid);
   found.push(await ensureFolderTag(t,meta,vid));
  }
 }
 return found;
}
async function videoDirs(t,c,vid){return (await allVideoFolders(t,c,vid)).map(f=>f.id);}
async function chooseDisplayName(t,parent,title,vid,excluding=null){
 const base=cleanVideoTitle(title,vid);
 for(let i=1;i<=99;i++){
  const suffix=i===1?'':' ('+i+')';
  const name=Array.from(base).slice(0,108-suffix.length).join('')+suffix;
  const found=await children(t,parent,'mimeType = '+qstr(FOLDER)+' and name = '+qstr(name));
  if(found.every(f=>f.id===excluding))return name;
 }
 throw Error('影片標題重複過多，已停止建立資料夾');
}
async function ensureVideoDir(t,c,vid,title){
 const cached=videoDirCache.get(vid);
 if(cached?.root===c.root&&cached.expires>Date.now())return cached.id;
 const found=await allVideoFolders(t,c,vid);
 if(found.length){
  videoDirCache.set(vid,{id:found[0].id,root:c.root,expires:Date.now()+VIDEO_DIR_TTL});
  return found[0].id;
 }
 const name=await chooseDisplayName(t,c.root,title,vid);
 const file=await json(t,'/files?fields=id,name,appProperties',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,mimeType:FOLDER,parents:[c.root],appProperties:{[VIDEO_KEY]:vid}})});
 if(!file.id||file.name!==name||file.appProperties?.[VIDEO_KEY]!==vid)throw Error('建立資料夾後無法驗證影片 ID，請重新同步');
 videoDirCache.set(vid,{id:file.id,root:c.root,expires:Date.now()+VIDEO_DIR_TTL});
 return file.id;
}
async function legacyCandidates(t,c){
 const roots=[c.root],legacy=await folder(t,c.root,'slides-v1');if(legacy)roots.push(legacy);
 const result=[];
 for(const root of roots)for(const f of await children(t,root,'mimeType = '+qstr(FOLDER))){
  if(!ID.test(f.name)||f.appProperties?.[VIDEO_KEY])continue;
  const rows=await records('videoId',f.name);
  const raw=rows.find(r=>typeof r.title==='string'&&r.title.trim())?.title||'';
  const title=raw?cleanVideoTitle(raw,f.name):'';
  result.push({folderId:f.id,videoId:f.name,title,parent:root,ready:!!title&&title!==f.name});
 }
 return result;
}
async function previewNames(){
 const c=await config();if(!c)throw Error('尚未連接 Google Drive');
 const t=await auth(c);await checkRoot(t,c);
 const rows=await legacyCandidates(t,c);
 return {ready:rows.filter(r=>r.ready).length,missingTitle:rows.filter(r=>!r.ready).length,folders:rows.map(({videoId,title,ready})=>({videoId,title,ready})),pending:await pendingCount()};
}
async function migrateNames(m){
 const c=await config();if(!c)throw Error('尚未連接 Google Drive');
 if(await pendingCount())throw Error('仍有待上傳的圖片，請先完成同步');
 const t=await auth(c);await checkRoot(t,c);
 const rows=await legacyCandidates(t,c);let renamed=0,skipped=0;
 const titles=m?.titles&&typeof m.titles==='object'&&!Array.isArray(m.titles)?m.titles:{};
 for(const r of rows){
  if(Object.prototype.hasOwnProperty.call(titles,r.videoId)&&typeof titles[r.videoId]==='string'&&titles[r.videoId].trim()){
   r.title=cleanVideoTitle(titles[r.videoId].slice(0,350),r.videoId);
   r.ready=r.title!==r.videoId;
  }
  if(!r.ready){skipped++;continue;}
  const old=await json(t,'/files/'+encodeURIComponent(r.folderId)+'?fields=id,name,mimeType,parents,trashed,appProperties');
  if(old.trashed||old.mimeType!==FOLDER||old.name!==r.videoId||!old.parents?.includes(r.parent)||old.appProperties?.[VIDEO_KEY])throw Error('資料夾在整理期間發生變化，已停止；已整理 '+renamed+' 個');
  const siblings=await allVideoFolders(t,c,r.videoId);
  if(siblings.some(f=>f.id!==r.folderId&&f.appProperties?.[VIDEO_KEY]))throw Error('同一影片已存在標記資料夾，已停止；已整理 '+renamed+' 個');
  const newName=await chooseDisplayName(t,r.parent,r.title,r.videoId,r.folderId);
  const changed=await json(t,'/files/'+encodeURIComponent(r.folderId)+'?fields=id,name,appProperties',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:newName,appProperties:{[VIDEO_KEY]:r.videoId}})});
  if(changed.id!==r.folderId||changed.name!==newName||changed.appProperties?.[VIDEO_KEY]!==r.videoId)throw Error('更新後無法驗證隱藏 ID，已整理 '+renamed+' 個');
  renamed++;
 }
 return {renamed,skipped};
}
function slideMetaFromDrive(vid,r,sidecar){
 const parsed=slideFileInfo(r.name),props=r.appProperties||{},archived=sidecar?.get(r.id);
 if(!parsed)return null;
 const timestampMs=Number(props.timestampMs??archived?.timestampMs??parsed.timestampMs);
 if(!Number.isSafeInteger(timestampMs)||timestampMs<0||timestampMs>359999999999)return null;
 const slideId=props.slideId||archived?.slideId||parsed.slideId||'';
 const source=props.source||archived?.source||parsed.source||'';
 const mode=props.mode||archived?.mode||parsed.mode||'';
 const capturedAt=props.capturedAt||archived?.capturedAt||'';
 return {timestampMs,slideId:SLIDE_ID.test(slideId)?slideId:'',source:['direct','tab'].includes(source)?source:'',mode:['quick','normal'].includes(mode)?mode:'',capturedAt:typeof capturedAt==='string'?capturedAt.slice(0,50):'',legacyName:archived?.legacyName||''};
}
function cloudMeta(vid,r,sidecar){
 const meta=slideMetaFromDrive(vid,r,sidecar);
 return {key:key(vid,r.name),videoId:vid,name:r.name,size:Number(r.size)||0,modified:Date.parse(r.modifiedTime)||0,driveId:r.id,state:'cloud',...meta};
}
async function slideSidecar(t,files,vid){
 const found=files.filter(f=>f.name===SIDECAR_NAME);
 if(!found.length)return null;
 if(found.length!==1||found[0].mimeType!=='application/json'||Number(found[0].size)>SIDECAR_MAX)throw Error('slides.json 重複或太大，已停止同步');
 const raw=await (await fetchApi(t,API+'/files/'+encodeURIComponent(found[0].id)+'?alt=media')).text();
 if(raw.length>SIDECAR_MAX)throw Error('slides.json 超過上限');
 const data=JSON.parse(raw);
 if(data.schema_version!==1||data.video_id!==vid||!Array.isArray(data.slides)||data.slides.length>10000)throw Error('slides.json 格式不符');
 const mapped=new Map();
 for(const v of data.slides){if(!v||typeof v.driveId!=='string'||typeof v.timestampMs!=='number'||!Number.isSafeInteger(v.timestampMs)||v.timestampMs<0||mapped.has(v.driveId))throw Error('slides.json 含無效或重複圖片紀錄');mapped.set(v.driveId,v);}
 return mapped;
}
async function remoteVideo(t,c,vid){
 const result=new Map();
 for(const dir of await videoDirs(t,c,vid)){
  const files=await children(t,dir),sidecar=await slideSidecar(t,files,vid);
  for(const r of files){
   if(!NAME.test(r.name)||r.mimeType!=='image/png')continue;
   if(result.has(r.name)&&result.get(r.name).driveId!==r.id)throw Error('雲端同名 PNG 重複，請先整理');
   result.set(r.name,cloudMeta(vid,r,sidecar));
  }
 }
 return [...result.values()];
}
async function migrateLocalName(old,r){
 if(old.name===r.name)return old;
 if(old.state==='pending')return old;
 const existing=await read('meta',r.key);
 if(existing){if(existing.driveId!==r.driveId)throw Error('新檔名已被不同圖片佔用');return existing;}
 return tx(['meta','bytes'],'readwrite',(t,done)=>{
  const meta=t.objectStore('meta'),bytes=t.objectStore('bytes');
  const target=meta.get(r.key);target.onsuccess=()=>{
   if(target.result){t.abort();return;}
   const original=bytes.get(old.key);original.onsuccess=()=>{
    const updated={...old,...r,key:r.key,name:r.name,state:'cloud'};
    meta.put(updated);meta.delete(old.key);
    if(original.result){bytes.put(original.result,r.key);bytes.delete(old.key);}
    done(updated);
   };
  };
 });
}
async function addRemote(r){
 let old=await read('meta',r.key);
 if(!old){
  const siblings=await records('videoId',r.videoId);
  const prior=siblings.find(x=>x.driveId===r.driveId&&x.key!==r.key)||
   (r.legacyName?siblings.find(x=>x.name===r.legacyName&&x.state!=='pending'&&!x.driveId):null);
  if(prior)old=await migrateLocalName(prior,r);
 }
 if(old?.state==='pending')return old;
 if(old?.driveId&&old.driveId!==r.driveId)throw Error('檔案識別變更，保留本機資料');
 // Keep the same verified local PNG even if Google Drive's rename changed modifiedTime.
 if(old&&old.size!==r.size&&await read('bytes',r.key))return old;
 const next={...old,...r,title:old?.title||''};await saveRecord(next);return next;
}
// Root-level index is advisory metadata. PNGs and their Drive file IDs remain authoritative.
function validateIndex(raw,c){
 if(!raw||raw.schema_version!==1||raw.root_id!==c.root||!Array.isArray(raw.videos)||raw.videos.length>100000)throw Error('雲端 index.json 格式或資料夾不符');
 const seen=new Set(),videos=[];
 for(const v of raw.videos){
  if(!ID.test(v?.videoId||'')||!Number.isSafeInteger(v.count)||v.count<0||v.count>1000000||seen.has(v.videoId)||typeof v.title!=='string'||v.title.length>350||typeof v.folderId!=='string'||v.folderId.length>150||!Number.isFinite(v.updatedAt)||v.updatedAt<0)throw Error('雲端 index.json 含無效影片紀錄');
  seen.add(v.videoId);videos.push({videoId:v.videoId,title:v.title,count:v.count,folderId:v.folderId,updatedAt:v.updatedAt});
 }
 return {schema_version:1,root_id:c.root,generated_at:Number(raw.generated_at)||0,videos};
}
async function namedIndexFile(t,c,name){
 const files=await children(t,c.root,'name = '+qstr(name));
 if(files.length>1)throw Error('發現多個 '+name+'，為避免索引衝突已停止寫入');
 if(files.length&&files[0].mimeType!==(name===INDEX_NAME?'application/json':'text/markdown'))throw Error(name+' 類型與預期不符');
 return files[0]||null;
}
async function loadRootIndex(t,c){
 const f=await namedIndexFile(t,c,INDEX_NAME);if(!f)return null;
 if(Number(f.size)>INDEX_MAX)throw Error('index.json 大小超過安全上限');
 const response=await fetchApi(t,API+'/files/'+encodeURIComponent(f.id)+'?alt=media');
 const raw=await response.text();if(raw.length>INDEX_MAX)throw Error('index.json 內容超過上限');
 let data;try{data=JSON.parse(raw);}catch(_){throw Error('index.json 格式無法解析');}
 return validateIndex(data,c);
}
async function uploadTextFile(t,c,name,mime,text){
 const file=await namedIndexFile(t,c,name),blob=new Blob([text],{type:mime});
 if(file){
  const changed=await (await fetchApi(t,UPLOAD+'/'+encodeURIComponent(file.id)+'?uploadType=media&fields=id,name,size',{method:'PATCH',headers:{'Content-Type':mime},body:blob})).json();
  if(changed.id!==file.id)throw Error('更新 '+name+' 後驗證失敗');
 }else{
  const boundary='ix_'+crypto.randomUUID().replace(/-/g,'');
  const payload=new Blob(['--'+boundary+'\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n'+JSON.stringify({name,mimeType:mime,parents:[c.root]})+'\r\n--'+boundary+'\r\nContent-Type: '+mime+'\r\n\r\n',blob,'\r\n--'+boundary+'--\r\n']);
  const result=await (await fetchApi(t,UPLOAD+'?uploadType=multipart&fields=id,name',{method:'POST',headers:{'Content-Type':'multipart/related; boundary='+boundary},body:payload})).json();
  if(!result.id||result.name!==name)throw Error('建立 '+name+' 失敗');
 }
}
function humanIndex(data){
 const lines=['# YouTube Slides 索引','','- 最後更新：'+new Date(data.generated_at).toLocaleString('zh-TW',{hour12:false}),'- 影片數量：'+data.videos.length,'- 圖片數量：'+data.videos.reduce((n,v)=>n+v.count,0),'','## 影片列表','','| 日期 | 影片標題 | 截圖 | YouTube |','|:--|:--|--:|:--|'];
 function splitTitle(v){
  const raw=cleanVideoTitle(v.title||v.videoId,v.videoId).replace(/[\r\n|\[\]]/g,' ').trim();
  const m=raw.match(/^(\d{4})\s*[\/.-]\s*(\d{1,2})\s*[\/.-]\s*(\d{1,2})\s*(?:[(（][一二三四五六日天][)）])?\s*/);
  const date=m?m[1]+'-'+m[2].padStart(2,'0')+'-'+m[3].padStart(2,'0'):'—';
  // Date is shown in its own column; never lose the full title in index.json.
  const title=(m?raw.slice(m[0].length):raw).trim()||raw;
  return {date,title:title.replace(/\|/g,'｜')};
 }
 const sorted=[...data.videos].sort((a,b)=>{
  const da=splitTitle(a).date,db=splitTitle(b).date;
  return (db==='—'?'':db).localeCompare(da==='—'?'':da)||b.updatedAt-a.updatedAt||a.videoId.localeCompare(b.videoId);
 });
 for(const v of sorted){
  const {date,title}=splitTitle(v);
  const label=v.folderId?'['+title+'](https://drive.google.com/drive/folders/'+encodeURIComponent(v.folderId)+')':title;
  lines.push('| '+date+' | '+label+' | '+v.count+' | [觀看](https://www.youtube.com/watch?v='+encodeURIComponent(v.videoId)+') |');
 }
 lines.push('','- 此檔案自動產生，請勿直接修改；實際圖片以 Google Drive 內 PNG 為準。');
 return lines.join('\n')+'\n';
}
async function saveRootIndex(t,c,data){
 const snapshot=validateIndex({...data,generated_at:Date.now()},c);
 snapshot.generated_at=Date.now();
 const raw=JSON.stringify(snapshot,null,2)+'\n';
 if(raw.length>INDEX_MAX)throw Error('索引資料超過安全上限，停止更新');
 await uploadTextFile(t,c,INDEX_NAME,'application/json',raw);
 await uploadTextFile(t,c,INDEX_MD,'text/markdown',humanIndex(snapshot));
 await chrome.storage.local.set({indexCache:snapshot,indexCheckedAt:Date.now()});
 return snapshot;
}
function localIndexRows(){
 return records().then(items=>{
  const groups=new Map();
  for(const r of items){if(!ID.test(r.videoId||''))continue;let group=groups.get(r.videoId);if(!group){group={videoId:r.videoId,count:0,title:'',updatedAt:0};groups.set(r.videoId,group);}group.count++;if(r.title&&r.title!==r.videoId)group.title=r.title;group.updatedAt=Math.max(group.updatedAt,r.modified||0);}
  return [...groups.values()];
 });
}
async function summarizeIndex(snapshot){
 const rows=new Map((snapshot?.videos||[]).map(v=>[v.videoId,{videoId:v.videoId,title:v.title,count:v.count,updatedAt:v.updatedAt}]));
 for(const v of await localIndexRows()){
  const current=rows.get(v.videoId);
  if(!current)rows.set(v.videoId,v);
  else{current.count=Math.max(current.count,v.count);if(!current.title&&v.title)current.title=v.title;current.updatedAt=Math.max(current.updatedAt,v.updatedAt);}
 }
 return [...rows.values()];
}
async function scanRootIndex(t,c){
 const prior=await loadRootIndex(t,c).catch(()=>null),priorTitles=new Map((prior?.videos||[]).map(v=>[v.videoId,v.title]));
 const byFolder=new Map((prior?.videos||[]).filter(v=>v.folderId).map(v=>[v.folderId,v.videoId]));
 const roots=[c.root],legacy=await folder(t,c.root,'slides-v1');if(legacy)roots.push(legacy);
 const map=new Map(),now=Date.now();
 for(const root of roots){
  const dirs=await children(t,root,'mimeType = '+qstr(FOLDER));
  for(const dir of dirs){
   const tagged=folderIdFor(dir),priorVid=byFolder.get(dir.id);
   if(tagged&&priorVid&&tagged!==priorVid)throw Error('索引對應的影片 ID 與資料夾標記不同：'+dir.id);
   const vid=tagged||priorVid;if(!vid)continue;
   if(!tagged)await ensureFolderTag(t,dir,vid);
   let record=map.get(vid);if(!record){record={videoId:vid,title:ID.test(dir.name)?'':dir.name,count:0,folderId:dir.id,updatedAt:0,names:new Map()};map.set(vid,record);}
   const found=await children(t,dir.id);
   for(const item of found){
    if(!NAME.test(item.name)||item.mimeType!=='image/png')continue;
    const existing=record.names.get(item.name);if(existing&&existing!==item.id)throw Error('同一影片存在重複 PNG 名稱：'+vid);
    record.names.set(item.name,item.id);
    record.updatedAt=Math.max(record.updatedAt,Date.parse(item.modifiedTime)||now);
   }
  }
 }
 const locals=new Map((await localIndexRows()).map(r=>[r.videoId,r]));
 return {schema_version:1,root_id:c.root,generated_at:now,videos:[...map.values()].map(({names,...v})=>({...v,title:locals.get(v.videoId)?.title||v.title||priorTitles.get(v.videoId)||'',count:names.size,updatedAt:v.updatedAt||now}))};
}
async function cloudIndex(forceScan=false,quick=false){
 const c=await config();if(!c)return {rows:await localIndexRows(),warning:'尚未連接 Google Drive',source:'local',state:await state()};
 let snapshot=null,source='local',warning='';
 try{
  const cache=await chrome.storage.local.get(['indexCache','indexCheckedAt']);
  if(quick&&cache.indexCache?.root_id===c.root&&Date.now()-(cache.indexCheckedAt||0)<INDEX_INTERVAL){snapshot=validateIndex(cache.indexCache,c);source='cache';}
  else{
   const t=await auth(c);await checkRoot(t,c);
   if(forceScan){snapshot=await scanRootIndex(t,c);snapshot=await saveRootIndex(t,c,snapshot);source='rebuild';}
   else{
    snapshot=await loadRootIndex(t,c);
    if(!snapshot&&!quick){snapshot=await scanRootIndex(t,c);snapshot=await saveRootIndex(t,c,snapshot);source='rebuild';}
    else if(snapshot){source='index';await chrome.storage.local.set({indexCache:snapshot,indexCheckedAt:Date.now()});}
    else source='local';
   }
  }
 }catch(e){warning='雲端索引暫不可用，保留本機資料：'+String(e?.message||e).slice(0,160);}
 return {rows:await summarizeIndex(snapshot),source,generatedAt:snapshot?.generated_at||0,warning,state:await state()};
}
// Keep the dirty ledger in durable Chrome storage. Timers are reconstructed after restarts.
function dirtyIndexState(stored,now=Date.now()){
 const ids=[...new Set((Array.isArray(stored?.indexDirtyIds)?stored.indexDirtyIds:[]).filter(v=>ID.test(v)))];
 const firstAt=Number.isFinite(stored?.indexDirtyFirstAt)&&stored.indexDirtyFirstAt>0?Math.min(stored.indexDirtyFirstAt,now):now;
 const lastAt=Number.isFinite(stored?.indexDirtyLastAt)&&stored.indexDirtyLastAt>0?Math.min(stored.indexDirtyLastAt,now):now;
 const retryAt=Number.isFinite(stored?.indexRetryAt)&&stored.indexRetryAt>0?stored.indexRetryAt:0;
 return {ids,firstAt,lastAt,retryAt};
}
function indexDueAt(d){
 return Math.max(Math.min(d.lastAt+INDEX_IDLE,d.firstAt+INDEX_MAX_WAIT),d.retryAt||0);
}
async function armDirtyIndex(d){
 if(!d.ids.length){await chrome.alarms.clear('slides-index');return;}
 // Chrome alarm scheduling is best effort; never rely on an unload handler.
 await chrome.alarms.create('slides-index',{when:Math.max(Date.now()+30000,indexDueAt(d))});
}
async function markIndexDirty(ids,activity=true){
 const old=dirtyIndexState(await chrome.storage.local.get(['indexDirtyIds','indexDirtyFirstAt','indexDirtyLastAt','indexRetryAt']));
 const added=[...new Set(ids)].filter(v=>ID.test(v));
 if(!added.length&&!old.ids.length)return;
 const now=Date.now(),all=[...new Set([...old.ids,...added])];
 const firstAt=old.ids.length?old.firstAt:now;
 const lastAt=activity?now:(old.ids.length?old.lastAt:now);
 const next={ids:all,firstAt,lastAt,retryAt:old.retryAt};
 await chrome.storage.local.set({indexDirtyIds:all,indexDirtyFirstAt:firstAt,indexDirtyLastAt:lastAt,indexRetryAt:old.retryAt});
 await armDirtyIndex(next);
}
async function syncCloudIndex(){
 const stored=await chrome.storage.local.get(['indexDirtyIds','indexDirtyFirstAt','indexDirtyLastAt','indexRetryAt']);
 const current=dirtyIndexState(stored),ids=current.ids;
 if(!ids.length){await chrome.alarms.clear('slides-index');return;}
 if(Date.now()+1000<indexDueAt(current)){await armDirtyIndex(current);return;}
 try{
   const c=await config();if(!c){await chrome.alarms.clear('slides-index');return;}
   const t=await auth(c);await checkRoot(t,c);
   let snapshot=await loadRootIndex(t,c);
   if(!snapshot)snapshot=await scanRootIndex(t,c);
   else{
     const map=new Map(snapshot.videos.map(v=>[v.videoId,v]));
     for(const vid of ids){
       const rows=await records('videoId',vid),old=map.get(vid);
       const folders=await allVideoFolders(t,c,vid);
       if(!folders.length)throw Error('索引更新時找不到影片資料夾：'+vid);
       const names=new Map();
       for(const f of folders)for(const item of await children(t,f.id)){
         if(!NAME.test(item.name)||item.mimeType!=='image/png')continue;
         if(names.has(item.name)&&names.get(item.name)!==item.id)throw Error('影片資料夾內發現重複檔名，已停止更新索引');
         names.set(item.name,item.id);
       }
       const title=rows.find(r=>r.title&&r.title!==vid)?.title||old?.title||(!ID.test(folders[0].name)?folders[0].name:'');
       map.set(vid,{videoId:vid,title,count:names.size,folderId:folders[0].id,updatedAt:Date.now()});
     }
     snapshot.videos=[...map.values()];
   }
   await saveRootIndex(t,c,snapshot);
   // The index is a snapshot of uploaded PNGs. Retain dirty video IDs with in-flight local PNGs.
   const pendingVideos=new Set((await records('state','pending')).map(r=>r.videoId));
   const remaining=ids.filter(vid=>pendingVideos.has(vid));
   if(remaining.length){
     const now=Date.now();
     const next={ids:remaining,firstAt:now,lastAt:now,retryAt:0};
     await chrome.storage.local.set({indexDirtyIds:remaining,indexDirtyFirstAt:now,indexDirtyLastAt:now,indexRetryAt:0});
     await armDirtyIndex(next);
   }else{
     await chrome.storage.local.remove(['indexDirtyIds','indexDirtyFirstAt','indexDirtyLastAt','indexRetryAt']);
     await chrome.alarms.clear('slides-index');
   }
   await updateHealth({indexError:''});
 }catch(e){
   const retryAt=Date.now()+INDEX_RETRY;
   await updateHealth({indexError:String(e?.message||e).slice(0,200)});
   await chrome.storage.local.set({indexRetryAt:retryAt});
   await armDirtyIndex({...current,retryAt});
 }
}
async function catalog(vid){
 const c=await config();let warning='';
 if(c)try{const t=await auth(c);await checkRoot(t,c);for(const r of await remoteVideo(t,c,vid))await addRemote(r);}catch(e){warning='雲端暫不可用，使用本機索引：'+e.message;}
 const local=await records('videoId',vid);return {files:local.map(r=>({name:r.name,size:r.size,modified:r.modified,timestampMs:r.timestampMs,slideId:r.slideId,source:r.source,mode:r.mode,capturedAt:r.capturedAt})),warning,state:await state()};
}
function decode64(raw){if(typeof raw!=='string'||raw.length>Math.ceil(LIMIT/3)*4+4)throw Error('PNG exceeds 24 MiB');const b=Uint8Array.from(atob(raw),v=>v.charCodeAt(0));if(b.length>LIMIT||b.slice(0,8).join(',')!=='137,80,78,71,13,10,26,10')throw Error('Invalid PNG');return new Blob([b],{type:'image/png'});}
async function encode64(blob){if(blob.size>LIMIT)throw Error('PNG exceeds 24 MiB');const b=new Uint8Array(await blob.arrayBuffer());let str='';for(let i=0;i<b.length;i+=32768)str+=String.fromCharCode(...b.subarray(i,i+32768));return btoa(str);}
async function equal(a,b){if(!a||a.size!==b.size)return false;const [x,y]=await Promise.all([crypto.subtle.digest('SHA-256',await a.arrayBuffer()),crypto.subtle.digest('SHA-256',await b.arrayBuffer())]);return new Uint8Array(x).every((v,i)=>v===new Uint8Array(y)[i]);}
async function put(m){
 const blob=decode64(m.data),parsed=slideFileInfo(m.name);if(!parsed)throw Error('Invalid slide name');
 if(!parsed.legacy&&!SLIDE_ID.test(m.slideId||''))throw Error('Missing slide identity');
 let name=m.name,k=key(m.videoId,name),old=await read('meta',k);
 if(old&&old.slideId&&old.slideId===m.slideId){
  const prior=await read('bytes',k);
  if(!prior||!await equal(prior,blob))throw Error('同一圖片識別碼對應不同檔案');
  return {saved:true,name};
 }
 if(old&&parsed.legacy){const prior=await read('bytes',k);if(!prior||!await equal(prior,blob))throw Error('舊檔名已存在，未覆寫');return {saved:true,name};}
 if(old){
  for(let serial=2;serial<=9999;serial++){
   name=slideTimeName(parsed.timestampMs,serial);k=key(m.videoId,name);
   if(!await read('meta',k))break;
   if(serial===9999)throw Error('同一時間點圖片過多，無法建立唯一名稱');
  }
 }
 const record={key:k,videoId:m.videoId,name,title:String(m.title||'').slice(0,350),size:blob.size,modified:Date.now(),state:'pending',timestampMs:parsed.timestampMs,slideId:m.slideId||parsed.slideId||'',source:['direct','tab'].includes(m.source)?m.source:parsed.source||'',mode:['quick','normal'].includes(m.mode)?m.mode:parsed.mode||'',capturedAt:typeof m.capturedAt==='string'?m.capturedAt.slice(0,50):''};
 await saveRecord(record,blob);return {saved:true,name};
}
async function get(m){const k=key(m.videoId,m.name),r=await read('meta',k);if(!r)throw Error('檔案不在已建立的索引內');const local=await read('bytes',k);if(local)return {data:await encode64(local),modified:r.modified};
 if(!r.driveId)throw Error('本機檔案不存在');const c=await config(),t=await auth(c);await checkRoot(t,c);
 const allowed=await videoDirs(t,c,m.videoId),meta=await json(t,'/files/'+encodeURIComponent(r.driveId)+'?fields=id,name,mimeType,size,modifiedTime,parents,trashed');
 if(meta.trashed||meta.name!==m.name||meta.mimeType!=='image/png'||!meta.parents?.some(p=>allowed.includes(p)))throw Error('雲端檔案不在選定的影片資料夾');
 if(Number(meta.size)>LIMIT)throw Error('PNG exceeds 24 MiB');
 const downloaded=await (await fetchApi(t,API+'/files/'+encodeURIComponent(r.driveId)+'?alt=media')).blob();
 return {data:await encode64(downloaded),modified:Date.parse(meta.modifiedTime)||0};}
async function index(){return cloudIndex(false,false);}
async function indexQuick(){return cloudIndex(false,true);}
async function rebuildIndex(){return cloudIndex(true,false);}
// Suspend cloud-specific work on logout, without deleting locally captured PNGs.
const CLOUD_DIRTY_KEYS=['indexDirtyIds','indexDirtyFirstAt','indexDirtyLastAt','indexRetryAt'];
async function reauthorize(){
 const c=await config();if(!c)throw Error('尚未綁定 Google Drive；請先登入。');
 // This must not try to run 'connect(existing)' without its required folder URL.
 await chrome.identity.clearAllCachedAuthTokens();
 const t=await token(c.scope,true);
 if(await owner(t)!==c.owner)throw Error('重新授權的 Google 帳號與既有資料不同。請登出後選擇正確的帳號。');
 await checkRoot(t,c);
 await updateHealth({checkError:'',syncError:'',lastCheckedAt:Date.now()});
 return {...await state(),reauthorized:true};
}
async function disconnect(){
 if(syncRunning)throw Error('圖片仍在同步，請待本批次結束後再登出。');
 const old=await config(),pending=await pendingCount();
 const dirty=await chrome.storage.local.get(CLOUD_DIRTY_KEYS);
 if(old)await chrome.storage.local.set({previousDriveConnection:{
  owner:old.owner,root:old.root,rootName:old.rootName,mode:old.mode,scope:old.scope,
  dirty,disconnectedAt:Date.now()
 }});
 let credentialError='';
 try{await chrome.identity.clearAllCachedAuthTokens();}
 catch(e){credentialError=String(e?.message||e).slice(0,150);}
 await chrome.storage.local.remove(['config',...CLOUD_DIRTY_KEYS,'indexCache','indexCheckedAt']);
 await chrome.alarms.clear('slides-sync');await chrome.alarms.clear('slides-index');
 videoDirCache.clear();automaticRetryAfter=0;
 await updateHealth({checkError:'',syncError:'',indexError:'',lastCheckedAt:0});
 await chrome.storage.local.set({lastSync:''});
 return {...await state(),signedOut:true,credentialError,pending};
}
async function discoverDefaultRoot(t){
 // drive.file never proves that an unseen folder does not exist. Do not infer
 // missing == absent and never create a duplicate based on this result.
 const byName=await list(t,'mimeType = '+qstr(FOLDER)+' and (name = '+qstr('YouTube Slides')+' or name = '+qstr('YouTube Slides - API')+')');
 if(byName.length>1)throw Error('找到多個可存取的 YouTube Slides 資料夾，請在進階設定指定正確的資料夾，避免誤綁。');
 if(byName.length===1){
  const candidate=byName[0];
  // A visible but empty app-created folder may be the new duplicate rather than
  // the manually created original hidden by drive.file. Ask instead of guessing.
  const contents=await children(t,candidate.id);
  if(!contents.length)return {emptyCandidate:candidate};
  return {root:candidate.id,rootName:candidate.name};
 }
 return null;
}
async function connect(m){
 const current=await config();
 const prior=(await chrome.storage.local.get('previousDriveConnection')).previousDriveConnection||null;
 const action=m.mode==='existing'?'existing':m.mode==='create'?'create':m.mode==='useVisible'?'useVisible':m.mode==='new'?'legacyNew':'auto';
 const mode=action==='existing'?'existing':action==='legacyNew'?'new':'auto';
 const scope=action==='existing'?ALL_SCOPE:FILE_SCOPE;
 // Only an explicit existing-folder action can rebind a previous installation.
 if(current&&action!=='existing'&&mode!==current.mode)throw Error('已綁定資料夾；重新授權請使用上方按鈕，不能以其他模式覆寫現有設定。');
 if(current&&action==='create')throw Error('已有資料夾綁定，無法建立新資料夾。請先確認現有設定。');
 const t=await token(scope,true),who=await owner(t);
 if(current&&current.owner!==who)throw Error('此安裝已綁定另一個 Google 帳號；不會將本機圖片轉送到其他帳號。');
 if(!current&&prior&&prior.owner!==who&&await pendingCount())
  throw Error('本機仍有前一個 Google 帳號的待上傳圖片。請重新登入原帳號，避免將圖片傳到其他人的 Drive。');
 if(current&&action!=='existing'){
  await checkRoot(t,current);
  await updateHealth({lastCheckedAt:Date.now(),checkError:''});
  return {...await state(),setupAction:'unchanged'};
 }
 let root,rootName,setupAction='found';
 if(action==='existing'){
  const raw=String(m.folder||'').trim(),id=raw.match(/\/folders\/([A-Za-z0-9_-]+)/)?.[1]||raw;
  if(!/^[A-Za-z0-9_-]{10,150}$/.test(id))throw Error('請輸入 Google Drive 資料夾網址或 ID');
  const r=await json(t,'/files/'+encodeURIComponent(id)+'?fields=id,name,mimeType,trashed');
  if(r.trashed||r.mimeType!==FOLDER||!r.id)throw Error('指定的 Google Drive 資料夾不存在或無法存取');
  root=r.id;rootName=r.name;
  if(current&&root!==current.root){
   if(!m.replaceExisting)throw Error('切換資料夾需要明確確認，原本的圖片不會自動合併。');
   if(syncRunning)throw Error('目前正在同步，請待同步結束後再切換。');
   const pending=await pendingCount();
   if(pending)throw Error('此裝置尚有 '+pending+' 張圖片待同步；為避免遺失或誤傳，尚不能切換。');
   await checkRoot(t,current);
   const sourceContents=await children(t,current.root);
   if(sourceContents.length)throw Error('目前綁定的資料夾不是空的，尚不能自動切換；請先檢查兩邊資料並決定如何合併。');
   const dirty=(await chrome.storage.local.get('indexDirtyIds')).indexDirtyIds||[];
   if(Array.isArray(dirty)&&dirty.length)throw Error('原資料夾仍有尚未完成的索引更新，請先完成同步。');
   setupAction='switched';
  }else if(current){
   await checkRoot(t,current);
   await updateHealth({lastCheckedAt:Date.now(),checkError:''});
   return {...await state(),setupAction:'unchanged'};
  }
 }else if(action==='legacyNew'){
  // Reauthorization for v0.3.x is handled above; do not automatically create a
  // legacy folder on first connection.
  throw Error('舊版專用模式已停用，請改用自動尋找或指定既有資料夾。');
 }else if(action==='useVisible'){
  // A user can explicitly accept an empty candidate without requesting full
  // Drive access. The candidate must be rediscovered and verified first.
  const found=await discoverDefaultRoot(t);
  if(!found?.emptyCandidate||found.emptyCandidate.id!==m.folder)throw Error('選擇的空白資料夾已變更，請重新檢查 Google Drive。');
  root=found.emptyCandidate.id;rootName=found.emptyCandidate.name;
 }else if(action==='create'){
  // A create action must be initiated separately from the sign-in/find button.
  const found=await discoverDefaultRoot(t);
  if(found?.root)throw Error('已找到可存取的 YouTube Slides 資料夾，請先使用現有資料夾。');
  if(found?.emptyCandidate)throw Error('已找到一個空白的 YouTube Slides 資料夾，請確認後使用它，避免再次建立重複資料夾。');
  rootName='YouTube Slides';
  const created=await json(t,'/files?fields=id,name,mimeType',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:rootName,mimeType:FOLDER,parents:['root']})});
  if(!created.id||created.name!==rootName||created.mimeType!==FOLDER)throw Error('新資料夾建立後驗證失敗，請檢查 Google Drive。');
  root=created.id;setupAction='created';
 }else{
  const found=await discoverDefaultRoot(t);
  if(found?.root){root=found.root;rootName=found.rootName;}
  else{
   // No configuration is stored and no Drive folder is created. The user has
   // to explicitly choose the original folder or authorize creating a new one.
   return {...await state(),setupAction:'needsChoice',emptyCandidate:found?.emptyCandidate?.id||''};
  }
 }
 if(!root)throw Error('無法確認 Google Drive 資料夾，尚未儲存連線設定');
 // Never transfer pending PNGs to a different folder, even if it is owned by the
 // same account. A disconnected binding remembers where the pending files belong.
 const samePrior=!current&&prior&&prior.owner===who&&prior.root===root;
 if(!current&&prior&&!samePrior&&await pendingCount())
  throw Error('本機有前一個資料夾的待上傳圖片。請重新連回原資料夾完成同步，避免誤傳圖片。');
 await checkRoot(t,{root,rootName});
 await chrome.storage.local.set({config:{root,rootName,mode,scope,owner:who}});
 if((current&&setupAction==='switched')||(!current&&prior)){
  videoDirCache.clear();
  await chrome.storage.local.remove(['indexCache','indexCheckedAt']);
 }
 if(!current&&samePrior&&prior.dirty&&typeof prior.dirty==='object'){
  const restore={};for(const key of CLOUD_DIRTY_KEYS)if(Object.hasOwn(prior.dirty,key))restore[key]=prior.dirty[key];
  if(Object.keys(restore).length)await chrome.storage.local.set(restore);
 }
 await updateHealth({lastCheckedAt:Date.now(),checkError:'',syncError:'',indexError:''});
 return {...await state(),setupAction,root,rootName};
}

async function renamePendingRecord(r,name){
 if(name===r.name)return r;
 if(await read('meta',key(r.videoId,name)))throw Error('目標檔名已存在於本機');
 const next={...r,name,key:key(r.videoId,name)};
 return tx(['meta','bytes'],'readwrite',(t,done)=>{
  const meta=t.objectStore('meta'),bytes=t.objectStore('bytes');
  const image=bytes.get(r.key);image.onsuccess=()=>{
   if(!image.result){t.abort();return;}
   meta.put(next);meta.delete(r.key);bytes.put(image.result,next.key);bytes.delete(r.key);done(next);
  };
 });
}
async function uploadOne(t,c,record){
 let r=record;
 const blob=await read('bytes',r.key);if(!blob)throw Error('找不到離線原圖');
 const dir=await ensureVideoDir(t,c,r.videoId,r.title),parsed=slideFileInfo(r.name);
 if(!parsed)throw Error('Unknown slide filename');
 // Older pending items were created before the metadata schema existed.
 r={...r,timestampMs:Number.isSafeInteger(r.timestampMs)?r.timestampMs:parsed.timestampMs,slideId:r.slideId||parsed.slideId||crypto.randomUUID(),source:r.source||parsed.source||'direct',mode:r.mode||parsed.mode||'normal'};
 let uploaded=null;
 for(let tries=0;tries<9999;tries++){
  const matches=await children(t,dir,'name = '+qstr(r.name));
  if(matches.length){
   const matched=matches.find(f=>f.appProperties?.slideId&&f.appProperties.slideId===r.slideId);
   if(matched){if(Number(matched.size)!==blob.size||!await equal(await (await fetchApi(t,API+'/files/'+encodeURIComponent(matched.id)+'?alt=media')).blob(),blob))throw Error('圖片識別碼重複，內容不同');uploaded=matched;break;}
   if(parsed.legacy){
    if(matches.length!==1||matches[0].mimeType!=='image/png'||Number(matches[0].size)!==blob.size)throw Error('舊圖片同名衝突，已停止');
    if(!await equal(await (await fetchApi(t,API+'/files/'+encodeURIComponent(matches[0].id)+'?alt=media')).blob(),blob))throw Error('舊圖片同名衝突，已停止');uploaded=matches[0];break;
   }
   const candidate=slideTimeName(r.timestampMs,tries+2);
   if(await read('meta',key(r.videoId,candidate)))continue;
   r=await renamePendingRecord(r,candidate);continue;
  }
  const props={slideId:r.slideId,timestampMs:String(r.timestampMs),source:r.source||'direct',mode:r.mode||'normal',capturedAt:r.capturedAt||new Date(r.modified).toISOString()};
  const boundary='dg_'+crypto.randomUUID().replace(/-/g,'');
  const body=new Blob(['--'+boundary+'\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n'+JSON.stringify({name:r.name,mimeType:'image/png',parents:[dir],appProperties:props})+'\r\n--'+boundary+'\r\nContent-Type: image/png\r\n\r\n',blob,'\r\n--'+boundary+'--\r\n']);
  uploaded=await (await fetchApi(t,UPLOAD+'?uploadType=multipart&fields=id,name,size,modifiedTime,appProperties',{method:'POST',headers:{'Content-Type':'multipart/related; boundary='+boundary},body})).json();
  if(!uploaded.id||uploaded.name!==r.name||Number(uploaded.size)!==blob.size)throw Error('Google Drive 未完整確認上傳');
  // Google Drive allows duplicate names. Detect a racing upload and preserve both images.
  const sameName=await children(t,dir,'name = '+qstr(r.name));
  if(sameName.length>1){
   if(parsed.legacy)throw Error('舊版雲端檔名競爭，請人工檢查');
   const used=new Set((await children(t,dir)).map(f=>f.name));
   let newName='';for(let serial=2;serial<=9999;serial++){
    const candidate=slideTimeName(r.timestampMs,serial);
    if(!used.has(candidate)&&!await read('meta',key(r.videoId,candidate))){newName=candidate;break;}
   }
   if(!newName)throw Error('圖片名稱衝突無法解決');
   const change=await json(t,'/files/'+encodeURIComponent(uploaded.id)+'?fields=id,name',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:newName})});
   if(change.id!==uploaded.id||change.name!==newName)throw Error('雲端重複檔名修復失敗');
   r=await renamePendingRecord(r,newName);uploaded.name=newName;
  }
  break;
 }
 if(!uploaded)throw Error('無法取得唯一雲端圖片名稱');
 await saveRecord({...r,state:'cloud',driveId:uploaded.id,modified:Date.parse(uploaded.modifiedTime)||r.modified});
}
async function arm(){if(await config()&&!await chrome.alarms.get('slides-sync'))await chrome.alarms.create('slides-sync',{periodInMinutes:1});}
async function reconcileAlarm(){
 if(await config()&&await pendingCount())await arm();else{await chrome.alarms.clear('slides-sync');if(await config()&&await pendingCount())await arm();}
}
async function flush(checkWhenEmpty=false){
 const c=await config();if(!c)return state();
 const pending=await records('state','pending');
 if(!pending.length){await reconcileAlarm();if(checkWhenEmpty)await verifyConnection();return state();}
 syncRunning=true;let uploaded=0,verified=false,uploadedIds=new Set();
 try{
  const t=await auth(c);await checkRoot(t,c);verified=true;
  await updateHealth({lastCheckedAt:Date.now(),checkError:''});
  // Mark the batch durably BEFORE calling Drive, closing the crash window between upload and index scheduling.
  await markIndexDirty(new Set(pending.slice(0,5).map(r=>r.videoId)),false);
  for(const r of pending.slice(0,5)){await uploadOne(t,c,r);uploaded++;uploadedIds.add(r.videoId);}
  await updateHealth({syncError:'',...(uploaded?{lastUploadedAt:Date.now(),lastUploadCount:uploaded}:{})});
  await chrome.storage.local.set({lastSync:'同步批次完成 '+new Date().toLocaleString()});
 }catch(e){
  const message=String(e?.message||e).slice(0,240);
  await updateHealth({syncError:message,...(!verified?{checkError:message}:{}),...(uploaded?{lastUploadedAt:Date.now(),lastUploadCount:uploaded}:{})});
  await chrome.storage.local.set({lastSync:'待同步：'+message});
 }finally{syncRunning=false;if(uploadedIds.size)try{await markIndexDirty(uploadedIds);}catch(e){await updateHealth({indexError:'索引排程失敗：'+String(e?.message||e).slice(0,160)}).catch(()=>{});}await reconcileAlarm();}
 return state();
}
// After a durable local write, coalesce immediate Drive uploads.
function requestImmediateSync(){
 if(immediateSyncQueued||Date.now()<automaticRetryAfter)return;
 immediateSyncQueued=true;
 void queue(async()=>{
  try{
   for(let round=0;round<3;round++){
    const before=await pendingCount();if(!before)break;
    const result=await flush();
    if(result.syncError){automaticRetryAfter=Date.now()+60000;break;}
    if(result.pending>=before)break;
   }
  }catch(_){automaticRetryAfter=Date.now()+60000;}
  finally{immediateSyncQueued=false;}
 }).catch(()=>{immediateSyncQueued=false;});
}
chrome.alarms.onAlarm.addListener(a=>{if(a.name==='slides-sync')void queue(flush).catch(()=>{});if(a.name==='slides-index')void queue(syncCloudIndex).catch(()=>{});});
const resumePending=()=>void queue(async()=>{
 const pending=await records('state','pending');
 if(pending.length&&await config()){
   await arm();
   // A previous process may have stopped after persisting a PNG or after a Drive upload.
   await markIndexDirty(new Set(pending.map(r=>r.videoId)),false);
 }
 const dirty=dirtyIndexState(await chrome.storage.local.get(['indexDirtyIds','indexDirtyFirstAt','indexDirtyLastAt','indexRetryAt']));
 if(await config())await armDirtyIndex(dirty);
}).catch(()=>{});
chrome.runtime.onStartup.addListener(resumePending);
chrome.runtime.onInstalled.addListener(resumePending);
chrome.action.onClicked.addListener(()=>void chrome.runtime.openOptionsPage());
chrome.runtime.onMessage.addListener((m,sender,reply)=>{
 if(sender.id!==chrome.runtime.id||!m||typeof m.type!=='string')return false;
 const options=sender.url===chrome.runtime.getURL('options.html'),yt=/^https:\/\/(?:www|m)\.youtube\.com\//.test(sender.url||'');
 if(!options&&!yt)return false;if(['connect','logout','reauthorize','syncNow','details','verify','previewNames','migrateNames','rebuildIndex'].includes(m.type)&&!options)return false;
 if(['put','get','list'].includes(m.type)&&(!ID.test(m.videoId||'')||(['put','get'].includes(m.type)&&!NAME.test(m.name||'')))){reply({ok:false,error:'Invalid video or filename'});return false;}
 (async()=>{let data;switch(m.type){
 case 'status':data=await state();break;
 case 'details':data=await details();break;
 case 'verify':data=await queue(verifyConnection);break;
 case 'previewNames':data=await queue(previewNames);break;
 case 'migrateNames':data=await queue(()=>migrateNames(m));break;
 case 'options':await chrome.runtime.openOptionsPage();data=true;break;
 case 'connect':data=await queue(()=>connect(m));await arm();await armDirtyIndex(dirtyIndexState(await chrome.storage.local.get(CLOUD_DIRTY_KEYS)));void queue(flush).catch(()=>{});break;
 case 'logout':data=await queue(disconnect);break;
 case 'reauthorize':data=await queue(reauthorize);break;
 case 'put':data=await queueWrite(()=>put(m));try{await arm();}catch(_){}requestImmediateSync();break;
 case 'list':data=await queue(()=>catalog(m.videoId));break;
 case 'get':data=await queue(()=>get(m));break;
 case 'index':data=await queue(index);break;
 case 'indexQuick':data=await queue(indexQuick);break;
 case 'historySnapshot':data=await historySnapshot();break;
 case 'historyUpsert':data=await queueWrite(()=>historyUpsert(m.rows));break;

 case 'rebuildIndex':data=await queue(rebuildIndex);break;
 case 'sync':data=await queue(flush);break;
 case 'syncNow':data=await queue(()=>flush(true));break;
 default:throw Error('Unsupported operation');}reply({ok:true,data});})().catch(e=>reply({ok:false,error:String(e.message||e).slice(0,240)}));return true;
});
