// ==UserScript==
// @name         YouTube Slides Extractor - Digital Garden (Beta)
// @namespace    https://github.com/kevinsmemo/digitalgarden
// @version      0.3.0-beta.6
// @description  Local, automatic keyframe capture with timestamps, Obsidian Markdown and ZIP export.
// @match        https://www.youtube.com/*
// @match        https://m.youtube.com/*
// @grant        none
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/kevinsmemo/tampermonkey-scripts/main/youtube-slides-extractor-beta.user.js
// @downloadURL  https://raw.githubusercontent.com/kevinsmemo/tampermonkey-scripts/main/youtube-slides-extractor-beta.user.js
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
  appendUI(shadow, [["style",{},["\n  *{box-sizing:border-box}button,input,select{font:inherit}button{cursor:pointer;color:inherit;border:1px solid #47515e;background:#303945;border-radius:6px;padding:7px 9px}button:hover:not(:disabled){background:#435269}button:disabled{opacity:.4;cursor:default}#toggle{display:inline-flex;align-items:center;justify-content:center;min-height:46px;min-width:148px;padding:11px 16px;border:2px solid #93c5fd;border-radius:12px;background:#1d4ed8;color:#fff;font-size:16px;font-weight:700;line-height:1.25;white-space:nowrap;box-shadow:0 4px 20px #0009}#toggle:hover{background:#1e40af}#toggle:focus-visible{outline:3px solid #fff;outline-offset:3px}#toggle[data-running=true]{background:#166534;border-color:#86efac}#toggle[data-running=true]:hover{background:#14532d}#panel{width:min(360px,calc(100vw - 32px));max-height:75vh;overflow:auto;background:#20262f;border:1px solid #48515e;border-radius:10px;padding:12px;box-shadow:0 5px 28px #0007;margin-bottom:7px}#panel[hidden]{display:none}.row{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:8px 0}.muted{color:#aeb9c9;font-size:12px;line-height:1.5}.grow{flex:1;min-width:0}input[type=number],select{background:#151a21;color:#e7eaf0;border:1px solid #47515e;border-radius:4px;padding:4px;width:65px}label{display:flex;align-items:center;gap:4px}#status{min-height:36px;overflow-wrap:anywhere}#title{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}#list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;max-height:245px;overflow:auto}.tile{border:1px solid #47515e;border-radius:5px;overflow:hidden}.tile img{display:block;width:100%;aspect-ratio:16/9;object-fit:contain;background:#111;cursor:pointer}.tile .row{justify-content:space-between;margin:3px;padding:0}.tile button{padding:3px 5px;font-size:11px}.primary{background:#315b79}#session{width:100%;max-width:100%}details{border-top:1px solid #424b57;padding-top:8px}summary{cursor:pointer}.right{display:flex;justify-content:flex-end}#quickStart{background:#315b79;font-weight:600}#scanProgress{width:100%;height:10px;accent-color:#60a5fa}#scanBox{border-top:1px solid #424b57;padding-top:8px}#scanStep{width:76px}#scanBox[hidden],#scanReport[hidden]{display:none}"]],"\n  ",["section",{"id":"panel","hidden":""},[["div",{"class":"row"},[["strong",{"class":"grow"},["YouTube Slides Extractor"]],["span",{"class":"muted"},["v0.3.0-beta.6"]]]],["div",{"id":"title"},[]],["div",{"class":"row"},[["select",{"id":"session","aria-label":"影片工作階段"},[]]]],["div",{"class":"row"},[["button",{"id":"start","class":"primary"},["開始自動擷取"]],["button",{"id":"stop"},["停止"]],["button",{"id":"manual"},["手動擷取"]]]],["div",{"class":"row"},[["label",{},["間隔 ",["select",{"id":"interval"},[["option",{"value":"1"},["1 秒"]],["option",{"value":"2","selected":""},["2 秒"]],["option",{"value":"5"},["5 秒"]]]]]],["label",{},["靈敏度 ",["select",{"id":"sensitivity"},[["option",{"value":"0.022"},["高"]],["option",{"value":"0.045","selected":""},["中"]],["option",{"value":"0.085"},["低"]]]]]]]],["div",{"id":"scanBox"},[["div",{"class":"row"},[["button",{"id":"quickStart","class":"grow"},["快速掃描（不需播放）"]],["button",{"id":"scanPause"},["暫停"]]]],["div",{"class":"row"},[["label",{},["掃描間隔 ",["select",{"id":"scanStep"},[["option",{"value":"1"},["1 秒"]],["option",{"value":"2"},["2 秒"]],["option",{"value":"3"},["3 秒"]],["option",{"value":"5","selected":""},["5 秒"]],["option",{"value":"10"},["10 秒"]]]]]],["label",{},[["input",{"id":"autoExport","type":"checkbox","checked":""},[]],"完成自動匯出"]]]],["div",{"class":"muted"},["從影片開頭逐點跳轉；請保持分頁可見。PNG 原始解析度。"]],["div",{"id":"scanReport","hidden":""},[["progress",{"id":"scanProgress","max":"100","value":"0"},[]],["div",{"id":"scanInfo","class":"muted","aria-live":"polite"},[]]]]]],["details",{},[["summary",{},["擷取區域與模式"]],["div",{"class":"muted"},["以影片內容百分比裁切；排除講者、字幕或浮水印。變更區域前建議匯出並清空。"]],["div",{"class":"row"},[["label",{},["左 % ",["input",{"id":"left","type":"number","min":"0","max":"95","value":"0"},[]]]],["label",{},["上 % ",["input",{"id":"top","type":"number","min":"0","max":"95","value":"0"},[]]]],["label",{},["右 % ",["input",{"id":"right","type":"number","min":"5","max":"100","value":"100"},[]]]],["label",{},["下 % ",["input",{"id":"bottom","type":"number","min":"5","max":"100","value":"100"},[]]]]]],["div",{"class":"row"},[["label",{},[["input",{"id":"forceTab","type":"checkbox"},[]],"強制使用分頁擷取"]]]],["div",{"class":"muted"},["若要求分享畫面，請只選「這個分頁」（不是整個螢幕）。不錄音、不上傳。即時擷取需播放；快速掃描需可直接讀取影片。"]]]],["div",{"class":"row"},[["span",{"id":"count","class":"grow"},["0 張"]],["button",{"id":"export"},["匯出 ZIP"]],["button",{"id":"clear"},["清空"]]]],["div",{"id":"status","class":"muted","role":"status","aria-live":"polite"},["開啟影片後開始。"]],["div",{"id":"list"},[]],["div",{"class":"muted"},["暫存在本分頁記憶體，重新整理或關閉前請匯出。最多 500 張／影片。"]]]],["div",{"class":"right"},[["button",{"id":"toggle","aria-expanded":"false"},["投影片 Slides · 0"]]]]]);
  (document.body||document.documentElement).append(host);
  console.info("[YouTube Slides Extractor] v0.3.0-beta.6 ready");
  const $=id=>shadow.getElementById(id), status=t=>{$('status').textContent=t;};
  const video=()=>document.querySelector('#movie_player video.html5-main-video')||document.querySelector('video.html5-main-video');
  const activeId=()=>idOf(location.href);
  const titleOf=()=>document.querySelector('h1.ytd-watch-metadata yt-formatted-string')?.textContent?.trim()||document.title.replace(/\s*-\s*YouTube\s*$/,'');
  const ad=()=>!!document.querySelector('#movie_player.ad-showing,#movie_player.ad-interrupting');
  function update(){const n=current?.frames.length||0;const scanning=!!scan;$('count').textContent=`${n} 張`;$('toggle').textContent=scanning?`投影片 Slides · ${scan.paused?'暫停':Math.floor(scan.index/scan.total*100)+'%'} · ${n}`:`投影片 Slides · ${running?'● ':''}${n}`;$('toggle').dataset.running=String(running);$('start').disabled=running||starting||exporting||!current||current.id!==activeId();$('quickStart').disabled=$('start').disabled;$('scanPause').disabled=!scan;$('scanPause').textContent=scan?.paused?'繼續':'暫停';$('scanStep').disabled=running||starting||exporting;$('autoExport').disabled=running||starting||exporting;$('sensitivity').disabled=scanning;$('stop').disabled=!running&&!starting;$('manual').disabled=scanning||!running||busy||current?.id!==activeId();$('export').disabled=!n||exporting||scanning;$('clear').disabled=!n||running||starting||exporting;$('session').disabled=running||starting||exporting;$('forceTab').disabled=running||starting;for(const key of ['left','top','right','bottom'])$(key).disabled=running||starting;}
  function render(){const old=$('session').value;$('session').replaceChildren();for(const s of sessions.values()){const o=document.createElement('option');o.value=s.id;o.textContent=`${s.id} · ${s.title}`;$('session').append(o);}if(current)$('session').value=current.id;else if(old)$('session').value=old;$('title').textContent=current?.title||'請開啟 YouTube 影片';const list=$('list');list.replaceChildren();for(const f of [...(current?.frames||[])].sort((a,b)=>a.time-b.time)){const tile=document.createElement('div');tile.className='tile';const img=document.createElement('img');img.src=f.url;img.alt=`投影片 ${stamp(f.time)}`;img.loading='lazy';img.title='點擊跳轉影片';const jump=()=>{if(scan)return;const v=video();if(v&&current.id===activeId())v.currentTime=f.time;else status('請先回到該影片，再點擊時間戳記。');};img.onclick=jump;const row=document.createElement('div');row.className='row';const time=document.createElement('button');time.textContent=stamp(f.time);time.onclick=jump;const remove=document.createElement('button');remove.textContent='刪除';remove.onclick=()=>{if(exporting||scan)return;const index=current.frames.indexOf(f);if(index>=0)current.frames.splice(index,1);URL.revokeObjectURL(f.url);render();};row.append(time,remove);tile.append(img,row);list.append(tile);}update();}
  function stop(message='已停止。請在關閉分頁前匯出。',restoreScan=false){const q=scan;scan=null;generation++;if(q&&restoreScan&&activeId()===q.session.id&&video()===q.v){try{q.v.pause();q.v.currentTime=q.originalTime;}catch(_){}}running=false;starting=false;busy=false;previous=null;lastTime=-1;lastTick=0;if(stream)for(const t of stream.getTracks())t.stop();stream=null;if(captureVideo){captureVideo.pause();captureVideo.srcObject=null;}captureVideo=null;mode='';verified=false;status(message);update();}
  let observed=null;function route(){const id=activeId();if(id===observed)return;observed=id;if(running||starting)stop('切換影片，已停止擷取。舊資料可由選單匯出。');if(id){if(!sessions.has(id))sessions.set(id,{id,title:titleOf()||id,frames:[]});current=sessions.get(id);}else current=null;render();}
  function drawTest(v){const c=document.createElement('canvas');c.width=c.height=4;const ctx=c.getContext('2d');ctx.drawImage(v,0,0,4,4);ctx.getImageData(0,0,4,4);}
  function crop(){const a=['left','top','right','bottom'].map(k=>Number($(k).value)/100);if(a.some(x=>!Number.isFinite(x)||x<0||x>1)||a[2]-a[0]<.05||a[3]-a[1]<.05)throw Error('裁切區域無效：右需大於左，下需大於上（至少 5%）。');return a;}
  async function start(){if(running||starting||exporting)return;$('scanReport').hidden=true;route();const v=video();if(!v||!current||current.id!==activeId()||v.readyState<2||!v.videoWidth){status('請先播放影片，等待影片載入。');return;}if(ad()){status('廣告播放中，請稍後再開始。');return;}try{crop();}catch(e){status(e.message);return;}if(!current.frames.length)current.title=titleOf()||current.id;starting=true;const token=++generation;update();try{mode='direct';if($('forceTab').checked)mode='tab';else try{drawTest(v);}catch(_){mode='tab';}if(mode==='tab'){if(!navigator.mediaDevices?.getDisplayMedia)throw Error('瀏覽器不支援分頁擷取。請使用桌面 Chrome 或 Edge。');status('請在分享視窗選「這個分頁」，不要選其他分頁或螢幕。');let handle=null;try{handle=crypto.randomUUID();navigator.mediaDevices.setCaptureHandleConfig({handle,exposeOrigin:false,permittedOrigins:[location.origin]});}catch(_){handle=null;}const s=await navigator.mediaDevices.getDisplayMedia({video:{displaySurface:'browser',frameRate:{ideal:5,max:10}},audio:false,preferCurrentTab:true,selfBrowserSurface:'include',surfaceSwitching:'exclude',monitorTypeSurfaces:'exclude'});if(token!==generation){s.getTracks().forEach(t=>t.stop());return;}stream=s;const track=s.getVideoTracks()[0];if(!track)throw Error('沒有取得視訊串流。');if(track.getSettings().displaySurface&&track.getSettings().displaySurface!=='browser')throw Error('請只選擇目前的 YouTube 分頁。');if(handle&&typeof track.getCaptureHandle==='function'){if(track.getCaptureHandle()?.handle!==handle)throw Error('不是目前的 YouTube 分頁，已停止以保護隱私。');verified=true;}captureVideo=document.createElement('video');captureVideo.muted=true;captureVideo.playsInline=true;captureVideo.srcObject=s;await captureVideo.play();if(token!==generation)return;track.addEventListener('ended',()=>{if(token===generation)stop('分頁分享已停止。');});}if(token!==generation)return;running=true;starting=false;lastTime=-1;lastTick=0;previous=null;status(mode==='direct'?'自動擷取中（直接讀取影片）。':`自動擷取中（分頁分享${verified?'，已確認目前分頁':''}）。請勿覆蓋或捲走影片。`);update();}catch(e){if(token===generation)stop(`無法開始：${e.message||e.name}`);}}
  // Compute the rendered video content rectangle, not the controls/container.
  function frame(v,signatureOnly=false){const [l,t,r,b]=crop();let source=v,sx=0,sy=0,sw=v.videoWidth,sh=v.videoHeight;if(mode==='tab'){if(!captureVideo?.videoWidth||document.visibilityState!=='visible')throw Error('請讓影片分頁保持可見。');const rect=v.getBoundingClientRect();if(rect.width<20||rect.height<20)throw Error('影片未顯示。');const ratio=Math.min(rect.width/v.videoWidth,rect.height/v.videoHeight);const rw=v.videoWidth*ratio,rh=v.videoHeight*ratio;const x=rect.left+(rect.width-rw)/2,y=rect.top+(rect.height-rh)/2;if(x<-.5||y<-.5||x+rw>innerWidth+.5||y+rh>innerHeight+.5)throw Error('影片未完整顯示，請捲回播放器或縮小視窗內容。');const kx=captureVideo.videoWidth/innerWidth,ky=captureVideo.videoHeight/innerHeight;if(Math.abs(kx/ky-1)>.06)throw Error('分享畫面與分頁比例不符，請重新分享目前分頁。');source=captureVideo;sx=x*kx;sy=y*ky;sw=rw*kx;sh=rh*ky;const overlay=host.getBoundingClientRect();if(overlay.left<x+rw&&overlay.right>x&&overlay.top<y+rh&&overlay.bottom>y)throw Error('擷取面板覆蓋影片，請先收合；若仍重疊，退出滿版影片。');}sx+=sw*l;sy+=sh*t;sw*=r-l;sh*=b-t;let c=null;const small=document.createElement('canvas');small.width=W;small.height=H;const sc=small.getContext('2d',{willReadFrequently:true});if(signatureOnly){sc.drawImage(source,sx,sy,sw,sh,0,0,W,H);}else{c=document.createElement('canvas');c.width=Math.max(1,Math.round(sw));c.height=Math.max(1,Math.round(sh));const ctx=c.getContext('2d');ctx.drawImage(source,sx,sy,sw,sh,0,0,c.width,c.height);sc.drawImage(c,0,0,W,H);}const sig=signature(sc.getImageData(0,0,W,H).data);let sum=0,sq=0;for(let i=0;i<sig.length;i+=3){sum+=sig[i];sq+=sig[i]**2;}const n=sig.length/3,avg=sum/n;if(sq/n-avg*avg<12&&(avg<15||avg>245))throw Error('偵測到近乎空白畫面，暫不擷取。');return {c,sig};}
  function blobOf(c){return new Promise((resolve,reject)=>c.toBlob(b=>b?.type==='image/png'?resolve(b):reject(Error('PNG 圖片編碼失敗')),'image/png'));}
  async function sample(manual=false){if(scan||!running||busy||!current||current.id!==activeId())return;const v=video();if(!v||v.readyState<2||v.seeking||ad()||(!manual&&(v.paused||v.ended))){previous=null;lastTime=-1;return;}if(current.frames.length>=MAX){stop('已達 500 張上限，請匯出。');return;}const t=v.currentTime;if(!Number.isFinite(t))return;if(!manual&&lastTime>=0&&(t<=lastTime||t-lastTime>Math.max(15,Number($('interval').value)*Math.max(1,v.playbackRate)*3)))previous=null;lastTime=t;busy=true;const token=generation,s=current;update();try{const {c,sig}=frame(v);const threshold=Number($('sensitivity').value);const keep=manual||decide(previous?.sig,sig,s.frames,threshold);const time=manual?t:(previous?.time??t);previous={sig,time:t};if(!keep){status('自動偵測中：等待畫面穩定或略過相似畫面。');return;}const blob=await blobOf(c);if(token!==generation||s!==current||!running)return;const f={time,sig,blob,mode,url:URL.createObjectURL(blob)};s.frames.push(f);render();status(`已擷取 ${stamp(time)}${manual?'（手動）':''}，共 ${s.frames.length} 張。`);}catch(e){if(token===generation){previous=null;status(`暫停取樣：${e.message||e.name}`);if(e.name==='SecurityError')stop('影片不允許直接讀取，請勾選「強制使用分頁擷取」再開始。');}}finally{if(token===generation){busy=false;update();}}}

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
            q.session.frames.push({time:actual,sig:b.sig,blob,mode:'direct',method:'quick-scan',url:URL.createObjectURL(blob)});
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
    if(running||starting||exporting)return;route();const v=video();
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

  $('toggle').onclick=()=>{$('panel').hidden=!$('panel').hidden;$('toggle').setAttribute('aria-expanded',String(!$('panel').hidden));};$('start').onclick=start;$('quickStart').onclick=startScan;$('scanPause').onclick=toggleScanPause;$('stop').onclick=()=>{if(scan)scanReport(scan,'手動停止');stop(undefined,true);};$('manual').onclick=()=>sample(true);$('session').onchange=()=>{if(running||starting)return;current=sessions.get($('session').value)||null;render();};$('clear').onclick=()=>{if(!current||running||starting||exporting||!confirm('刪除此影片尚未匯出的所有投影片？'))return;for(const f of current.frames)URL.revokeObjectURL(f.url);current.frames=[];render();status('已清空。');};$('export').onclick=async()=>{if(!current?.frames.length||exporting||scan)return;exporting=true;update();try{const s=current,files=makeFiles(s);const blob=await zip(files);const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=exportName(s);a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);status(`已提出下載：${files.length-2} 張投影片。`);}catch(e){status(`匯出失敗：${e.message}`);}finally{exporting=false;update();}};
  window.addEventListener('yt-navigate-finish',route);document.addEventListener('fullscreenchange',()=>{previous=null;});window.addEventListener('pagehide',()=>stop());window.addEventListener('beforeunload',e=>{if([...sessions.values()].some(s=>s.frames.length)){e.preventDefault();e.returnValue='';}});setInterval(()=>{if(!host.isConnected)(document.body||document.documentElement).append(host);route();if(!running||busy||scan)return;const now=performance.now();if(now-lastTick>=Number($('interval').value)*1000){lastTick=now;void sample();}},250);route();update();
})();
