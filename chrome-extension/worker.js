'use strict';
// Tokens stay in the extension service worker. No external messaging.
const API='https://www.googleapis.com/drive/v3',UPLOAD='https://www.googleapis.com/upload/drive/v3/files';
const FOLDER='application/vnd.google-apps.folder',LIMIT=24*1024*1024,FILE_SCOPE='https://www.googleapis.com/auth/drive.file',ALL_SCOPE='https://www.googleapis.com/auth/drive';
const ID=/^[A-Za-z0-9_-]{11}$/,NAME=/^slide_\d{13}_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}_(direct|tab)_(quick|normal)\.png$/;
const key=(vid,name)=>vid+'/'+name;
let dbPromise,serial=Promise.resolve(),writeSerial=Promise.resolve();
function queueWrite(fn){const p=writeSerial.then(fn);writeSerial=p.catch(()=>{});return p;}
function queue(fn){const p=serial.then(fn);serial=p.catch(()=>{});return p;}
function openDB(){return dbPromise??=new Promise((resolve,reject)=>{const r=indexedDB.open('slides-originals-v1',1);r.onupgradeneeded=()=>{const db=r.result,meta=db.createObjectStore('meta',{keyPath:'key'});meta.createIndex('videoId','videoId');meta.createIndex('state','state');db.createObjectStore('bytes');};r.onerror=()=>reject(r.error);r.onsuccess=()=>resolve(r.result);});}
async function tx(stores,mode,fn){const db=await openDB();return new Promise((resolve,reject)=>{try{const t=db.transaction(stores,mode);let result;t.oncomplete=()=>resolve(result);t.onabort=t.onerror=()=>reject(t.error||Error('local storage error'));fn(t,v=>{result=v;});}catch(e){reject(e);}});}
function read(store,k){return tx([store],'readonly',(t,done)=>{const r=t.objectStore(store).get(k);r.onsuccess=()=>done(r.result);});}
function records(index,k){return tx(['meta'],'readonly',(t,done)=>{const os=t.objectStore('meta'),r=index?os.index(index).getAll(k):os.getAll();r.onsuccess=()=>done(r.result);});}
function saveRecord(r,blob){return tx(['meta','bytes'],'readwrite',(t,done)=>{t.objectStore('meta').put(r);if(blob)t.objectStore('bytes').put(blob,r.key);done(r);});}
async function config(){return (await chrome.storage.local.get('config')).config||null;}
let syncRunning=false;
function pendingCount(){return tx(['meta'],'readonly',(t,done)=>{const r=t.objectStore('meta').index('state').count('pending');r.onsuccess=()=>done(r.result);});}
async function updateHealth(patch){const old=(await chrome.storage.local.get('syncHealth')).syncHealth||{};await chrome.storage.local.set({syncHealth:{...old,...patch}});}
async function state(){
 const c=await config(),pending=await pendingCount(),data=await chrome.storage.local.get(['lastSync','syncHealth']),health=data.syncHealth||{};
 return {connected:!!c,pending,mode:c?.mode||'',lastSync:data.lastSync||'',syncing:syncRunning,lastCheckedAt:health.lastCheckedAt||0,lastUploadedAt:health.lastUploadedAt||0,checkError:health.checkError||'',syncError:health.syncError||'',clientConfigured:!!chrome.runtime.getManifest().oauth2?.client_id};
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
async function list(t,q){let out=[],page;do{const p=new URLSearchParams({q:"trashed = false and ("+q+")",fields:'nextPageToken,files(id,name,mimeType,size,modifiedTime,parents,trashed)',pageSize:'1000',spaces:'drive'});if(page)p.set('pageToken',page);const r=await json(t,'/files?'+p);out.push(...(r.files||[]));page=r.nextPageToken;}while(page);return out;}
async function children(t,parent,extra){return list(t,qstr(parent)+' in parents'+(extra?' and '+extra:''));}
async function folder(t,parent,name,create=false){const matches=await children(t,parent,"mimeType = "+qstr(FOLDER)+" and name = "+qstr(name));if(matches.length>1)throw Error('重複資料夾 '+name+'；請至 Drive 整理');if(matches[0])return matches[0].id;if(!create)return null;const f=await json(t,'/files?fields=id,name',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,mimeType:FOLDER,parents:[parent]})});return f.id;}
async function checkRoot(t,c){const f=await json(t,'/files/'+encodeURIComponent(c.root)+'?fields=id,name,mimeType,trashed');if(f.trashed||f.mimeType!==FOLDER||f.name!==c.rootName)throw Error('指定資料夾名稱已變更或不存在，停止同步');}
async function videoDirs(t,c,vid){const dirs=[];const direct=await folder(t,c.root,vid);if(direct)dirs.push(direct);const legacy=await folder(t,c.root,'slides-v1');if(legacy){const v=await folder(t,legacy,vid);if(v)dirs.push(v);}return dirs;}
function cloudMeta(vid,r){return {key:key(vid,r.name),videoId:vid,name:r.name,size:Number(r.size)||0,modified:Date.parse(r.modifiedTime)||0,driveId:r.id,state:'cloud'};}
async function remoteVideo(t,c,vid){const result=new Map();for(const dir of await videoDirs(t,c,vid)){for(const r of await children(t,dir)){if(!NAME.test(r.name)||r.mimeType!=='image/png')continue;if(result.has(r.name)&&result.get(r.name).driveId!==r.id)throw Error('雲端同名 PNG 重複，請先整理');result.set(r.name,cloudMeta(vid,r));}}return [...result.values()];}
async function addRemote(r){const old=await read('meta',r.key);if(old?.state==='pending')return old;if(old?.driveId&&old.driveId!==r.driveId)throw Error('檔案識別變更，保留本機資料');
 // Do not silently label a different on-disk backup as the latest cloud file.
 if(old&&(old.modified!==r.modified||old.size!==r.size)&&await read('bytes',r.key))return old;
 const next={...r,title:old?.title||''};await saveRecord(next);return next;}
async function catalog(vid){
 const c=await config();let warning='';
 if(c)try{const t=await auth(c);await checkRoot(t,c);for(const r of await remoteVideo(t,c,vid))await addRemote(r);}catch(e){warning='雲端暫不可用，使用本機索引：'+e.message;}
 const local=await records('videoId',vid);return {files:local.map(r=>({name:r.name,size:r.size,modified:r.modified})),warning,state:await state()};
}
function decode64(raw){if(typeof raw!=='string'||raw.length>Math.ceil(LIMIT/3)*4+4)throw Error('PNG exceeds 24 MiB');const b=Uint8Array.from(atob(raw),v=>v.charCodeAt(0));if(b.length>LIMIT||b.slice(0,8).join(',')!=='137,80,78,71,13,10,26,10')throw Error('Invalid PNG');return new Blob([b],{type:'image/png'});}
async function encode64(blob){if(blob.size>LIMIT)throw Error('PNG exceeds 24 MiB');const b=new Uint8Array(await blob.arrayBuffer());let str='';for(let i=0;i<b.length;i+=32768)str+=String.fromCharCode(...b.subarray(i,i+32768));return btoa(str);}
async function equal(a,b){if(!a||a.size!==b.size)return false;const [x,y]=await Promise.all([crypto.subtle.digest('SHA-256',await a.arrayBuffer()),crypto.subtle.digest('SHA-256',await b.arrayBuffer())]);return new Uint8Array(x).every((v,i)=>v===new Uint8Array(y)[i]);}
async function put(m){const blob=decode64(m.data),k=key(m.videoId,m.name),old=await read('meta',k);if(old){const existing=await read('bytes',k);if(!existing||!await equal(existing,blob))throw Error('同名檔案已存在，未覆寫');return {saved:true};}
 await saveRecord({key:k,videoId:m.videoId,name:m.name,title:String(m.title||'').slice(0,350),size:blob.size,modified:Date.now(),state:'pending'},blob);return {saved:true};}
async function get(m){const k=key(m.videoId,m.name),r=await read('meta',k);if(!r)throw Error('檔案不在已建立的索引內');const local=await read('bytes',k);if(local)return {data:await encode64(local),modified:r.modified};
 if(!r.driveId)throw Error('本機檔案不存在');const c=await config(),t=await auth(c);await checkRoot(t,c);
 const allowed=await videoDirs(t,c,m.videoId),meta=await json(t,'/files/'+encodeURIComponent(r.driveId)+'?fields=id,name,mimeType,size,modifiedTime,parents,trashed');
 if(meta.trashed||meta.name!==m.name||meta.mimeType!=='image/png'||!meta.parents?.some(p=>allowed.includes(p)))throw Error('雲端檔案不在選定的影片資料夾');
 if(Number(meta.size)>LIMIT)throw Error('PNG exceeds 24 MiB');
 const downloaded=await (await fetchApi(t,API+'/files/'+encodeURIComponent(r.driveId)+'?alt=media')).blob();
 return {data:await encode64(downloaded),modified:Date.parse(meta.modifiedTime)||0};}
async function index(){const c=await config();let warning='';
 if(c)try{const t=await auth(c);await checkRoot(t,c);const roots=[c.root],legacy=await folder(t,c.root,'slides-v1');if(legacy)roots.push(legacy);const ids=new Set();
 for(const root of roots)for(const r of await children(t,root,'mimeType = '+qstr(FOLDER)))if(ID.test(r.name))ids.add(r.name);
 for(const vid of ids)for(const r of await remoteVideo(t,c,vid))await addRemote(r);
 }catch(e){warning='雲端索引更新未完整完成：'+e.message+'；保留本機資料';}
 const groups=new Map();for(const r of await records()){const x=groups.get(r.videoId)||{videoId:r.videoId,count:0,title:''};x.count++;if(r.title)x.title=r.title;groups.set(r.videoId,x);}return {rows:[...groups.values()],warning,state:await state()};}
async function connect(m){const current=await config(),mode=m.mode==='existing'?'existing':'new',scope=mode==='existing'?ALL_SCOPE:FILE_SCOPE,t=await token(scope,true),who=await owner(t);
 if(current){if(current.owner!==who||current.mode!==mode)throw Error('此安裝已綁定另一帳號／模式；不會轉送現有離線資料');await checkRoot(t,current);await updateHealth({lastCheckedAt:Date.now(),checkError:''});return state();}
 let root,rootName;
 if(mode==='existing'){const raw=String(m.folder||'').trim(),id=raw.match(/\/folders\/([A-Za-z0-9_-]+)/)?.[1]||raw;if(!/^[A-Za-z0-9_-]{10,150}$/.test(id))throw Error('請輸入 YouTube Slides 資料夾網址或 ID');
 const r=await json(t,'/files/'+encodeURIComponent(id)+'?fields=id,name,mimeType,trashed');if(r.trashed||r.mimeType!==FOLDER||r.name!=='YouTube Slides')throw Error('僅接受名稱正確的 YouTube Slides 資料夾');root=r.id;rootName=r.name;
 }else{rootName='YouTube Slides - API';root=await folder(t,'root',rootName,true);}
 await chrome.storage.local.set({config:{root,rootName,mode,scope,owner:who}});await updateHealth({lastCheckedAt:Date.now(),checkError:''});return state();}
async function uploadOne(t,c,r){const blob=await read('bytes',r.key);if(!blob)throw Error('找不到離線原圖');const dir=await folder(t,c.root,r.videoId,true),matches=await children(t,dir,'name = '+qstr(r.name));let uploaded;
 if(matches.length){if(matches.length!==1||matches[0].mimeType!=='image/png'||Number(matches[0].size)!==blob.size)throw Error('同名衝突，停止覆寫');const existing=await (await fetchApi(t,API+'/files/'+encodeURIComponent(matches[0].id)+'?alt=media')).blob();if(!await equal(existing,blob))throw Error('同名衝突，保留原始檔案');uploaded=matches[0];}
 else{const boundary='dg_'+crypto.randomUUID().replace(/-/g,'');const body=new Blob(['--'+boundary+'\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n'+JSON.stringify({name:r.name,mimeType:'image/png',parents:[dir]})+'\r\n--'+boundary+'\r\nContent-Type: image/png\r\n\r\n',blob,'\r\n--'+boundary+'--\r\n']);
 uploaded=await (await fetchApi(t,UPLOAD+'?uploadType=multipart&fields=id,name,size,modifiedTime',{method:'POST',headers:{'Content-Type':'multipart/related; boundary='+boundary},body})).json();if(!uploaded.id||uploaded.name!==r.name||Number(uploaded.size)!==blob.size)throw Error('Google Drive 未完整確認上傳');}
 await saveRecord({...r,state:'cloud',driveId:uploaded.id,modified:Date.parse(uploaded.modifiedTime)||r.modified});}
async function arm(){if(await config()&&!await chrome.alarms.get('slides-sync'))await chrome.alarms.create('slides-sync',{periodInMinutes:1});}
async function reconcileAlarm(){
 if(await pendingCount())await arm();else{await chrome.alarms.clear('slides-sync');if(await pendingCount())await arm();}
}
async function flush(checkWhenEmpty=false){
 const c=await config();if(!c)return state();
 const pending=await records('state','pending');
 if(!pending.length){await reconcileAlarm();if(checkWhenEmpty)await verifyConnection();return state();}
 syncRunning=true;let uploaded=0,verified=false;
 try{
  const t=await auth(c);await checkRoot(t,c);verified=true;
  await updateHealth({lastCheckedAt:Date.now(),checkError:''});
  for(const r of pending.slice(0,5)){await uploadOne(t,c,r);uploaded++;}
  await updateHealth({syncError:'',...(uploaded?{lastUploadedAt:Date.now()}:{})});
  await chrome.storage.local.set({lastSync:'同步批次完成 '+new Date().toLocaleString()});
 }catch(e){
  const message=String(e?.message||e).slice(0,240);
  await updateHealth({syncError:message,...(!verified?{checkError:message}:{}),...(uploaded?{lastUploadedAt:Date.now()}:{})});
  await chrome.storage.local.set({lastSync:'待同步：'+message});
 }finally{syncRunning=false;await reconcileAlarm();}
 return state();
}
chrome.alarms.onAlarm.addListener(a=>{if(a.name==='slides-sync')void queue(flush).catch(()=>{});});
const resumePending=()=>void queue(async()=>{if(await pendingCount())await arm();}).catch(()=>{});
chrome.runtime.onStartup.addListener(resumePending);
chrome.runtime.onInstalled.addListener(resumePending);
chrome.action.onClicked.addListener(()=>void chrome.runtime.openOptionsPage());
chrome.runtime.onMessage.addListener((m,sender,reply)=>{
 if(sender.id!==chrome.runtime.id||!m||typeof m.type!=='string')return false;
 const options=sender.url===chrome.runtime.getURL('options.html'),yt=/^https:\/\/(?:www|m)\.youtube\.com\//.test(sender.url||'');
 if(!options&&!yt)return false;if(['connect','syncNow','details','verify'].includes(m.type)&&!options)return false;
 if(['put','get','list'].includes(m.type)&&(!ID.test(m.videoId||'')||(['put','get'].includes(m.type)&&!NAME.test(m.name||'')))){reply({ok:false,error:'Invalid video or filename'});return false;}
 (async()=>{let data;switch(m.type){
 case 'status':data=await state();break;
 case 'details':data=await details();break;
 case 'verify':data=await queue(verifyConnection);break;
 case 'options':await chrome.runtime.openOptionsPage();data=true;break;
 case 'connect':data=await queue(()=>connect(m));await arm();void queue(flush).catch(()=>{});break;
 case 'put':data=await queueWrite(()=>put(m));try{await arm();}catch(_){}break;
 case 'list':data=await queue(()=>catalog(m.videoId));break;
 case 'get':data=await queue(()=>get(m));break;
 case 'index':data=await queue(index);break;
 case 'sync':data=await queue(flush);break;
 case 'syncNow':data=await queue(()=>flush(true));break;
 default:throw Error('Unsupported operation');}reply({ok:true,data});})().catch(e=>reply({ok:false,error:String(e.message||e).slice(0,240)}));return true;
});
