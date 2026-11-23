'use strict';
const $=id=>document.getElementById(id);
const version=chrome.runtime.getManifest().version;
$('version').textContent='v'+version;
let snapshot=null,busy=false,polling=false,updateBusy=false;
async function rpc(type,data={}){const r=await chrome.runtime.sendMessage({type,...data});if(!r?.ok)throw Error(r?.error||'連線失敗');return r.data;}
function formatTime(n){return Number.isFinite(n)&&n>0?new Date(n).toLocaleString('zh-TW',{hour12:false}):'';}
function phase(s){
 if(!s.clientConfigured)return ['設定缺失','bad'];
 if(!s.connected)return ['尚未登入','neutral'];
 if(s.syncing)return ['同步中','warn'];
 if(s.checkError||s.syncError)return ['需檢查同步','bad'];
 if(s.pending)return ['等待同步','warn'];
 return s.lastCheckedAt?['已綁定 · 無待傳','good']:['已綁定 · 待檢查','neutral'];
}
function message(el,text,error=false){el.textContent=text||'';el.dataset.error=String(error);}
function draw(s){
 snapshot=s;const [label,tone]=phase(s);
 $('connectionLabel').textContent=label;$('connectionBadge').dataset.tone=tone;
 $('pending').textContent=String(s.pending??0);$('uploadedAt').textContent=s.lastUploadedAt?formatTime(s.lastUploadedAt)+' · '+(s.lastUploadCount||1)+' 張':'尚無新版紀錄';
 $('checkedAt').textContent=s.lastCheckedAt?'最近檢查：'+formatTime(s.lastCheckedAt):'尚未檢查連線';
 $('folderSummary').hidden=!s.connected;$('loginCard').hidden=s.connected;$('reauth').hidden=!s.connected;$('namingCard').hidden=!s.connected;
 $('folderName').textContent=s.rootName||'YouTube Slides';
 $('modeLabel').textContent=s.mode==='existing'?'指定資料夾 · 完整 Drive 授權':s.mode==='auto'?'自動設定 · 最小權限':'專用資料夾 · 最小權限';
 if(/^[A-Za-z0-9_-]{10,150}$/.test(s.root||'')){$('folderLink').href='https://drive.google.com/drive/folders/'+s.root;$('folderLink').hidden=false;}else{$('folderLink').removeAttribute('href');$('folderLink').hidden=true;}
 for(const id of ['sync','verify','reauth'])$(id).disabled=busy||!s.connected||s.syncing;
 $('login').disabled=busy||!s.clientConfigured||s.connected;
 $('connectExisting').disabled=busy||!s.clientConfigured||s.syncing;
 $('connectExisting').textContent=s.connected?'檢查並切換至指定資料夾':'連接指定資料夾';
 $('createNew').disabled=busy||!s.clientConfigured||s.connected;
 $('useVisible').disabled=busy||!s.clientConfigured||s.connected;
 message($('health'),s.checkError||s.syncError?('最近錯誤：'+[s.checkError,s.syncError].filter((v,i,a)=>v&&a.indexOf(v)===i).join('；')+'。已寫入本機的圖片會保留，請檢查連線或重新授權。'):s.lastSync||'',!!(s.checkError||s.syncError));
}
async function display(){if(polling)return;polling=true;try{draw(await rpc('details'));}catch(e){if(!busy)message($('result'),e.message,true);}finally{polling=false;}}
async function run(type,data){
 if(busy)return;busy=true;if(snapshot)draw(snapshot);message($('result'),type==='connect'?'等待 Google 授權…':type==='verify'?'正在檢查 Google Drive…':'正在同步…');
 try{const s=await rpc(type,data);const d=await rpc('details');draw(d);if(type==='connect'){
   if(s.setupAction==='needsChoice'){
    $('noFolderChoices').hidden=false;
    $('createNew').hidden=!!s.emptyCandidate;
    $('useVisible').hidden=!s.emptyCandidate;
    $('useVisible').dataset.folder=s.emptyCandidate||'';
    $('advancedSetup').open=true;
    message($('noFolderMessage'),s.emptyCandidate?'找到一個可存取但空白的同名資料夾；可能是之前誤建立的資料夾。請優先指定原本的 Google Drive 資料夾，不要再建立新資料夾。':'最小權限無法確認你是否已經有資料夾。請優先指定原資料夾；只有確認是全新使用者才建立。');
    message($('result'),'沒有自動建立資料夾；請先選擇連接既有資料夾或明確建立新的。');
   }else{
    $('noFolderChoices').hidden=true;
    message($('result'),s.setupAction==='created'?'已建立新的 YouTube Slides 資料夾。':s.setupAction==='switched'?'已安全改連至指定的既有資料夾；原資料夾沒有被移動或刪除。':s.setupAction==='found'?'已找到可存取的 YouTube Slides 資料夾並完成連線。':'已綁定 Google Drive，回到 YouTube 即可使用。');
   }
  }else if(type==='verify')message($('result'),'連線與資料夾檢查成功。');else message($('result'),s.syncError||s.checkError?'同步尚未完成，請查看最近錯誤。':s.pending?'已完成本次批次，剩餘 '+s.pending+' 張將繼續補傳。':'無待同步圖片。',!!(s.syncError||s.checkError));}
 catch(e){message($('result'),e.message,true);}
 finally{busy=false;if(snapshot)draw(snapshot);await display();}
}
$('login').onclick=()=>void run('connect',{mode:'auto'});
$('connectExisting').onclick=()=>{
 if(!$('confirm').checked||!$('folder').value.trim()){
  message($('result'),'請先填入資料夾網址並確認完整 Drive 授權。',true);return;
 }
 const switching=!!snapshot?.connected;
 if(switching&&!confirm('將目前綁定的資料夾改為指定資料夾？\n\n只允許原資料夾為空白且沒有待同步圖片時切換。程式不會自動合併、搬移或刪除任何 Google Drive 檔案。'))return;
 void run('connect',{mode:'existing',folder:$('folder').value.trim(),replaceExisting:switching});
};
$('useVisible').onclick=()=>{const folder=$('useVisible').dataset.folder;if(folder)void run('connect',{mode:'useVisible',folder});};
$('createNew').onclick=()=>{if(confirm('確定要建立全新的 YouTube Slides 資料夾？\n\n只有確認原本沒有使用中的資料夾時才應建立；此動作可能造成重複資料夾。'))void run('connect',{mode:'create'});};
$('reauth').onclick=()=>{if(snapshot?.connected)void run('connect',{mode:snapshot.mode});};
$('sync').onclick=()=>void run('syncNow');
$('verify').onclick=()=>void run('verify');
let namingPreview=null,namingWorking=false;
function namingButtons(){
 $('previewNames').disabled=namingWorking||!snapshot?.connected;
 const hasRows=namingPreview?.folders?.length>0;
 $('migrateNames').disabled=namingWorking||!snapshot?.connected||!!snapshot?.pending||!hasRows;
}
function renderNaming(data){
 namingPreview=data;const target=$('namingList');target.replaceChildren();
 const count=data.folders.length;
 $('namingStatus').textContent=count?('找到 '+count+' 個舊資料夾；可直接改名 '+data.ready+' 個。缺少標題的可以在下方填入名稱。'):'沒有需要更名的舊資料夾。';
 for(const item of data.folders){
  const label=document.createElement('label');label.className='field';label.style.margin='0';
  const caption=document.createElement('small');caption.textContent='原資料夾：'+item.videoId;
  const input=document.createElement('input');input.className='field';input.style.margin='5px 0 0';input.maxLength=350;
  input.placeholder='輸入影片標題';input.value=item.title||'';input.dataset.videoId=item.videoId;
  label.append(caption,input);target.append(label);
 }
 namingButtons();
}
$('previewNames').onclick=async()=>{
 if(namingWorking)return;namingWorking=true;namingButtons();message($('namingStatus'),'讀取雲端資料夾索引…');
 try{const data=await rpc('previewNames');renderNaming(data);}
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
 if(!confirm('確定重新命名 '+selected+' 個候選資料夾？此操作不會移動或刪除圖片，但舊版擴充套件可能無法辨識新資料夾。'))return;
 namingWorking=true;namingButtons();message($('namingStatus'),'正在逐一重新命名…');
 try{
  const result=await rpc('migrateNames',{titles});
  const data=await rpc('previewNames');renderNaming(data);
  message($('namingStatus'),'已重新命名 '+result.renamed+' 個資料夾；另有 '+result.skipped+' 個尚未處理。');
 }catch(e){message($('namingStatus'),'整理中斷：'+e.message+'。可重新檢查確認剩餘資料夾。',true);}
 finally{namingWorking=false;namingButtons();await display();}
};
function compareVersion(a,b){if(!/^\d+(?:\.\d+){1,3}$/.test(a)||!/^\d+(?:\.\d+){1,3}$/.test(b))throw Error('無法辨識版本格式');const aa=a.split('.').map(Number),bb=b.split('.').map(Number);for(let i=0;i<Math.max(aa.length,bb.length);i++){const n=(aa[i]||0)-(bb[i]||0);if(n)return Math.sign(n);}return 0;}
$('checkUpdate').onclick=async()=>{
 if(updateBusy)return;updateBusy=true;$('checkUpdate').disabled=true;message($('updateResult'),'正在檢查版本…');
 try{
  const granted=await chrome.permissions.request({origins:['https://raw.githubusercontent.com/*']});
  if(!granted){message($('updateResult'),'未授權讀取 GitHub 版本資訊，可直接下載 ZIP。');return;}
  const response=await fetch('https://raw.githubusercontent.com/kevinsmemo/tampermonkey-scripts/chrome-extension-alpha/chrome-extension/manifest.json',{cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(12000)});
  if(!response.ok)throw Error('GitHub HTTP '+response.status);const info=await response.json();
  if(info.manifest_version!==3||info.name!==chrome.runtime.getManifest().name||typeof info.version!=='string')throw Error('無法辨識遠端套件');
  const cmp=compareVersion(info.version,version);message($('updateResult'),cmp>0?'有新版 v'+info.version+'，請下載 ZIP 並覆蓋更新。':cmp===0?'目前已是最新版 v'+version+'。':'目前版本較遠端版本新。');
 }catch(e){message($('updateResult'),'檢查失敗：'+e.message,true);}
 finally{updateBusy=false;$('checkUpdate').disabled=false;}
};
void display();namingButtons();
document.addEventListener('visibilitychange',()=>{if(!document.hidden)void display();});
setInterval(()=>{if(!document.hidden)void display();},5000);
