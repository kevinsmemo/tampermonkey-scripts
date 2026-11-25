'use strict';
const $=id=>document.getElementById(id);
const version=chrome.runtime.getManifest().version;
$('version').textContent='v'+version;
let snapshot=null,busy=false,polling=false,updateBusy=false,cacheBusy=false,lastStats=null;

async function rpc(type,data={}){
 const r=await chrome.runtime.sendMessage({type,...data});
 if(!r?.ok)throw Error(r?.error||'連線失敗');
 return r.data;
}
function formatTime(n){return Number.isFinite(n)&&n>0?new Date(n).toLocaleString('zh-TW',{hour12:false}):'';}
function formatBytes(n){
 if(!Number.isFinite(n)||n<=0)return '0 MB';
 if(n<1024*1024)return (n/1024).toFixed(1)+' KB';
 return (n/(1024*1024)).toFixed(1)+' MB';
}
function phase(s){
 if(!s.clientConfigured)return ['設定缺失','bad'];
 if(!s.connected)return ['尚未登入','neutral'];
 if(s.syncing)return ['同步中','warn'];
 if(s.checkError||s.syncError)return ['需檢查同步','bad'];
 if(s.pending)return ['等待同步','warn'];
 return s.lastCheckedAt?['已同步','good']:['已綁定 · 待檢查','neutral'];
}
function message(el,text,error=false){el.textContent=text||'';el.dataset.error=String(error);}

function selectLoginChoice(which){
 $('choiceAuto').dataset.selected=String(which==='auto');
 $('choiceExisting').dataset.selected=String(which==='existing');
 $('autoBody').hidden=which!=='auto';
 $('existingBody').hidden=which!=='existing';
}
$('choiceAuto').onclick=()=>selectLoginChoice('auto');
$('choiceExisting').onclick=()=>selectLoginChoice('existing');

function syncCacheButtons(){
 $('refreshCache').disabled=cacheBusy;
 $('clearCache').disabled=cacheBusy||!!snapshot?.syncing||!(lastStats?.cachedCloudCount>0);
 $('rebuildIndex').disabled=cacheBusy||!snapshot?.connected||!!snapshot?.syncing;
}

function draw(s){
 snapshot=s;const [label,tone]=phase(s);
 $('connectionLabel').textContent=label;$('connectionBadge').dataset.tone=tone;
 $('pending').textContent=String(s.pending??0);
 $('uploadedAt').textContent=s.lastUploadedAt?formatTime(s.lastUploadedAt)+' · '+(s.lastUploadCount||1)+' 張':'尚無紀錄';
 $('checkedAt').textContent=s.lastCheckedAt?'最近檢查：'+formatTime(s.lastCheckedAt):'尚未檢查連線';

 $('connectedCard').hidden=!s.connected;
 $('loginCard').hidden=s.connected;
 $('folderSummary').hidden=!s.connected;
 $('reauth').hidden=!s.connected;
 $('logout').hidden=!s.connected;
 $('switchRow').hidden=!s.connected;
 $('namingRow').hidden=!s.connected;

 $('folderName').textContent='📁 '+(s.rootName||'YouTube Slides');
 $('modeLabel').textContent=s.mode==='existing'?'同步資料夾 · 手動指定':'同步資料夾 · 自動連線';
 if(/^[A-Za-z0-9_-]{10,150}$/.test(s.root||'')){
  $('folderLink').href='https://drive.google.com/drive/folders/'+s.root;
  $('folderLink').hidden=false;
 }else{
  $('folderLink').removeAttribute('href');
  $('folderLink').hidden=true;
 }
 for(const id of ['sync','verify','reauth','logout'])$(id).disabled=busy||!s.connected||s.syncing;
 $('login').disabled=busy||!s.clientConfigured||s.connected;
 $('connectExisting').disabled=busy||!s.clientConfigured||s.connected;
 $('switchConnect').disabled=busy||!s.clientConfigured||!s.connected||s.syncing;
 $('createNew').disabled=busy||!s.clientConfigured||s.connected;
 $('useVisible').disabled=busy||!s.clientConfigured||s.connected;

 message($('health'),s.checkError||s.syncError?('最近錯誤：'+[s.checkError,s.syncError].filter((v,i,a)=>v&&a.indexOf(v)===i).join('；')+'。已寫入本機的圖片會保留，請檢查連線或重新授權。'):s.lastSync||'',!!(s.checkError||s.syncError));
 syncCacheButtons();
 namingButtons();
}

async function display(){
 if(polling)return;polling=true;
 try{draw(await rpc('details'));}
 catch(e){if(!busy)message($('result'),e.message,true);}
 finally{polling=false;}
}

async function run(type,data){
 if(busy)return;busy=true;if(snapshot)draw(snapshot);
 const msgEl=snapshot?.connected?$('result'):$('loginResult');
 message(msgEl,type==='connect'?'等待 Google 授權…':type==='reauthorize'?'正在重新授權…':type==='logout'?'正在登出 Google Drive…':type==='verify'?'正在檢查 Google Drive…':'正在同步…');
 try{
  const s=await rpc(type,data);const d=await rpc('details');draw(d);
  const outEl=d.connected?$('result'):$('loginResult');
  if(type==='connect'){
   if(s.setupAction==='pickCandidate'&&Array.isArray(s.candidates)){
    $('noFolderChoices').hidden=false;
    $('createNew').hidden=true;
    $('useVisible').hidden=true;
    const list=$('candidateList');list.replaceChildren();
    for(const item of s.candidates){
     const row=document.createElement('div');row.className='row spread';
     row.style.cssText='padding:8px 10px;border:1px solid var(--border);border-radius:8px;background:var(--surface)';
     const info=document.createElement('div');
     const title=document.createElement('strong');title.textContent='📁 '+item.name;
     const meta=document.createElement('div');meta.className='muted';meta.textContent=`內含 ${item.itemCount} 個項目`;
     info.append(title,meta);
     const acts=document.createElement('div');acts.className='row';acts.style.gap='6px';
     const open=document.createElement('a');open.href='https://drive.google.com/drive/folders/'+encodeURIComponent(item.id);
     open.target='_blank';open.rel='noopener noreferrer';open.textContent='檢視 ↗';open.onclick=ev=>ev.stopPropagation();
     const pick=document.createElement('button');pick.type='button';pick.className='primary';pick.textContent='連接此資料夾';
     pick.onclick=ev=>{ev.stopPropagation();void run('connect',{mode:'useVisible',folder:item.id});};
     acts.append(open,pick);row.append(info,acts);list.append(row);
    }
    message($('noFolderMessage'),'找到多個「YouTube Slides」資料夾，請選擇要連接的那一個：');
    message(outEl,'請從上方選擇原本使用的資料夾。');
   }else if(s.setupAction==='needsChoice'){
    $('noFolderChoices').hidden=false;
    $('candidateList').replaceChildren();
    $('createNew').hidden=false;
    $('useVisible').hidden=true;
    message($('noFolderMessage'),'Google Drive 內尚未找到名為「YouTube Slides」的資料夾。你可以建立新的，或點下方手動貼上其他名稱的資料夾網址。');
    message(outEl,'未找到同名資料夾；請選擇建立新的或手動指定。');
   }else{
    $('noFolderChoices').hidden=true;
    $('candidateList').replaceChildren();
    message(outEl,s.setupAction==='created'?'已建立新的 YouTube Slides 資料夾。':s.setupAction==='switched'?'已安全改連至指定的既有資料夾；原資料夾沒有被移動或刪除。':s.setupAction==='found'?'已自動找到 YouTube Slides 資料夾並完成連線。':'已綁定 Google Drive，回到 YouTube 即可使用。');
   }
  }else if(type==='logout'){
   message(outEl,s.credentialError?'已停止雲端同步、保留本機圖片，但清除授權快取失敗：'+s.credentialError:'已登出 Google Drive。本機圖片與待同步資料仍完整保留。',!!s.credentialError);
  }else if(type==='reauthorize'){
   message(outEl,'已完成 Google 帳號重新授權及資料夾驗證。');
  }else if(type==='verify'){
   message(outEl,'連線與資料夾檢查正常。');
  }else{
   message(outEl,s.syncError||s.checkError?'同步尚未完成，請查看最近錯誤。':s.pending?'已完成本次批次，剩餘 '+s.pending+' 張將繼續補傳。':'無待同步圖片。',!!(s.syncError||s.checkError));
  }
 }catch(e){
  message(snapshot?.connected?$('result'):$('loginResult'),e.message,true);
 }finally{
  busy=false;if(snapshot)draw(snapshot);await display();
 }
}

$('login').onclick=ev=>{ev.stopPropagation();void run('connect',{mode:'auto'});};
$('connectExisting').onclick=ev=>{
 ev.stopPropagation();
 if(!$('confirm').checked||!$('folder').value.trim()){
  message($('loginResult'),'請先填入資料夾網址並勾選同意授權。',true);return;
 }
 void run('connect',{mode:'existing',folder:$('folder').value.trim(),replaceExisting:false});
};
$('switchConnect').onclick=()=>{
 if(!$('switchConfirm').checked||!$('switchFolder').value.trim()){
  message($('result'),'請先填入新資料夾網址並勾選同意授權。',true);return;
 }
 if(!confirm('將目前綁定的資料夾改為指定資料夾？\n\n只允許原資料夾為空白且沒有待同步圖片時切換。程式不會自動合併、搬移或刪除任何 Google Drive 檔案。'))return;
 void run('connect',{mode:'existing',folder:$('switchFolder').value.trim(),replaceExisting:true});
};
$('useVisible').onclick=ev=>{ev.stopPropagation();const folder=$('useVisible').dataset.folder;if(folder)void run('connect',{mode:'useVisible',folder});};
$('createNew').onclick=ev=>{ev.stopPropagation();if(confirm('確定要建立全新的 YouTube Slides 資料夾？\n\n只有確認原本沒有使用中的資料夾時才應建立；此動作可能造成重複資料夾。'))void run('connect',{mode:'create'});};
$('reauth').onclick=()=>{if(snapshot?.connected)void run('reauthorize');};
$('logout').onclick=()=>{
 if(!snapshot?.connected||snapshot.syncing)return;
 const pending=snapshot.pending||0;
 const notice='確定登出 Google Drive？\n\n登出只會停止本套件的雲端連線，不會刪除 Google Drive 檔案或此裝置保存的 PNG。'+(pending?'\n\n此裝置還有 '+pending+' 張待同步圖片；重新登入必須使用原 Google 帳號及原資料夾才能續傳。':'');
 if(confirm(notice))void run('logout');
};
$('sync').onclick=()=>void run('syncNow');
$('verify').onclick=()=>void run('verify');

// 舊資料夾改名
let namingPreview=null,namingWorking=false;
function namingButtons(){
 $('previewNames').disabled=namingWorking||!snapshot?.connected;
 const hasRows=namingPreview?.folders?.length>0;
 $('migrateNames').disabled=namingWorking||!snapshot?.connected||!!snapshot?.pending||!hasRows;
}
function renderNaming(data){
 namingPreview=data;const target=$('namingList');target.replaceChildren();
 const count=data.folders.length;
 $('namingStatus').textContent=count?('找到 '+count+' 個舊資料夾；可直接改名 '+data.ready+' 個。缺少標題的可在下方補填。'):'沒有需要更名的舊資料夾。';
 for(const item of data.folders){
  const label=document.createElement('label');label.style.display='block';
  const caption=document.createElement('small');caption.textContent='原資料夾：'+item.videoId;
  const input=document.createElement('input');input.className='field';input.style.margin='4px 0 0';input.maxLength=350;
  input.placeholder='輸入影片標題';input.value=item.title||'';input.dataset.videoId=item.videoId;
  label.append(caption,input);target.append(label);
 }
 namingButtons();
}
$('previewNames').onclick=async()=>{
 if(namingWorking)return;namingWorking=true;namingButtons();message($('namingStatus'),'讀取雲端資料夾索引…');
 try{renderNaming(await rpc('previewNames'));}
 catch(e){message($('namingStatus'),'檢查失敗：'+e.message,true);}
 finally{namingWorking=false;namingButtons();}
};
$('migrateNames').onclick=async()=>{
 if(namingWorking||!namingPreview||snapshot?.pending)return;
 const titles={};let selected=0;
 for(const input of $('namingList').querySelectorAll('input[data-video-id]')){
  if(input.value.trim()){titles[input.dataset.videoId]=input.value.trim();selected++;}
 }
 if(!selected){message($('namingStatus'),'請先填入至少一部影片的標題。',true);return;}
 if(!confirm('確定重新命名 '+selected+' 個舊資料夾？此操作不會移動或刪除圖片。'))return;
 namingWorking=true;namingButtons();message($('namingStatus'),'正在逐一重新命名…');
 try{
  const result=await rpc('migrateNames',{titles});
  renderNaming(await rpc('previewNames'));
  message($('namingStatus'),'已重新命名 '+result.renamed+' 個資料夾；另有 '+result.skipped+' 個尚未處理。');
 }catch(e){message($('namingStatus'),'整理中斷：'+e.message,true);}
 finally{namingWorking=false;namingButtons();await display();}
};

// 套件更新檢查
function compareVersion(a,b){if(!/^\d+(?:\.\d+){1,3}$/.test(a)||!/^\d+(?:\.\d+){1,3}$/.test(b))throw Error('無法辨識版本格式');const aa=a.split('.').map(Number),bb=b.split('.').map(Number);for(let i=0;i<Math.max(aa.length,bb.length);i++){const n=(aa[i]||0)-(bb[i]||0);if(n)return Math.sign(n);}return 0;}
$('checkUpdate').onclick=async()=>{
 if(updateBusy)return;updateBusy=true;$('checkUpdate').disabled=true;message($('updateResult'),'正在檢查版本…');
 try{
  const granted=await chrome.permissions.request({origins:['https://raw.githubusercontent.com/*']});
  if(!granted){message($('updateResult'),'未授權讀取 GitHub 版本資訊，可直接下載 ZIP。');return;}
  const response=await fetch('https://raw.githubusercontent.com/kevinsmemo/tampermonkey-scripts/chrome-extension-alpha/chrome-extension/manifest.json',{cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(12000)});
  if(!response.ok)throw Error('GitHub HTTP '+response.status);const info=await response.json();
  if(info.manifest_version!==3||info.name!==chrome.runtime.getManifest().name||typeof info.version!=='string')throw Error('無法辨識遠端套件');
  const cmp=compareVersion(info.version,version);
  message($('updateResult'),cmp>0?'有新版 v'+info.version+'，請下載 ZIP 並覆蓋更新。':cmp===0?'目前已是最新版 v'+version+'。':'目前版本較遠端版本新。');
 }catch(e){message($('updateResult'),'檢查失敗：'+e.message,true);}
 finally{updateBusy=false;$('checkUpdate').disabled=false;}
};

// 本機空間與索引修復
async function refreshStorageStats(){
 if(cacheBusy)return;cacheBusy=true;syncCacheButtons();
 try{
  const st=await rpc('storageStats');lastStats=st;
  $('cachedCloudSize').textContent=formatBytes(st.cachedCloudBytes);
  $('cachedCloudCount').textContent=`${st.cachedCloudCount} 張本機快取（雲端總紀錄 ${st.cloudCount} 張）`;
  $('pendingSize').textContent=formatBytes(st.pendingBytes);
  $('pendingBytesNote').textContent=st.pendingCount?`${st.pendingCount} 張待上傳，清理時完整保留`:'目前無待同步原圖';
 }catch(e){
  message($('cacheResult'),'讀取本機快取失敗：'+e.message,true);
 }finally{cacheBusy=false;syncCacheButtons();}
}
$('refreshCache').onclick=()=>void refreshStorageStats();
$('clearCache').onclick=async()=>{
 if(cacheBusy||!lastStats?.cachedCloudCount)return;
 if(!confirm(`確定清理 ${lastStats.cachedCloudCount} 張已同步的本機快取（約 ${formatBytes(lastStats.cachedCloudBytes)}）？\n\n此操作不會刪除任何 Google Drive 雲端檔案，也不會影響待同步圖片。`))return;
 cacheBusy=true;syncCacheButtons();message($('cacheResult'),'正在清理已同步本機快取…');
 try{
  const res=await rpc('clearSyncedCache');lastStats=res.stats;
  $('cachedCloudSize').textContent=formatBytes(res.stats.cachedCloudBytes);
  $('cachedCloudCount').textContent=`${res.stats.cachedCloudCount} 張本機快取（雲端總紀錄 ${res.stats.cloudCount} 張）`;
  $('pendingSize').textContent=formatBytes(res.stats.pendingBytes);
  message($('cacheResult'),`已安全清理 ${res.clearedCount} 張本機快取，釋放約 ${formatBytes(res.clearedBytes)}。`);
 }catch(e){
  message($('cacheResult'),'清理失敗：'+e.message,true);
 }finally{cacheBusy=false;syncCacheButtons();}
};
$('rebuildIndex').onclick=async()=>{
 if(cacheBusy||!snapshot?.connected)return;
 if(!confirm('完整修復會重新掃描 Google Drive 內所有影片資料夾與 PNG 檔名，並重建 index.json 與 INDEX.md。確定繼續？'))return;
 cacheBusy=true;syncCacheButtons();message($('rebuildResult'),'正在完整掃描 Google Drive 並重建索引…');
 try{
  const res=await rpc('rebuildIndex');
  message($('rebuildResult'),res.warning||`已完成完整修復，共索引 ${res.rows?.length||0} 部影片。`,!!res.warning);
 }catch(e){
  message($('rebuildResult'),'完整修復失敗：'+e.message,true);
 }finally{cacheBusy=false;syncCacheButtons();await display();}
};

void display();namingButtons();void refreshStorageStats();
document.addEventListener('visibilitychange',()=>{if(!document.hidden){void display();void refreshStorageStats();}});
setInterval(()=>{if(!document.hidden)void display();},5000);
