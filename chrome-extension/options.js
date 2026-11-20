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
function mode(){return document.querySelector('input[name="mode"]:checked').value;}
function updateFields(){$('existingFields').hidden=mode()!=='existing';}
function draw(s){
 snapshot=s;const [label,tone]=phase(s);
 $('connectionLabel').textContent=label;$('connectionBadge').dataset.tone=tone;
 $('pending').textContent=String(s.pending??0);$('uploadedAt').textContent=s.lastUploadedAt?formatTime(s.lastUploadedAt)+' · '+(s.lastUploadCount||1)+' 張':'尚無新版紀錄';
 $('checkedAt').textContent=s.lastCheckedAt?'最近檢查：'+formatTime(s.lastCheckedAt):'尚未檢查連線';
 $('folderSummary').hidden=!s.connected;$('loginCard').hidden=s.connected;$('reauth').hidden=!s.connected;
 $('folderName').textContent=s.rootName||'YouTube Slides';
 $('modeLabel').textContent=s.mode==='existing'?'既有資料夾 · 完整 Drive 授權':'專用資料夾 · 最小權限';
 if(/^[A-Za-z0-9_-]{10,150}$/.test(s.root||'')){$('folderLink').href='https://drive.google.com/drive/folders/'+s.root;$('folderLink').hidden=false;}else{$('folderLink').removeAttribute('href');$('folderLink').hidden=true;}
 for(const id of ['sync','verify','reauth'])$(id).disabled=busy||!s.connected||s.syncing;
 $('login').disabled=busy||!s.clientConfigured||s.connected;
 message($('health'),s.checkError||s.syncError?('最近錯誤：'+[s.checkError,s.syncError].filter((v,i,a)=>v&&a.indexOf(v)===i).join('；')+'。已寫入本機的圖片會保留，請檢查連線或重新授權。'):s.lastSync||'',!!(s.checkError||s.syncError));
}
async function display(){if(polling)return;polling=true;try{draw(await rpc('details'));}catch(e){if(!busy)message($('result'),e.message,true);}finally{polling=false;}}
async function run(type,data){
 if(busy)return;busy=true;if(snapshot)draw(snapshot);message($('result'),type==='connect'?'等待 Google 授權…':type==='verify'?'正在檢查 Google Drive…':'正在同步…');
 try{const s=await rpc(type,data);const d=await rpc('details');draw(d);if(type==='connect')message($('result'),'已綁定 Google Drive，回到 YouTube 即可使用。');else if(type==='verify')message($('result'),'連線與資料夾檢查成功。');else message($('result'),s.syncError||s.checkError?'同步尚未完成，請查看最近錯誤。':s.pending?'已完成本次批次，剩餘 '+s.pending+' 張將繼續補傳。':'無待同步圖片。',!!(s.syncError||s.checkError));}
 catch(e){message($('result'),e.message,true);}
 finally{busy=false;if(snapshot)draw(snapshot);await display();}
}
for(const el of document.querySelectorAll('input[name="mode"]'))el.addEventListener('change',updateFields);
$('login').onclick=()=>{const m=mode();if(m==='existing'&&(!$('confirm').checked||!$('folder').value.trim())){message($('result'),'請填寫資料夾網址並確認授權。',true);return;}void run('connect',{mode:m,folder:$('folder').value.trim()});};
$('reauth').onclick=()=>{if(snapshot?.connected)void run('connect',{mode:snapshot.mode});};
$('sync').onclick=()=>void run('syncNow');
$('verify').onclick=()=>void run('verify');
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
updateFields();void display();
document.addEventListener('visibilitychange',()=>{if(!document.hidden)void display();});
setInterval(()=>{if(!document.hidden)void display();},5000);
