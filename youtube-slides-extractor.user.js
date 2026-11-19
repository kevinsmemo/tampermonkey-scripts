// ==UserScript==
// @name         YouTube Slides Extractor - Digital Garden
// @namespace    https://github.com/kevinsmemo/digitalgarden
// @version      0.2.4
// @description  Local, automatic keyframe capture with timestamps, Obsidian Markdown and ZIP export.
// @match        https://www.youtube.com/*
// @match        https://m.youtube.com/*
// @grant        none
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/kevinsmemo/tampermonkey-scripts/main/youtube-slides-extractor.user.js
// @downloadURL  https://raw.githubusercontent.com/kevinsmemo/tampermonkey-scripts/main/youtube-slides-extractor.user.js
// @noframes
// ==/UserScript==
(() => {
  'use strict';
  const W=160,H=90,MAX=500;
  const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
  const stamp=t=>{const s=Math.max(0,Math.floor(t));return [Math.floor(s/3600),Math.floor(s/60)%60,s%60].map(n=>String(n).padStart(2,'0')).join(':');};
  const idOf=(url)=>{const u=new URL(url);const id=u.searchParams.get('v')||u.pathname.match(/^\/(?:live|shorts)\/([\w-]{11})(?:\/|$)/)?.[1];return /^[\w-]{11}$/.test(id||'')?id:null;};
  function signature(rgba){const out=new Uint8Array(rgba.length/4*3);for(let i=0,j=0;i<rgba.length;i+=4,j+=3){out[j]=Math.round(.299*rgba[i]+.587*rgba[i+1]+.114*rgba[i+2]);out[j+1]=clamp(Math.round(128+(rgba[i]-rgba[i+1])/2),0,255);out[j+2]=clamp(Math.round(128+(rgba[i+2]-rgba[i+1])/2),0,255);}return out;}
  function distance(a,b){if(!a||!b||a.length!==b.length)return 1;let sum=0,changed=0;for(let i=0;i<a.length;i+=3){const d=Math.abs(a[i]-b[i]);sum+=d+.3*(Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2]));if(d>24||Math.abs(a[i+1]-b[i+1])>20||Math.abs(a[i+2]-b[i+2])>20)changed++;}const n=a.length/3;return .65*sum/(255*1.6*n)+.35*changed/n;}
  function decide(prev,curr,frames,threshold){return !!prev&&distance(prev,curr)<=Math.min(.025,threshold*.55)&&!frames.some(f=>distance(f.sig,curr)<threshold);}
  const encoder=new TextEncoder();
  const crcTable=Uint32Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=(n&1)?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
  function crc32(b){let c=0xffffffff;for(const x of b)c=crcTable[(c^x)&255]^(c>>>8);return (c^0xffffffff)>>>0;}
  async function zip(files){let offset=0,centralSize=0;const parts=[],central=[];for(const f of files){const name=encoder.encode(f.name),data=typeof f.data==='string'?encoder.encode(f.data):new Uint8Array(await f.data.arrayBuffer());const crc=crc32(data);const local=new Uint8Array(30+name.length);const l=new DataView(local.buffer);l.setUint32(0,0x04034b50,true);l.setUint16(4,20,true);l.setUint16(6,0x800,true);l.setUint16(12,33,true);l.setUint32(14,crc,true);l.setUint32(18,data.length,true);l.setUint32(22,data.length,true);l.setUint16(26,name.length,true);local.set(name,30);parts.push(local,data);const c=new Uint8Array(46+name.length);const v=new DataView(c.buffer);v.setUint32(0,0x02014b50,true);v.setUint16(4,20,true);v.setUint16(6,20,true);v.setUint16(8,0x800,true);v.setUint16(14,33,true);v.setUint32(16,crc,true);v.setUint32(20,data.length,true);v.setUint32(24,data.length,true);v.setUint16(28,name.length,true);v.setUint32(42,offset,true);c.set(name,46);central.push(c);centralSize+=c.length;offset+=local.length+data.length;}const end=new Uint8Array(22);const e=new DataView(end.buffer);e.setUint32(0,0x06054b50,true);e.setUint16(8,files.length,true);e.setUint16(10,files.length,true);e.setUint32(12,centralSize,true);e.setUint32(16,offset,true);return new Blob([...parts,...central,end],{type:'application/zip'});}
  function exportName(session){
  const raw=String(session.title||'').normalize('NFC').replace(/\s*-\s*YouTube\s*$/i,'').trim();
  const title=raw.replace(/^(\d{4})[\/.-](\d{1,2})[\/.-](\d{1,2})(?:\s*[（(][一二三四五六日天][）)])?/,(_,y,m,d)=>`${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}_`).replace(/[【\[]早晨財經速解讀[】\]]/g,'_早晨財經速解讀').replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g,'_').replace(/\s+/g,'_').replace(/_+/g,'_').replace(/^[. _]+|[. _]+$/g,'');
  const base=Array.from(title||'YouTube').slice(0,55).join('').replace(/[. _]+$/g,'')||'YouTube';
  return `${base}_slides.zip`;
}
  function makeFiles(session){const slides=[...session.frames].sort((a,b)=>a.time-b.time).map((f,i)=>({...f,file:`attachments/${session.id}/${String(i+1).padStart(3,'0')}_${stamp(f.time).replace(/:/g,'-')}.png`}));const source=`https://www.youtube.com/watch?v=${session.id}`;const title=session.title.replace(/[\r\n]+/g,' ').replace(/[<>]/g,'');const md=['---',`source: ${JSON.stringify(source)}`,`video_id: ${JSON.stringify(session.id)}`,'type: slides','---','',`# ${title}：投影片`,'',...slides.flatMap(f=>[`## ${stamp(f.time)}`,'',`[跳轉至影片](${source}&t=${Math.floor(f.time)}s)`,'',`![${stamp(f.time)}](${f.file})`,''])].join('\n');const manifest={schema_version:1,video_id:session.id,source,title:session.title,slides:slides.map(f=>({timestamp_seconds:Number(f.time.toFixed(3)),timestamp:stamp(f.time),image:f.file,source:f.mode,...(f.method?{capture_method:f.method}:{})}))};return [{name:'slides.md',data:md},{name:'timeline.json',data:JSON.stringify(manifest,null,2)},...slides.map(f=>({name:f.file,data:f.blob}))];}
  if(typeof module!=='undefined'&&module.exports){module.exports={stamp,idOf,signature,distance,decide,zip,makeFiles,scanTargets};return;}
  if(window.top!==window.self||document.getElementById('dg-slides-host'))return;
  const sessions=new Map();let current=null,running=false,starting=false,busy=false,generation=0,stream=null,captureVideo=null,mode='',previous=null,lastTime=-1,lastTick=0,verified=false,exporting=false,scan=null;
  const host=document.createElement('div');host.id='dg-slides-host';host.style.cssText='position:fixed;right:16px;bottom:22px;z-index:2147483646;font:13px system-ui;color:#e7eaf0';const shadow=host.attachShadow({mode:'open'});// Create static DOM without HTML injection sinks (YouTube enforces Trusted Types).
  function appendUI(parent, nodes) {
    for (const node of nodes) {
      if (typeof node === 'string') { parent.append(document.createTextNode(node)); continue; }
      const [tag, attrs, children] = node;
      const el = document.createElement(tag);
      for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
      appendUI(el, children);
      parent.append(el);
    }
  }
  appendUI(shadow, [["style",{},["\n  *{box-sizing:border-box}button,input,select{font:inherit}button{cursor:pointer;color:inherit;border:1px solid #47515e;background:#303945;border-radius:6px;padding:7px 9px}button:hover:not(:disabled){background:#435269}button:disabled{opacity:.4;cursor:default}#toggle{display:inline-flex;align-items:center;justify-content:center;min-height:46px;min-width:148px;padding:11px 16px;border:2px solid #93c5fd;border-radius:12px;background:#1d4ed8;color:#fff;font-size:16px;font-weight:700;line-height:1.25;white-space:nowrap;box-shadow:0 4px 20px #0009}#toggle:hover{background:#1e40af}#toggle:focus-visible{outline:3px solid #fff;outline-offset:3px}#toggle[data-running=true]{background:#166534;border-color:#86efac}#toggle[data-running=true]:hover{background:#14532d}#panel{width:min(360px,calc(100vw - 32px));max-height:75vh;overflow:auto;background:#20262f;border:1px solid #48515e;border-radius:10px;padding:12px;box-shadow:0 5px 28px #0007;margin-bottom:7px}#panel[hidden]{display:none}.row{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:8px 0}.muted{color:#aeb9c9;font-size:12px;line-height:1.5}.grow{flex:1;min-width:0}input[type=number],select{background:#151a21;color:#e7eaf0;border:1px solid #47515e;border-radius:4px;padding:4px;width:65px}label{display:flex;align-items:center;gap:4px}#status{min-height:36px;overflow-wrap:anywhere}#title{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}#list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;max-height:245px;overflow:auto}.tile{border:1px solid #47515e;border-radius:5px;overflow:hidden}.tile img{display:block;width:100%;aspect-ratio:16/9;object-fit:contain;background:#111;cursor:pointer}.tile .row{justify-content:space-between;margin:3px;padding:0}.tile button{padding:3px 5px;font-size:11px}.primary{background:#315b79}#session{width:100%;max-width:100%}details{border-top:1px solid #424b57;padding-top:8px}summary{cursor:pointer}.right{display:flex;justify-content:flex-end}#quickStart{background:#315b79;font-weight:600}#scanProgress{width:100%;height:10px;accent-color:#60a5fa}#scanBox{border-top:1px solid #424b57;padding-top:8px}#scanStep{width:76px}#scanBox[hidden],#scanReport[hidden]{display:none}"]],"\n  ",["section",{"id":"panel","hidden":""},[["div",{"class":"row"},[["strong",{"class":"grow"},["YouTube Slides Extractor"]],["span",{"class":"muted"},["v0.2.4"]]]],["div",{"id":"title"},[]],["div",{"class":"row"},[["select",{"id":"session","aria-label":"影片工作階段"},[]]]],["div",{"class":"row"},[["button",{"id":"start","class":"primary"},["開始自動擷取"]],["button",{"id":"stop"},["停止"]],["button",{"id":"manual"},["手動擷取"]]]],["div",{"class":"row"},[["label",{},["間隔 ",["select",{"id":"interval"},[["option",{"value":"1"},["1 秒"]],["option",{"value":"2","selected":""},["2 秒"]],["option",{"value":"5"},["5 秒"]]]]]],["label",{},["靈敏度 ",["select",{"id":"sensitivity"},[["option",{"value":"0.022"},["高"]],["option",{"value":"0.045","selected":""},["中"]],["option",{"value":"0.085"},["低"]]]]]]]],["div",{"id":"scanBox"},[["div",{"class":"row"},[["button",{"id":"quickStart","class":"grow"},["快速掃描（不需播放）"]],["button",{"id":"scanPause"},["暫停"]]]],["div",{"class":"row"},[["label",{},["掃描間隔 ",["select",{"id":"scanStep"},[["option",{"value":"1"},["1 秒"]],["option",{"value":"2"},["2 秒"]],["option",{"value":"3"},["3 秒"]],["option",{"value":"5","selected":""},["5 秒"]],["option",{"value":"10"},["10 秒"]]]]]],["label",{},[["input",{"id":"autoExport","type":"checkbox","checked":""},[]],"完成自動匯出"]]]],["div",{"class":"muted"},["從影片開頭逐點跳轉；請保持分頁可見。PNG 原始解析度。"]],["div",{"id":"scanReport","hidden":""},[["progress",{"id":"scanProgress","max":"100","value":"0"},[]],["div",{"id":"scanInfo","class":"muted","aria-live":"polite"},[]]]]]],["details",{},[["summary",{},["擷取區域與模式"]],["div",{"class":"muted"},["以影片內容百分比裁切；排除講者、字幕或浮水印。變更區域前建議匯出並清空。"]],["div",{"class":"row"},[["label",{},["左 % ",["input",{"id":"left","type":"number","min":"0","max":"95","value":"0"},[]]]],["label",{},["上 % ",["input",{"id":"top","type":"number","min":"0","max":"95","value":"0"},[]]]],["label",{},["右 % ",["input",{"id":"right","type":"number","min":"5","max":"100","value":"100"},[]]]],["label",{},["下 % ",["input",{"id":"bottom","type":"number","min":"5","max":"100","value":"100"},[]]]]]],["div",{"class":"row"},[["label",{},[["input",{"id":"forceTab","type":"checkbox"},[]],"強制使用分頁擷取"]]]],["div",{"class":"muted"},["若要求分享畫面，請只選「這個分頁」（不是整個螢幕）。不錄音、不上傳。即時擷取需播放；快速掃描需可直接讀取影片。"]]]],["details",{},[["summary",{},["自動儲存／Google Drive"]],["div",{"class":"muted"},["首次請選擇 Google Drive 電腦版中的專用 YouTube Slides 資料夾（不要選整個雲端硬碟）。瀏覽器會授權 YouTube 網域存取該資料夾，不只是此腳本。"]],["div",{"class":"row"},[["button",{"id":"folderChoose"},["選擇資料夾"]],["button",{"id":"folderRefresh"},["重新讀取／補存"]]]],["div",{"id":"folderInfo","class":"muted","aria-live":"polite"},["正在檢查資料夾…"]]]],["div",{"class":"row"},[["span",{"id":"count","class":"grow"},["0 張"]],["button",{"id":"export"},["匯出 ZIP"]],["button",{"id":"clear"},["清空"]]]],["div",{"id":"status","class":"muted","role":"status","aria-live":"polite"},["開啟影片後開始。"]],["div",{"id":"list"},[]],["div",{"class":"muted"},["點開面板才載入 PNG；張數快取可能尚未更新。未儲存的圖片需在關閉前匯出。最多 500 張／影片。"]]]],["div",{"class":"right"},[["button",{"id":"toggle","aria-expanded":"false"},["投影片 Slides · 0"]]]]]);
  (document.body||document.documentElement).append(host);
  console.info("[YouTube Slides Extractor] v0.2.4 ready");
  const $=id=>shadow.getElementById(id), status=t=>{$('status').textContent=t;};
  const video=()=>document.querySelector('#movie_player video.html5-main-video')||document.querySelector('video.html5-main-video');
  const activeId=()=>idOf(location.href);
  const titleOf=()=>document.querySelector('h1.ytd-watch-metadata yt-formatted-string')?.textContent?.trim()||document.title.replace(/\s*-\s*YouTube\s*$/,'');
  const ad=()=>!!document.querySelector('#movie_player.ad-showing,#movie_player.ad-interrupting');
  function update(){const n=current?.frames.length||0;const scanning=!!scan;const display=displayCount(current);$('count').textContent=current?.loading?'載入中…':current&&!current.loaded&&folderHandle?`${display} 張（尚未載入）`:`${n} 張`;$('toggle').textContent=scanning?`投影片 Slides · ${scan.paused?'暫停':Math.floor(scan.index/scan.total*100)+'%'} · ${n}`:`投影片 Slides · ${running?'● ':''}${display}`;$('toggle').title=current&&!current.loaded&&folderHandle?'本機張數快取；開啟面板後確認實際檔案':'開啟投影片面板';$('toggle').dataset.running=String(running);$('start').disabled=running||starting||exporting||folderBusy>0||!current||current.id!==activeId()||(folderAccess&&!current.loaded);$('quickStart').disabled=$('start').disabled;$('scanPause').disabled=!scan;$('scanPause').textContent=scan?.paused?'繼續':'暫停';$('scanStep').disabled=running||starting||exporting;$('autoExport').disabled=running||starting||exporting;$('sensitivity').disabled=scanning;$('stop').disabled=!running&&!starting;$('manual').disabled=scanning||!running||busy||current?.id!==activeId();$('export').disabled=!n||exporting||scanning||folderBusy>0;$('clear').disabled=!n||running||starting||exporting||folderBusy>0;$('session').disabled=running||starting||exporting||folderBusy>0;$('forceTab').disabled=running||starting;for(const key of ['left','top','right','bottom'])$(key).disabled=running||starting;updateFolderUI();}
  function render(){const old=$('session').value;$('session').replaceChildren();for(const s of sessions.values()){const o=document.createElement('option');o.value=s.id;o.textContent=`${s.id} · ${s.title} · ${displayCount(s)} 張`;$('session').append(o);}if(current)$('session').value=current.id;else if(old)$('session').value=old;$('title').textContent=current?.title||'請開啟 YouTube 影片';const list=$('list');list.replaceChildren();for(const f of [...(current?.frames||[])].sort((a,b)=>a.time-b.time)){const tile=document.createElement('div');tile.className='tile';const img=document.createElement('img');img.src=f.url;img.alt=`投影片 ${stamp(f.time)}`;img.loading='lazy';img.title='點擊跳轉影片';const jump=()=>{if(scan)return;const v=video();if(v&&current.id===activeId())v.currentTime=f.time;else status('請先回到該影片，再點擊時間戳記。');};img.onclick=jump;const row=document.createElement('div');row.className='row';const time=document.createElement('button');time.textContent=stamp(f.time);time.onclick=jump;const remove=document.createElement('button');remove.textContent='刪除';remove.onclick=()=>{if(exporting||running||starting||folderBusy||!current)return;void deleteSlides(current,[f]);};remove.disabled=running||starting||exporting||folderBusy>0;row.append(time,remove);tile.append(img,row);list.append(tile);}update();}
  function stop(message='已停止。請在關閉分頁前匯出。',restoreScan=false){const q=scan;scan=null;generation++;if(q&&restoreScan&&activeId()===q.session.id&&video()===q.v){try{q.v.pause();q.v.currentTime=q.originalTime;}catch(_){}}running=false;starting=false;busy=false;previous=null;lastTime=-1;lastTick=0;if(stream)for(const t of stream.getTracks())t.stop();stream=null;if(captureVideo){captureVideo.pause();captureVideo.srcObject=null;}captureVideo=null;mode='';verified=false;status(message);update();}
  let observed=null;function route(){
    const id=activeId();if(id===observed)return;observed=id;
    if(running||starting)stop('切換影片，已停止擷取。舊資料可由選單匯出。');
    $('panel').hidden=true;$('toggle').setAttribute('aria-expanded','false');
    $('scanReport').hidden=true;
    if(id){if(!sessions.has(id))sessions.set(id,newSession(id,titleOf()||id));current=sessions.get(id);if(!current.loaded&&!current.loading)current.loadAttempted=false;}
    else current=null;
    releaseInactive();render();
  }
  function drawTest(v){const c=document.createElement('canvas');c.width=c.height=4;const ctx=c.getContext('2d');ctx.drawImage(v,0,0,4,4);ctx.getImageData(0,0,4,4);}
  function crop(){const a=['left','top','right','bottom'].map(k=>Number($(k).value)/100);if(a.some(x=>!Number.isFinite(x)||x<0||x>1)||a[2]-a[0]<.05||a[3]-a[1]<.05)throw Error('裁切區域無效：右需大於左，下需大於上（至少 5%）。');return a;}
  async function start(){if(running||starting||exporting||folderBusy)return;$('scanReport').hidden=true;route();if(folderBusy||(folderAccess&&!current?.loaded))return;const v=video();if(!v||!current||current.id!==activeId()||v.readyState<2||!v.videoWidth){status('請先播放影片，等待影片載入。');return;}if(ad()){status('廣告播放中，請稍後再開始。');return;}try{crop();}catch(e){status(e.message);return;}if(!current.frames.length)current.title=titleOf()||current.id;starting=true;const token=++generation;update();try{mode='direct';if($('forceTab').checked)mode='tab';else try{drawTest(v);}catch(_){mode='tab';}if(mode==='tab'){if(!navigator.mediaDevices?.getDisplayMedia)throw Error('瀏覽器不支援分頁擷取。請使用桌面 Chrome 或 Edge。');status('請在分享視窗選「這個分頁」，不要選其他分頁或螢幕。');let handle=null;try{handle=crypto.randomUUID();navigator.mediaDevices.setCaptureHandleConfig({handle,exposeOrigin:false,permittedOrigins:[location.origin]});}catch(_){handle=null;}const s=await navigator.mediaDevices.getDisplayMedia({video:{displaySurface:'browser',frameRate:{ideal:5,max:10}},audio:false,preferCurrentTab:true,selfBrowserSurface:'include',surfaceSwitching:'exclude',monitorTypeSurfaces:'exclude'});if(token!==generation){s.getTracks().forEach(t=>t.stop());return;}stream=s;const track=s.getVideoTracks()[0];if(!track)throw Error('沒有取得視訊串流。');if(track.getSettings().displaySurface&&track.getSettings().displaySurface!=='browser')throw Error('請只選擇目前的 YouTube 分頁。');if(handle&&typeof track.getCaptureHandle==='function'){if(track.getCaptureHandle()?.handle!==handle)throw Error('不是目前的 YouTube 分頁，已停止以保護隱私。');verified=true;}captureVideo=document.createElement('video');captureVideo.muted=true;captureVideo.playsInline=true;captureVideo.srcObject=s;await captureVideo.play();if(token!==generation)return;track.addEventListener('ended',()=>{if(token===generation)stop('分頁分享已停止。');});}if(token!==generation)return;running=true;starting=false;lastTime=-1;lastTick=0;previous=null;status(mode==='direct'?'自動擷取中（直接讀取影片）。':`自動擷取中（分頁分享${verified?'，已確認目前分頁':''}）。請勿覆蓋或捲走影片。`);update();}catch(e){if(token===generation)stop(`無法開始：${e.message||e.name}`);}}
  // Compute the rendered video content rectangle, not the controls/container.
  function frame(v,signatureOnly=false){const [l,t,r,b]=crop();let source=v,sx=0,sy=0,sw=v.videoWidth,sh=v.videoHeight;if(mode==='tab'){if(!captureVideo?.videoWidth||document.visibilityState!=='visible')throw Error('請讓影片分頁保持可見。');const rect=v.getBoundingClientRect();if(rect.width<20||rect.height<20)throw Error('影片未顯示。');const ratio=Math.min(rect.width/v.videoWidth,rect.height/v.videoHeight);const rw=v.videoWidth*ratio,rh=v.videoHeight*ratio;const x=rect.left+(rect.width-rw)/2,y=rect.top+(rect.height-rh)/2;if(x<-.5||y<-.5||x+rw>innerWidth+.5||y+rh>innerHeight+.5)throw Error('影片未完整顯示，請捲回播放器或縮小視窗內容。');const kx=captureVideo.videoWidth/innerWidth,ky=captureVideo.videoHeight/innerHeight;if(Math.abs(kx/ky-1)>.06)throw Error('分享畫面與分頁比例不符，請重新分享目前分頁。');source=captureVideo;sx=x*kx;sy=y*ky;sw=rw*kx;sh=rh*ky;const overlay=host.getBoundingClientRect();if(overlay.left<x+rw&&overlay.right>x&&overlay.top<y+rh&&overlay.bottom>y)throw Error('擷取面板覆蓋影片，請先收合；若仍重疊，退出滿版影片。');}sx+=sw*l;sy+=sh*t;sw*=r-l;sh*=b-t;let c=null;const small=document.createElement('canvas');small.width=W;small.height=H;const sc=small.getContext('2d',{willReadFrequently:true});if(signatureOnly){sc.drawImage(source,sx,sy,sw,sh,0,0,W,H);}else{c=document.createElement('canvas');c.width=Math.max(1,Math.round(sw));c.height=Math.max(1,Math.round(sh));const ctx=c.getContext('2d');ctx.drawImage(source,sx,sy,sw,sh,0,0,c.width,c.height);sc.drawImage(c,0,0,W,H);}const sig=signature(sc.getImageData(0,0,W,H).data);let sum=0,sq=0;for(let i=0;i<sig.length;i+=3){sum+=sig[i];sq+=sig[i]**2;}const n=sig.length/3,avg=sum/n;if(sq/n-avg*avg<12&&(avg<15||avg>245))throw Error('偵測到近乎空白畫面，暫不擷取。');return {c,sig};}
  function blobOf(c){return new Promise((resolve,reject)=>c.toBlob(b=>b?.type==='image/png'?resolve(b):reject(Error('PNG 圖片編碼失敗')),'image/png'));}
  async function sample(manual=false){if(scan||!running||busy||!current||current.id!==activeId())return;const v=video();if(!v||v.readyState<2||v.seeking||ad()||(!manual&&(v.paused||v.ended))){previous=null;lastTime=-1;return;}if(current.frames.length>=MAX){stop('已達 500 張上限，請匯出。');return;}const t=v.currentTime;if(!Number.isFinite(t))return;if(!manual&&lastTime>=0&&(t<=lastTime||t-lastTime>Math.max(15,Number($('interval').value)*Math.max(1,v.playbackRate)*3)))previous=null;lastTime=t;busy=true;const token=generation,s=current;update();try{const {c,sig}=frame(v);const threshold=Number($('sensitivity').value);const keep=manual||decide(previous?.sig,sig,s.frames,threshold);const time=manual?t:(previous?.time??t);previous={sig,time:t};if(!keep){status('自動偵測中：等待畫面穩定或略過相似畫面。');return;}const blob=await blobOf(c);if(token!==generation||s!==current||!running)return;const f={time,sig,blob,mode,url:URL.createObjectURL(blob)};s.frames.push(f);scheduleSave(s,f);render();status(`已擷取 ${stamp(time)}${manual?'（手動）':''}，共 ${s.frames.length} 張。`);}catch(e){if(token===generation){previous=null;status(`暫停取樣：${e.message||e.name}`);if(e.name==='SecurityError')stop('影片不允許直接讀取，請勾選「強制使用分頁擷取」再開始。');}}finally{if(token===generation){busy=false;update();}}}

  // Quick Scan: seek while paused, verify a second nearby frame only for novel candidates.
  const SCAN_BYTES=400*1024*1024;
  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  function scanTargets(duration,step,index){
    const end=Math.max(0,duration-.12);
    const first=Math.min(index*step+.12,end);
    return [first,Math.min(first+Math.min(.65,step*.45),end)];
  }
  function scanReport(q,label=''){
    const pct=Math.min(100,q.index/q.total*100);
    $('scanReport').hidden=false;$('scanProgress').value=pct;
    const eta=q.index?stamp(q.workMs/q.index*(q.total-q.index)/1000):'計算中';
    $('scanInfo').textContent=(label?label+' · ':'')+pct.toFixed(1)+'%（'+q.index+'/'+q.total+'） · '+q.session.frames.length+' 張 · 剩餘 '+eta;
    update();
  }
  function scanAlive(q){return scan===q&&generation===q.token&&running&&activeId()===q.session.id&&current===q.session;}
  function scanCheck(q){
    if(!scanAlive(q)||q.paused)throw Error('掃描已暫停或停止');
    if(video()!==q.v)throw Error('影片播放器已變更，請停止後重新開始');
    if(document.visibilityState!=='visible')throw Error('請回到影片分頁後繼續');
    if(ad())throw Error('廣告播放中，請等廣告結束再繼續');
  }
  async function seekFrame(q,target){
    scanCheck(q);const v=q.v;v.pause();const start=performance.now();
    if(Math.abs(v.currentTime-target)>.035||v.seeking)v.currentTime=target;
    // seeked alone may precede presentation of the decoded frame. Wait until
    // HAVE_CURRENT_DATA and a short settle interval, then recheck the playhead.
    while(performance.now()-start<12000){
      scanCheck(q);if(!v.paused)v.pause();
      if(!v.seeking&&v.readyState>=2&&Math.abs(v.currentTime-target)<.3){
        await sleep(65);scanCheck(q);
        if(!v.seeking&&v.readyState>=2&&Math.abs(v.currentTime-target)<.3)return v.currentTime;
      }
      await sleep(70);
    }
    throw Error('影片跳轉逾時，請確認網路及影片畫質後繼續');
  }
  function finishScan(q,message,complete=false){
    if(!scanAlive(q))return;
    scanReport(q,complete?'掃描完成':'掃描停止');
    const auto=complete&&q.autoExport&&q.session.frames.length>0;
    stop(message,true);
    if(auto)$('export').click();
  }
  async function scanPump(q){
    if(q.pumping||!scanAlive(q)||q.paused)return;
    q.pumping=true;
    try{
      while(scanAlive(q)&&!q.paused&&q.index<q.total){
        const begun=performance.now();scanCheck(q);
        if(q.session.frames.length>=MAX||q.bytes>=SCAN_BYTES){finishScan(q,'已達圖片數量或記憶體安全上限，請匯出已擷取的圖片。');return;}
        const [first,second]=scanTargets(q.duration,q.step,q.index);
        await seekFrame(q,first);
        let a=null;
        try{a=frame(q.v,true);}catch(e){if(!String(e.message).includes('近乎空白'))throw e;}
        if(a&&!q.session.frames.some(f=>distance(f.sig,a.sig)<q.threshold)){
          const actual=await seekFrame(q,second);scanCheck(q);
          let b=null;
          try{b=frame(q.v);}catch(e){if(!String(e.message).includes('近乎空白'))throw e;}
          if(b&&decide(a.sig,b.sig,q.session.frames,q.threshold)){
            const blob=await blobOf(b.c);scanCheck(q);
            if(q.bytes+blob.size>SCAN_BYTES){finishScan(q,'已達約 400 MiB 圖片安全上限，請先匯出已擷取的圖片。');return;}
            const f={time:actual,sig:b.sig,blob,mode:'direct',method:'quick-scan',url:URL.createObjectURL(blob)};q.session.frames.push(f);scheduleSave(q.session,f);
            q.bytes+=blob.size;render();
          }
        }
        scanCheck(q);q.index++;q.workMs+=performance.now()-begun;
        scanReport(q,'掃描中');status('快速掃描：'+stamp(first)+' / '+stamp(q.duration)+'；不需要播放影片。');
        await sleep(0);
      }
      if(scanAlive(q)&&q.index>=q.total)finishScan(q,'快速掃描完成，共 '+q.session.frames.length+' 張。',true);
    }catch(e){
      if(scanAlive(q)&&!q.paused){
        q.paused=true;
        scanReport(q,'已暫停');status(e.name==='SecurityError'?'影片不允許直接讀取影格。請停止快速掃描，改用即時擷取。':'掃描暫停：'+(e.message||e.name)+'。可點擊繼續重試。');
      }
    }finally{q.pumping=false;if(scanAlive(q)&&!q.paused&&q.index<q.total)void scanPump(q);}
  }
  function startScan(){
    if(running||starting||exporting||folderBusy)return;route();if(folderBusy||(folderAccess&&!current?.loaded))return;const v=video();
    if(!v||!current||current.id!==activeId()||v.readyState<2||!v.videoWidth){status('請先載入影片畫面；可在暫停時開始掃描。');return;}
    if(ad()){status('廣告播放中，請稍後再開始。');return;}
    if(document.visibilityState!=='visible'){status('請在影片分頁開始快速掃描。');return;}
    if(!Number.isFinite(v.duration)||v.duration<=0||document.querySelector('#movie_player.ytp-live')){status('快速掃描僅支援長度固定的影片，直播請使用即時擷取。');return;}
    if($('forceTab').checked){status('快速掃描需直接讀取影片，請取消強制分頁擷取；否則使用即時擷取。');return;}
    try{crop();drawTest(v);}catch(e){status('無法直接擷取：'+(e.name==='SecurityError'?'影片限制直接讀取；請改用即時擷取。':e.message));return;}
    const step=Number($('scanStep').value);
    if(![1,2,3,5,10].includes(step))return;
    if(!current.frames.length)current.title=titleOf()||current.id;
    const q={token:++generation,session:current,v,originalTime:v.currentTime,duration:v.duration,step,total:Math.max(1,Math.ceil(v.duration/step)),index:0,workMs:0,bytes:current.frames.reduce((n,f)=>n+f.blob.size,0),threshold:Number($('sensitivity').value),autoExport:$('autoExport').checked,paused:false,pumping:false};
    scan=q;running=true;mode='direct';previous=null;v.pause();scanReport(q,'掃描中');status('快速掃描已開始。');void scanPump(q);
  }
  function toggleScanPause(){
    const q=scan;if(!q)return;
    q.paused=!q.paused;
    if(q.paused){scanReport(q,'已暫停');status('掃描已暫停。點擊繼續可從原進度恢復。');}
    else{scanReport(q,'掃描中');status('繼續快速掃描。');void scanPump(q);}
  }


  // Optional user-selected filesystem. No external scripts, OAuth, API calls, or
  // direct uploads. IndexedDB stores the selected directory handle; localStorage stores small per-video count hints.
  let folderHandle=null,folderBusy=0,folderPending=0,folderAccess=false,folderNote='',folderQueue=Promise.resolve();
  const folderSupported=()=>typeof window.showDirectoryPicker==='function'&&typeof indexedDB!=='undefined';
  const handleDB='dg-youtube-slides-settings-v1', handleStore='settings';
  const permission={mode:'readwrite'};

  // Count hints are per browser/origin; never enumerate a directory or read PNG
  // merely because a YouTube watch page was opened. Access permission is checked
  // separately. The actual filesystem remains the source of truth.
  const countPrefix='dg-slides-count-v1:';
  function cachedCount(id){try{const raw=localStorage.getItem(countPrefix+id);if(raw===null)return null;const v=JSON.parse(raw);return Number.isSafeInteger(v.count)&&v.count>=0?v.count:null;}catch(_){return null;}}
  function cacheCount(s){
    if(!s.diskNames)return;
    s.diskCount=s.diskNames.size;
    try{localStorage.setItem(countPrefix+s.id,JSON.stringify({count:s.diskCount,updatedAt:Date.now()}));}catch(_){}
  }
  function resetCountCache(){
    try{for(let i=localStorage.length-1;i>=0;i--){const k=localStorage.key(i);if(k?.startsWith(countPrefix))localStorage.removeItem(k);}}catch(_){}
    for(const s of sessions.values()){s.diskCount=null;s.diskNames=null;s.loaded=false;s.loadAttempted=false;}
  }
  function newSession(id,title){return {id,title,frames:[],diskCount:cachedCount(id),diskNames:null,loaded:false,loading:false,loadAttempted:false};}
  function displayCount(s){
    if(!s)return 0;
    const n=s.frames.length;
    if(!folderHandle)return n;
    if(s.diskCount===null||s.diskCount===undefined)return n?String(n)+'+':'…';
    const unsaved=s.frames.filter(f=>!f.saved&&(!f.diskName||!s.diskNames?.has(f.diskName))).length;
    return Math.max(n,s.diskCount+unsaved);
  }
  function releaseInactive(){
    // A pending writer may still need a Blob; an export owns its snapshots.
    // Keep all unsaved frames and release only successfully written frames.
    if(folderPending||exporting)return;
    for(const s of sessions.values()){
      if(s===current||s.loading)continue;
      const retained=[];
      for(const f of s.frames){if(f.saved)URL.revokeObjectURL(f.url);else retained.push(f);}
      s.frames=retained;s.loaded=false;s.loadAttempted=false;s.diskNames=null;
    }
  }
  function maybeLoadCurrent(){
    if($('panel').hidden||!folderHandle||!folderAccess||!current||current.loaded||current.loading||current.loadAttempted||folderBusy||running||starting||exporting)return;
    void refreshFolder(current);
  }

  const safeId=id=>typeof id==='string'&&/^[A-Za-z0-9_-]{11}$/.test(id);
  function diskMeta(name){
    const m=String(name).match(/^slide_(\d{13})_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})_(direct|tab)_(quick|normal)\.png$/);
    if(!m)return null;
    const time=Number(m[1])/1000;
    return Number.isFinite(time)&&time>=0?{time,mode:m[3],...(m[4]==='quick'?{method:'quick-scan'}:{})}:null;
  }
  function assignDiskName(f){
    if(!diskMeta(f.diskName))f.diskName='slide_'+String(Math.round(Math.max(0,f.time)*1000)).padStart(13,'0')+'_'+crypto.randomUUID()+'_'+(f.mode==='tab'?'tab':'direct')+'_'+(f.method==='quick-scan'?'quick':'normal')+'.png';
    return f.diskName;
  }
  function errorText(e){return String(e?.message||e?.name||'未知錯誤').replace(/[\r\n]+/g,' ').slice(0,180);}
  function updateFolderUI(){
    const choose=$('folderChoose'),refresh=$('folderRefresh'),info=$('folderInfo');
    if(!choose||!refresh||!info)return;
    choose.disabled=!folderSupported()||running||starting||exporting||folderBusy>0||folderPending>0;
    refresh.disabled=!folderHandle||!current||running||starting||exporting||folderBusy>0;
    const saved=current?.frames.filter(f=>f.saved).length||0,n=current?.frames.length||0;
    if(!folderSupported()){info.textContent='此瀏覽器不支援資料夾讀寫；請使用桌面 Chrome／Edge。仍可匯出 ZIP。';return;}
    const base=folderHandle?(folderAccess?'資料夾：'+folderHandle.name+(current?.loading?' · 正在載入圖片…':current&&!current.loaded?' · 張數快取：'+displayCount(current)+'（尚未載入）':' · 已寫入 '+saved+'/'+n+' 張（不代表雲端已同步）'):'資料夾待授權：'+folderHandle.name):'尚未選擇資料夾；截圖暫存在記憶體。';
    info.textContent=base+(folderPending?' · 待寫入 '+folderPending+' 張':'')+(folderBusy?' · 處理中':'')+(folderNote?' · '+folderNote:'');
  }
  async function handleSetting(write=false,value=null){
    return new Promise((resolve,reject)=>{
      let req;
      try{req=indexedDB.open(handleDB,1);}catch(e){reject(e);return;}
      req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains(handleStore))req.result.createObjectStore(handleStore);};
      req.onerror=()=>reject(req.error||Error('無法開啟資料庫'));
      req.onblocked=()=>reject(Error('設定資料庫被其他分頁鎖定'));
      req.onsuccess=()=>{
        const db=req.result;
        try{
          const tx=db.transaction(handleStore,write?'readwrite':'readonly'),st=tx.objectStore(handleStore);
          const op=write?st.put(value,'folder'):st.get('folder');let result;
          op.onsuccess=()=>{result=op.result;};
          tx.oncomplete=()=>{db.close();resolve(result);};
          tx.onerror=tx.onabort=()=>{db.close();reject(tx.error||Error('資料夾設定儲存失敗'));};
        }catch(e){db.close();reject(e);}
      };
    });
  }
  function enqueueFolder(work){const p=folderQueue.then(work);folderQueue=p.catch(()=>{});return p;}
  async function canAccess(h){try{return !!h&&await h.queryPermission(permission)==='granted';}catch(_){return false;}}
  async function sessionFolder(h,id,create,legacy=false){
    if(!safeId(id))throw Error('無效的影片 ID');
    try{
      // New writes go directly under YouTube Slides. Legacy is read-only
      // unless the user explicitly deletes a saved image.
      const root=legacy?await h.getDirectoryHandle('slides-v1',{create:false}):h;
      return await root.getDirectoryHandle(id,{create:legacy?false:create});
    }catch(e){if(!create&&e.name==='NotFoundError')return null;throw e;}
  }
  async function sessionFolders(h,id){
    const result=[];
    for(const legacy of [false,true]){
      const dir=await sessionFolder(h,id,false,legacy);
      if(dir)result.push(dir);
    }
    return result;
  }
  async function saveFrame(h,s,f){
    if(h!==folderHandle||!s.frames.includes(f)||f.saved)return;
    if(!await canAccess(h)){folderAccess=false;throw Error('資料夾權限已失效，請點重新讀取／補存');}
    const name=assignDiskName(f),dir=await sessionFolder(h,s.id,true);
    // A retained UUID is an immutable filename; skip only if an identical PNG
    // has already been written (e.g. a retry after an uncertain close).
    let existing=null;
    try{existing=await (await dir.getFileHandle(name)).getFile();}catch(e){if(e.name!=='NotFoundError')throw e;}
    if(existing&&existing.size){
      if(existing.size!==f.blob.size)throw Error('同名 PNG 已存在且大小不同；已保留兩端資料，請匯出 ZIP');
      const a=new Uint8Array(await existing.arrayBuffer()),b=new Uint8Array(await f.blob.arrayBuffer());
      if(a.some((x,i)=>x!==b[i]))throw Error('同名 PNG 內容不同；未覆寫');
    }else{
      const file=await dir.getFileHandle(name,{create:true}),out=await file.createWritable();
      try{await out.write(f.blob);await out.close();}catch(e){try{await out.abort();}catch(_){}throw e;}
    }
    f.saved=true;
    if(s.diskNames){s.diskNames.add(name);cacheCount(s);}
  }
  function scheduleSave(s,f){
    if(!folderHandle||!folderAccess)return;
    const h=folderHandle;folderPending++;updateFolderUI();
    void enqueueFolder(async()=>{try{await saveFrame(h,s,f);folderNote='';}catch(e){folderNote='寫入失敗：'+errorText(e)+'；請勿關閉，先匯出或補存。';}finally{folderPending--;releaseInactive();update();}});
  }
  async function signatureFromPng(file){
    const bytes=new Uint8Array(await file.slice(0,8).arrayBuffer());
    if(bytes.join(',')!=='137,80,78,71,13,10,26,10')throw Error('PNG 格式不符');
    const bitmap=await createImageBitmap(file);
    try{const c=document.createElement('canvas');c.width=W;c.height=H;const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(bitmap,0,0,W,H);return signature(ctx.getImageData(0,0,W,H).data);}
    finally{bitmap.close();}
  }
  async function readAndSave(h,s){
    if(h!==folderHandle||!s||current!==s)return false;
    if(!await canAccess(h)){folderAccess=false;folderNote='請點重新讀取／補存以重新授權。';return false;}
    folderAccess=true;folderNote='';
    const dirs=await sessionFolders(h,s.id);
    if(current!==s||h!==folderHandle)return false;
    let skipped=0,restored=0,partial=false;
    const files=[];
    {
      for(const dir of dirs){
        for await(const [name,entry] of dir.entries()){
          if(current!==s||h!==folderHandle)return false;
          const meta=diskMeta(name);if(meta&&entry.kind==='file')files.push({name,entry,meta});
        }
      }
      if(current!==s||h!==folderHandle)return false;
      s.diskNames=new Set(files.map(item=>item.name));cacheCount(s);
      // Reconcile only confirmed saved entries that no longer exist after a full listing.
      // Pending or failed local captures are always kept.
      s.frames=s.frames.filter(f=>{if(f.saved&&f.diskName&&!s.diskNames.has(f.diskName)){URL.revokeObjectURL(f.url);return false;}return true;});
      files.sort((a,b)=>a.meta.time-b.meta.time||a.name.localeCompare(b.name));
      update();
      const known=new Set(s.frames.map(f=>f.diskName).filter(Boolean));let total=s.frames.reduce((n,f)=>n+f.blob.size,0);
      for(const item of files){
        if(current!==s||h!==folderHandle)return false;
        if(known.has(item.name))continue;
        if(s.frames.length>=MAX){partial=true;break;}
        try{
          const blob=await item.entry.getFile();
          if(!blob.size||blob.size>64*1024*1024){skipped++;continue;}
          if(total+blob.size>SCAN_BYTES){partial=true;break;}
          const sig=await signatureFromPng(blob);
          if(current!==s||h!==folderHandle)return false;
          // Google Drive syncing additional copies should not replace unsaved
          // local captures. Retain each named image and use normal dedup on scan.
          const f={...item.meta,sig,blob,diskName:item.name,saved:true,url:URL.createObjectURL(blob)};
          s.frames.push(f);known.add(item.name);total+=blob.size;restored++;
        }catch(_){skipped++;}
      }
    }
    let failed=0;
    for(const f of s.frames){if(current!==s||h!==folderHandle)return false;if(!f.saved){try{await saveFrame(h,s,f);}catch(e){failed++;folderNote=errorText(e);}}}
    const extra=[restored?'還原 '+restored+' 張':'已讀取',partial?'達 500 張／400 MiB 讀回上限':null,skipped?'略過 '+skipped+' 個未完成或無法讀取的 PNG':null,failed?failed+' 張未寫入：'+folderNote:null].filter(Boolean).join('；');
    if(current!==s||h!==folderHandle)return false;
    folderNote=extra;s.loaded=true;
    if(current===s)render();
    return true;
  }
  async function loadSession(h,s){
    if(!s||h!==folderHandle||current!==s||s.loading)return false;
    s.loading=true;s.loadAttempted=true;s.loaded=false;update();
    try{return await readAndSave(h,s);}
    finally{s.loading=false;if(current===s)render();}
  }
  function refreshFolder(s){
    const h=folderHandle;if(!h||!s||s.loading||folderBusy)return Promise.resolve();
    folderBusy++;update();
    return enqueueFolder(()=>loadSession(h,s)).catch(e=>{if(current===s)folderNote='讀取失敗：'+errorText(e);}).finally(()=>{folderBusy--;releaseInactive();update();maybeLoadCurrent();});
  }
  async function chooseFolder(){
    if(!folderSupported()||running||starting||exporting||folderBusy||folderPending)return;
    folderBusy++;update();
    try{
      // Picker must be called directly in the click's user-activation context.
      const h=await window.showDirectoryPicker({id:'dg-slides-folder',mode:'readwrite'});
      if(h.name.toLowerCase()!=='youtube slides'){folderNote='請先建立並選取專用資料夾 YouTube Slides（不要選取整個 Google Drive）。';return;}
      if(!await canAccess(h)){folderNote='尚未取得資料夾寫入權限。';return;}
      let same=false;
      if(folderHandle)try{same=await folderHandle.isSameEntry(h);}catch(_){}
      if(!same){
        folderHandle=h;resetCountCache();
        // Saved flags are scoped to the chosen directory, never silently treat
        // the prior directory's files as present in a new location.
        for(const s of sessions.values())for(const f of s.frames)f.saved=false;
      }else folderHandle=h;
      folderAccess=true;
      let settingNote='';
      try{await handleSetting(true,h);}catch(e){settingNote='；無法記住資料夾，下次需重新選擇';}
      if(current&&!$('panel').hidden){const target=current;await enqueueFolder(()=>loadSession(h,target));}
      else folderNote='資料夾已選擇';
      folderNote+=settingNote;
    }catch(e){if(e.name!=='AbortError')folderNote='資料夾設定失敗：'+errorText(e);}
    finally{folderBusy--;releaseInactive();update();maybeLoadCurrent();}
  }
  async function requestFolder(){
    if(!folderHandle||!current||running||starting||exporting||folderBusy)return;
    const h=folderHandle,s=current;folderBusy++;update();
    try{
      // Request directly on the click, not after a network or database await.
      const granted=await h.requestPermission(permission);
      folderAccess=granted==='granted';
      if(!folderAccess){folderNote='未授權，請使用 ZIP 匯出保留圖片。';return;}
      if(current===s&&!$('panel').hidden)await enqueueFolder(()=>loadSession(h,s));
    }catch(e){folderNote='補存失敗：'+errorText(e);}
    finally{folderBusy--;releaseInactive();update();maybeLoadCurrent();}
  }
  async function deleteSlides(s,frames){
    if(!s||!frames.length||running||starting||exporting||folderBusy)return;
    const disk=frames.some(f=>f.saved||f.diskName);
    if(!confirm('確定刪除這 '+frames.length+' 張投影片？'+(disk?' 若已寫入同步資料夾，對應 PNG 也會刪除並可能同步至其他裝置。':' 此操作無法復原。')))return;
    folderBusy++;update();
    try{
      await enqueueFolder(async()=>{
        let dirs=[];
        if(disk){
          if(!folderHandle||!await canAccess(folderHandle))throw Error('請先重新授權資料夾，避免只刪除畫面上的圖片');
          dirs=await sessionFolders(folderHandle,s.id);
        }
        for(const f of frames){
          if(!s.frames.includes(f))continue;
          if(diskMeta(f.diskName)){
            // Validate any copies before removing them; never remove a different
            // image that happens to have the same filename in the old layout.
            const matches=[];
            for(const dir of dirs){
              let file;
              try{file=await (await dir.getFileHandle(f.diskName)).getFile();}
              catch(e){if(e.name==='NotFoundError')continue;throw e;}
              if(file.size!==f.blob.size)throw Error('發現同名但不同內容的 PNG，未刪除');
              const a=new Uint8Array(await file.arrayBuffer()),b=new Uint8Array(await f.blob.arrayBuffer());
              if(a.some((x,i)=>x!==b[i]))throw Error('發現同名但不同內容的 PNG，未刪除');
              matches.push(dir);
            }
            for(const dir of matches){
              try{await dir.removeEntry(f.diskName);}catch(e){if(e.name!=='NotFoundError')throw e;}
            }
          }
          s.frames.splice(s.frames.indexOf(f),1);URL.revokeObjectURL(f.url);
          if(s.diskNames&&f.diskName){s.diskNames.delete(f.diskName);cacheCount(s);}
        }
        folderNote='已刪除指定圖片';
      });
    }catch(e){folderNote='刪除未全部完成：'+errorText(e);}
    finally{folderBusy--;if(current===s)render();else update();}
  }
  async function initFolder(){
    if(!folderSupported())return;
    folderBusy++;update();
    try{
      const h=await handleSetting();
      if(h?.kind==='directory'&&h.name.toLowerCase()==='youtube slides'){
        folderHandle=h;folderAccess=await canAccess(h);
        if(!folderAccess)folderNote='請點重新讀取／補存重新授權';
      }
    }catch(e){folderNote='無法讀取資料夾設定：'+errorText(e);}
    finally{folderBusy--;releaseInactive();update();maybeLoadCurrent();}
  }
  $('folderChoose').onclick=chooseFolder;$('folderRefresh').onclick=requestFolder;

  $('toggle').onclick=()=>{$('panel').hidden=!$('panel').hidden;$('toggle').setAttribute('aria-expanded',String(!$('panel').hidden));if(!$('panel').hidden){if(current&&!current.loaded&&!current.loading)current.loadAttempted=false;maybeLoadCurrent();}};$('start').onclick=start;$('quickStart').onclick=startScan;$('scanPause').onclick=toggleScanPause;$('stop').onclick=()=>{if(scan)scanReport(scan,'手動停止');stop(undefined,true);};$('manual').onclick=()=>sample(true);$('session').onchange=()=>{if(running||starting)return;current=sessions.get($('session').value)||null;if(current&&!current.loaded&&!current.loading)current.loadAttempted=false;releaseInactive();render();maybeLoadCurrent();};$('clear').onclick=()=>{if(!current||running||starting||exporting||folderBusy)return;void deleteSlides(current,[...current.frames]);};$('export').onclick=async()=>{if(!current?.frames.length||exporting||scan||folderBusy)return;exporting=true;update();try{const s=current,files=makeFiles(s);const blob=await zip(files);const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=exportName(s);a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);status(`已提出下載：${files.length-2} 張投影片。`);}catch(e){status(`匯出失敗：${e.message}`);}finally{exporting=false;releaseInactive();update();maybeLoadCurrent();}};
  window.addEventListener('yt-navigate-finish',route);document.addEventListener('fullscreenchange',()=>{previous=null;});window.addEventListener('pagehide',()=>stop());window.addEventListener('beforeunload',e=>{if(folderPending||[...sessions.values()].some(s=>s.frames.some(f=>!f.saved))){e.preventDefault();e.returnValue='';}});setInterval(()=>{if(!host.isConnected)(document.body||document.documentElement).append(host);route();if(!running||busy||scan)return;const now=performance.now();if(now-lastTick>=Number($('interval').value)*1000){lastTick=now;void sample();}},250);route();update();void initFolder();
})();
