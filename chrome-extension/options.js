'use strict';
const $=id=>document.getElementById(id);
async function rpc(type,data={}){const r=await chrome.runtime.sendMessage({type,...data});if(!r?.ok)throw Error(r?.error||'連線失敗');return r.data;}
async function display(){const s=await rpc('status');$('status').textContent=(s.clientConfigured?'OAuth 已設定':'尚未填入 OAuth Client ID；請開啟本機 setup.html')+'\n'+(s.connected?'Google Drive 已綁定（'+s.mode+'）':'尚未連接；仍可離線擷取')+' · 待同步 '+s.pending+' 張\n'+s.lastSync;$('existing').disabled=!s.clientConfigured||(s.connected&&s.mode!=='existing');$('new').disabled=!s.clientConfigured||(s.connected&&s.mode!=='new');}
async function run(type,data){$('result').textContent='處理中…';for(const id of ['existing','new','sync'])$(id).disabled=true;try{const s=await rpc(type,data);$('result').textContent=s?.lastSync||'設定已更新；請回 YouTube 重新讀取。';}catch(e){$('result').textContent=e.message;}finally{$('sync').disabled=false;await display().catch(e=>$('status').textContent=e.message);}}
$('existing').onclick=()=>{if(!$('confirm').checked||!$('folder').value.trim()){$('result').textContent='請確認權限及資料夾網址。';return;}void run('connect',{mode:'existing',folder:$('folder').value});};
$('new').onclick=()=>void run('connect',{mode:'new'});
$('sync').onclick=()=>void run('syncNow');
$('refresh').onclick=()=>void display().catch(e=>$('result').textContent=e.message);
void display().catch(e=>$('result').textContent=e.message);