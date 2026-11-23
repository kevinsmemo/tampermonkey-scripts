// Cloud extension alpha; based on the stable Tampermonkey script.
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
  appendUI(shadow, [["style",{},["\n  *{box-sizing:border-box}button,input,select{font:inherit}button{cursor:pointer;color:inherit;border:1px solid #47515e;background:#303945;border-radius:6px;padding:7px 9px}button:hover:not(:disabled){background:#435269}button:disabled{opacity:.4;cursor:default}#toggle{display:inline-flex;align-items:center;justify-content:center;min-height:46px;min-width:148px;padding:11px 16px;border:2px solid #93c5fd;border-radius:12px;background:#1d4ed8;color:#fff;font-size:16px;font-weight:700;line-height:1.25;white-space:nowrap;box-shadow:0 4px 20px #0009}#toggle:hover{background:#1e40af}#toggle:focus-visible{outline:3px solid #fff;outline-offset:3px}#toggle[data-running=true]{background:#166534;border-color:#86efac}#toggle[data-running=true]:hover{background:#14532d}#panel{width:min(360px,calc(100vw - 32px));max-height:75vh;overflow:auto;background:#20262f;border:1px solid #48515e;border-radius:10px;padding:12px;box-shadow:0 5px 28px #0007;margin-bottom:7px}#panel[hidden]{display:none}.row{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:8px 0}.muted{color:#aeb9c9;font-size:12px;line-height:1.5}.grow{flex:1;min-width:0}input[type=number],select{background:#151a21;color:#e7eaf0;border:1px solid #47515e;border-radius:4px;padding:4px;width:65px}label{display:flex;align-items:center;gap:4px}#status{min-height:36px;overflow-wrap:anywhere}#title{font-weight:400;font-size:12px;line-height:1.5;color:#aeb9c9;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}#sessionPanel[hidden]{display:none}#sessionPanel{border-top:0;margin:4px 0;padding-top:0;font-size:12px}#sessionPanel summary{color:#aeb9c9;margin-bottom:5px}#list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;max-height:245px;overflow:auto}.tile{border:1px solid #47515e;border-radius:5px;overflow:hidden}.tile img{display:block;width:100%;aspect-ratio:16/9;object-fit:contain;background:#111;cursor:pointer}.tile .row{justify-content:space-between;margin:3px;padding:0}.tile button{padding:3px 5px;font-size:11px}.primary{background:#315b79}#session{width:100%;max-width:100%}details{border-top:1px solid #424b57;padding-top:8px}summary{cursor:pointer}.right{display:flex;justify-content:flex-end}#quickStart{background:#315b79;font-weight:600}#scanProgress{width:100%;height:10px;accent-color:#60a5fa}#scanBox{border-top:1px solid #424b57;padding-top:8px}#scanStep{width:76px}#scanBox[hidden],#scanReport[hidden]{display:none}\n#viewCurrent[hidden],#viewHistory[hidden]{display:none}#viewTabs{display:flex;gap:6px;margin:8px 0 12px}#viewTabs button{flex:1}#viewTabs button[aria-pressed=true]{background:#315b79;border-color:#93c5fd;font-weight:600}#historySearch{background:#151a21;color:#e7eaf0;border:1px solid #47515e;border-radius:6px;padding:8px;width:100%;min-width:0}#historyList{max-height:48vh;overflow:auto}#historyList a{display:block;color:inherit;text-decoration:none;padding:9px 4px;border-bottom:1px solid #424b57}#historyList a:hover{background:#303945}.histline{display:flex;align-items:center;gap:8px}.histtitle{flex:1;min-width:0;overflow-wrap:anywhere;font-weight:600}.histcount{white-space:nowrap;color:#93c5fd}.histmeta{color:#aeb9c9;font-size:11px;margin-top:4px}#historyMore[hidden]{display:none}#cloudSummary{font-size:11px;line-height:1.5;color:#aeb9c9;padding:6px 9px;border:1px solid #424b57;border-radius:6px;margin:5px 0 8px;overflow-wrap:anywhere}#cloudSummary[data-tone=good]{color:#a7f3d0}#cloudSummary[data-tone=warn]{color:#fcd34d}#cloudSummary[data-tone=bad]{color:#fda4af}"]],"\n  ",["section",{"id":"panel","hidden":""},[["div",{"class":"row"},[["strong",{"class":"grow"},["YouTube Slides Extractor"]],["span",{"class":"muted"},["v0.4.4-alpha"]]]],["div",{"id":"cloudSummary","role":"status","aria-live":"polite"},["Google Drive · 讀取狀態…"]],["div",{"class":"row","id":"globalDriveRow"},[["button",{"id":"folderChoose","class":"grow","title":"開啟 Google Drive 連線設定"},["Google Drive 設定"]]]],["div",{"id":"viewTabs","role":"group","aria-label":"投影片檢視"},[["button",{"id":"tabCurrent","aria-pressed":"true"},["目前影片"]],["button",{"id":"tabHistory","aria-pressed":"false"},["歷史紀錄"]]]],["div",{"id":"viewCurrent"},[["div",{"id":"title"},[]],["details",{"id":"sessionPanel","hidden":""},[["summary",{},["切換未儲存的暫存影片"]],["select",{"id":"session","aria-label":"暫存影片工作階段"},[]]]],["div",{"class":"row"},[["button",{"id":"start","class":"primary"},["開始自動擷取"]],["button",{"id":"stop"},["停止"]],["button",{"id":"manual"},["手動擷取"]]]],["div",{"class":"row"},[["label",{},["間隔 ",["select",{"id":"interval"},[["option",{"value":"1"},["1 秒"]],["option",{"value":"2","selected":""},["2 秒"]],["option",{"value":"5"},["5 秒"]]]]]],["label",{},["靈敏度 ",["select",{"id":"sensitivity"},[["option",{"value":"0.022"},["高"]],["option",{"value":"0.045","selected":""},["中"]],["option",{"value":"0.085"},["低"]]]]]]]],["div",{"id":"scanBox"},[["div",{"class":"row"},[["button",{"id":"quickStart","class":"grow"},["快速掃描（不需播放）"]],["button",{"id":"scanPause"},["暫停"]]]],["div",{"class":"row"},[["label",{},["掃描間隔 ",["select",{"id":"scanStep"},[["option",{"value":"1"},["1 秒"]],["option",{"value":"2"},["2 秒"]],["option",{"value":"3"},["3 秒"]],["option",{"value":"5","selected":""},["5 秒"]],["option",{"value":"10"},["10 秒"]]]]]],["label",{},[["input",{"id":"autoExport","type":"checkbox","checked":""},[]],"完成自動匯出"]]]],["div",{"class":"muted"},["從影片開頭逐點跳轉；請保持分頁可見。PNG 原始解析度。"]],["div",{"id":"scanReport","hidden":""},[["progress",{"id":"scanProgress","max":"100","value":"0"},[]],["div",{"id":"scanInfo","class":"muted","aria-live":"polite"},[]]]]]],["details",{},[["summary",{},["擷取區域與模式"]],["div",{"class":"muted"},["預設完整畫面。點擊按鈕後，用滑鼠直接調整影片上的虛線框。"]],["div",{"class":"row"},[["button",{"id":"cropAdjust","class":"primary grow"},["調整擷取範圍"]],["button",{"id":"cropReset"},["恢復全畫面"]]]],["div",{"id":"cropSummary","class":"muted","aria-live":"polite"},["目前：完整畫面"]],["details",{},[["summary",{},["精確座標（%）"]],["div",{"class":"row"},[["label",{},["左 % ",["input",{"id":"left","type":"number","min":"0","max":"95","value":"0","step":"0.1"},[]]]],["label",{},["上 % ",["input",{"id":"top","type":"number","min":"0","max":"95","value":"0","step":"0.1"},[]]]],["label",{},["右 % ",["input",{"id":"right","type":"number","min":"5","max":"100","value":"100","step":"0.1"},[]]]],["label",{},["下 % ",["input",{"id":"bottom","type":"number","min":"5","max":"100","value":"100","step":"0.1"},[]]]]]]]],["div",{"class":"muted"},["拖曳四角或邊線縮放、拖曳框內移動；全畫面或框外可重新圈選。調整完成後，點選字卡的 × 儲存並關閉；不會自動隱藏。Esc 可取消本次編輯。已有截圖時，變更範圍可能影響去重。"]],["div",{"class":"row"},[["label",{},[["input",{"id":"forceTab","type":"checkbox"},[]],"強制使用分頁擷取"]]]],["div",{"class":"muted"},["若要求分享畫面，請只選「這個分頁」（不是整個螢幕）。不錄音；依設定同步投影片 PNG。即時擷取需播放；快速掃描需可直接讀取影片。"]]]],["details",{},[["summary",{},["直接同步／Google Drive"]],["div",{"class":"muted"},["透過擴充套件直接連接 Google Drive。未登入或離線時，先寫入擴充套件本機資料庫。"]],["div",{"class":"row"},[["button",{"id":"folderRefresh"},["重新讀取／同步"]]]],["div",{"id":"folderInfo","class":"muted","aria-live":"polite"},["正在檢查資料夾…"]]]],["div",{"class":"row"},[["span",{"id":"count","class":"grow"},["0 張"]],["button",{"id":"export"},["匯出 ZIP"]],["button",{"id":"clear"},["清空（停用）"]]]],["div",{"id":"status","class":"muted","role":"status","aria-live":"polite"},["開啟影片後開始。"]],["div",{"id":"list"},[]],["div",{"class":"muted"},["點開面板才載入 PNG。離線截圖先存本機；上方顯示全域待同步張數。測試版暫停刪除，避免誤刪雲端歷史資料。"]]]],["div",{"id":"viewHistory","hidden":""},[["input",{"id":"historySearch","type":"search","placeholder":"搜尋影片標題或 ID…","aria-label":"搜尋歷史影片"},[]],["div",{"class":"row"},[["span",{"id":"historySummary","class":"grow muted"},["尚無紀錄"]],["button",{"id":"historyRefresh"},["更新索引"]],["button",{"id":"historyRebuild","title":"重新掃描所有影片資料夾與 PNG 檔名"},["完整修復"]]]],["div",{"id":"historyStatus","class":"muted","role":"status","aria-live":"polite"},["雲端／本機索引；點更新索引讀取其他裝置紀錄。"]],["div",{"id":"historyList"},[]],["button",{"id":"historyMore","hidden":""},["載入更多"]]]]]],["div",{"class":"right"},[["button",{"id":"toggle","aria-expanded":"false"},["投影片 Slides · 0"]]]]]);
  (document.body||document.documentElement).append(host);
  console.info("[YouTube Slides Extractor] v0.4.4-alpha ready");
  const $=id=>shadow.getElementById(id), status=t=>{$('status').textContent=t;};
  const video=()=>document.querySelector('#movie_player video.html5-main-video')||document.querySelector('video.html5-main-video');
  const activeId=()=>idOf(location.href);
  const titleOf=()=>document.querySelector('h1.ytd-watch-metadata yt-formatted-string')?.textContent?.trim()||document.title.replace(/\s*-\s*YouTube\s*$/,'');
  const ad=()=>!!document.querySelector('#movie_player.ad-showing,#movie_player.ad-interrupting');
  function update(){const n=current?.frames.length||0;const scanning=!!scan;const display=displayCount(current);$('count').textContent=current?.loading?'載入中…':current&&!current.loaded&&folderHandle?`${display} 張（尚未載入）`:`${n} 張`;$('toggle').textContent=scanning?`投影片 Slides · ${scan.paused?'暫停':Math.floor(scan.index/scan.total*100)+'%'} · ${n}`:`投影片 Slides · ${running?'● ':''}${display}`;$('toggle').title=current&&!current.loaded&&folderHandle?'本機張數快取；開啟面板後確認實際檔案':'開啟投影片面板';$('toggle').dataset.running=String(running);$('start').disabled=running||starting||exporting||folderBusy>0||!current||current.id!==activeId()||(folderAccess&&!current.loaded);$('quickStart').disabled=$('start').disabled;$('scanPause').disabled=!scan;$('scanPause').textContent=scan?.paused?'繼續':'暫停';$('scanStep').disabled=running||starting||exporting;$('autoExport').disabled=running||starting||exporting;$('sensitivity').disabled=scanning;$('stop').disabled=!running&&!starting;$('manual').disabled=scanning||!running||busy||current?.id!==activeId();$('export').disabled=!n||exporting||scanning||folderBusy>0;$('clear').disabled=true;$('session').disabled=running||starting||exporting||folderBusy>0;$('forceTab').disabled=running||starting;syncCropControls();updateFolderUI();syncDeleteButtons();syncHistoryControls();}
  // Keep DOM nodes for unchanged slides. The original PNG is never assigned
  // to the image element when a small preview is available.
  const tiles=new Map(),options=new Map();let tileSession=null,deleteLocked=null;
  function syncDeleteButtons(){
    const locked=true;
    if(deleteLocked===locked)return;deleteLocked=locked;
    for(const tile of tiles.values())tile.remove.disabled=locked;
  }
  function render(){
    const select=$('session'),old=select.value;
    for(const [id,o] of options){if(!sessions.has(id)){o.remove();options.delete(id);}}
    for(const session of sessions.values()){
      let o=options.get(session.id);
      if(!o){o=document.createElement('option');o.value=session.id;options.set(session.id,o);select.append(o);}
      const label=session.id+' · '+session.title+' · '+displayCount(session)+' 張';if(o.textContent!==label)o.textContent=label;
    }
    const value=current?.id||old;if(select.value!==value)select.value=value;
    const hasUnsavedOther=[...sessions.values()].some(s=>s!==current&&s.frames.some(f=>!f.saved));
    $('sessionPanel').hidden=!hasUnsavedOther;
    const title=current?.title||'請開啟 YouTube 影片';if($('title').textContent!==title)$('title').textContent=title;$('title').title=title;
    const list=$('list');
    if(tileSession!==current){list.replaceChildren();tiles.clear();tileSession=current;}
    if(!$('panel').hidden&&!historyView){
      const frames=[...(current?.frames||[])].sort((a,b)=>a.time-b.time),wanted=new Set(frames);
      for(const [f,item] of tiles){if(!wanted.has(f)){item.el.remove();tiles.delete(f);}}
      let cursor=list.firstChild;
      for(const f of frames){
        let item=tiles.get(f);
        if(!item){
          const session=current,tile=document.createElement('div');tile.className='tile';
          const img=document.createElement('img');img.loading='lazy';img.decoding='async';img.src=f.url;img.alt='投影片 '+stamp(f.time);img.title='點擊跳轉影片';
          const jump=()=>{if(scan||current!==session)return;const v=video();if(v&&session.id===activeId())v.currentTime=f.time;else status('請先回到該影片，再點擊時間戳記。');};
          img.onclick=jump;
          const row=document.createElement('div');row.className='row';
          const time=document.createElement('button');time.textContent=stamp(f.time);time.onclick=jump;
          const remove=document.createElement('button');remove.textContent='刪除';remove.disabled=true;
          remove.onclick=()=>{if(exporting||running||starting||folderBusy||current!==session)return;void deleteSlides(session,[f]);};
          row.append(time,remove);tile.append(img,row);item={el:tile,remove};tiles.set(f,item);
        }
        if(item.el===cursor)cursor=cursor.nextSibling;
        else list.insertBefore(item.el,cursor);
      }
    }
    update();
  }
  function stop(message='已停止。請在關閉分頁前匯出。',restoreScan=false){const q=scan;scan=null;generation++;if(q&&restoreScan&&activeId()===q.session.id&&video()===q.v){try{q.v.pause();q.v.currentTime=q.originalTime;}catch(_){}}running=false;starting=false;busy=false;previous=null;lastTime=-1;lastTick=0;endCaptureTimer();releaseCaptureCanvas();if(stream)for(const t of stream.getTracks())t.stop();stream=null;if(captureVideo){captureVideo.pause();captureVideo.srcObject=null;}captureVideo=null;mode='';verified=false;status(message);update();}
  let observed=null;function route(){
    const id=activeId();if(id===observed)return;observed=id;hideCropEditor();
    if(running||starting)stop('切換影片，已停止擷取。舊資料可由選單匯出。');
    $('panel').hidden=true;$('toggle').setAttribute('aria-expanded','false');
    $('scanReport').hidden=true;
    if(id){if(!sessions.has(id))sessions.set(id,newSession(id,titleOf()||id));current=sessions.get(id);if(!current.loaded&&!current.loading)current.loadAttempted=false;}
    else current=null;
    setCropUnits(selectedCrop());setHistoryView(!id,false);releaseInactive();render();queueBadgeScan(document);
  }
  function drawTest(v){const c=document.createElement('canvas');c.width=c.height=4;const ctx=c.getContext('2d');ctx.drawImage(v,0,0,4,4);ctx.getImageData(0,0,4,4);}
  // Crop selection uses integer tenths of a percent.
  const CROP_FULL=[0,0,1000,1000],CROP_MIN=50,CROP_SAVE_PREFIX='dg-slides-crop-v1:';
  const cropKeys=['left','top','right','bottom'];
  let cropEditor=null;
  function validCropUnits(a){
    return Array.isArray(a)&&a.length===4&&a.every(x=>Number.isInteger(x)&&x>=0&&x<=1000)&&a[2]-a[0]>=CROP_MIN&&a[3]-a[1]>=CROP_MIN;
  }
  function fullCrop(a){return a.every((v,i)=>v===CROP_FULL[i]);}
  function cropUnits(){
    const a=cropKeys.map(k=>{const v=$(k).value;return v.trim()===''?NaN:Math.round(Number(v)*10);});
    if(!validCropUnits(a))throw Error('裁切區域無效：寬、高至少 5%，座標需在 0–100% 之間。');
    return a;
  }
  function crop(){return cropUnits().map(n=>n/1000);}
  function selectedCrop(){return validCropUnits(current?.cropUnits)?current.cropUnits.slice():CROP_FULL.slice();}
  function cropAllowed(){return !!current&&current.id===activeId()&&!running&&!starting&&!exporting&&!historyView;}
  function updateCropSummary(a=selectedCrop()){
    const summary=$('cropSummary'),message=fullCrop(a)?'目前：完整畫面':'目前：自訂範圍 '+((a[2]-a[0])/10).toFixed(1)+'% × '+((a[3]-a[1])/10).toFixed(1)+'%';
    if(summary.textContent!==message)summary.textContent=message;
  }
  function setCropUnits(a,userEdit=false){
    if(!validCropUnits(a))throw Error('無效的裁切範圍');
    if(current){current.cropUnits=a.slice();if(userEdit)current.cropEdited=true;}
    cropKeys.forEach((k,i)=>{const v=String(a[i]/10);if($(k).value!==v)$(k).value=v;});
    updateCropSummary(a);if(cropEditor)paintCrop(cropEditor,a);
  }
  async function loadSavedCrop(session){
    const key=CROP_SAVE_PREFIX+session.id;
    try{
      const stored=(await chrome.storage.local.get(key))[key];
      if(validCropUnits(stored)&&!session.cropEdited){
        session.cropUnits=stored.slice();
        if(current===session){
          setCropUnits(stored);
          if(cropEditor?.session===session)cropEditor.initial=stored.slice();
        }
      }
    }catch(_){/* The editor remains usable when local storage is unavailable. */}
  }
  function cropToolbarInside(a,rect){
    // Full-frame selections often begin near the top of the viewport.
    return rect.top+rect.height*a[1]/1000<48;
  }
  function syncCropControls(){
    const allowed=cropAllowed();$('cropAdjust').disabled=!allowed;$('cropReset').disabled=!allowed;
    for(const k of cropKeys)$(k).disabled=!allowed;
    if(!allowed&&cropEditor)hideCropEditor();updateCropSummary();
  }
  function videoContentRect(v){
    if(!v||!(v.videoWidth>0)||!(v.videoHeight>0))throw Error('請先載入影片畫面。');
    const r=v.getBoundingClientRect();if(r.width<20||r.height<20)throw Error('影片未顯示。');
    const scale=Math.min(r.width/v.videoWidth,r.height/v.videoHeight);
    const width=v.videoWidth*scale,height=v.videoHeight*scale;
    return {left:r.left+(r.width-width)/2,top:r.top+(r.height-height)/2,width,height};
  }
  function rectVisible(r,w,h){return r.left>=-.5&&r.top>=-.5&&r.left+r.width<=w+.5&&r.top+r.height<=h+.5;}
  function dragCrop(base,kind,start,point){
    const dx=Math.round(point[0]-start[0]),dy=Math.round(point[1]-start[1]);
    const a=base.slice(),unit=n=>clamp(Math.round(n),0,1000);
    if(kind==='move'){
      const x=clamp(dx,-a[0],1000-a[2]),y=clamp(dy,-a[1],1000-a[3]);
      return [a[0]+x,a[1]+y,a[2]+x,a[3]+y];
    }
    if(kind==='new'){
      function axis(p,q){p=unit(p);q=unit(q);if(Math.abs(q-p)>=CROP_MIN)return [Math.min(p,q),Math.max(p,q)];if(q<p){const high=Math.max(CROP_MIN,p);return [high-CROP_MIN,high];}const low=Math.min(p,1000-CROP_MIN);return [low,low+CROP_MIN];}
      const x=axis(start[0],point[0]),y=axis(start[1],point[1]);return [x[0],y[0],x[1],y[1]];
    }
    if(kind.includes('w'))a[0]=clamp(a[0]+dx,0,a[2]-CROP_MIN);
    if(kind.includes('e'))a[2]=clamp(a[2]+dx,a[0]+CROP_MIN,1000);
    if(kind.includes('n'))a[1]=clamp(a[1]+dy,0,a[3]-CROP_MIN);
    if(kind.includes('s'))a[3]=clamp(a[3]+dy,a[1]+CROP_MIN,1000);
    return a;
  }
  function paintCrop(e,a){
    Object.assign(e.box.style,{left:(a[0]/10)+'%',top:(a[1]/10)+'%',width:((a[2]-a[0])/10)+'%',height:((a[3]-a[1])/10)+'%'});
    e.box.style.cursor=fullCrop(a)?'crosshair':'move';
    e.hintText.textContent='拖曳調整範圍 · '+((a[2]-a[0])/10).toFixed(1)+'% × '+((a[3]-a[1])/10).toFixed(1)+'%';
    const mid=e.rect.width*(a[0]+a[2])/2000,margin=Math.min(e.rect.width/2,150);
    e.hint.style.left=clamp(mid,margin,e.rect.width-margin)+'px';
    e.hint.style.top=(e.rect.height*a[1]/1000)+'px';
    e.hint.classList.toggle('inside',cropToolbarInside(a,e.rect));
  }
  function hideCropEditor(){
    const e=cropEditor;if(!e)return;cropEditor=null;
    if(e.raf!==null)cancelAnimationFrame(e.raf);
    e.observer?.disconnect();
    window.removeEventListener('resize',e.geometry);
    window.removeEventListener('scroll',e.geometry,true);
    document.removeEventListener('keydown',e.key,true);
    document.removeEventListener('fullscreenchange',e.close);
    document.removeEventListener('visibilitychange',e.visibility);
    e.root.remove();
  }
  function showCropEditor(){
    if(!cropAllowed())return;
    const v=video();let rect;
    try{
      if(document.fullscreenElement)throw Error('請先退出全螢幕，再調整擷取範圍。');
      rect=videoContentRect(v);
      if(!rectVisible(rect,innerWidth,innerHeight))throw Error('請先將影片完整捲入畫面，再調整擷取範圍。');
    }catch(e){status(e.message);return;}
    if(cropEditor?.v===v&&cropEditor.session===current){paintCrop(cropEditor,selectedCrop());return;}
    hideCropEditor();
    const root=document.createElement('div');root.id='dg-slides-crop-overlay';
    root.style.cssText='position:fixed;z-index:2147483647;pointer-events:auto;box-sizing:border-box;isolation:isolate;';
    const rs=root.attachShadow({mode:'open'}),css=document.createElement('style');
    css.textContent='*{box-sizing:border-box}.surface{position:absolute;inset:0;overflow:hidden;touch-action:none;user-select:none;cursor:crosshair}.selection{position:absolute;box-shadow:0 0 0 9999px rgba(0,0,0,.36),inset 0 0 0 1px #0008;touch-action:none}.selection:before{content:"";position:absolute;inset:0;border:2px dashed #7affba;pointer-events:none}.handle{position:absolute;width:24px;height:24px;transform:translate(-50%,-50%);display:grid;place-items:center;touch-action:none;z-index:2}.handle:after{content:"";width:10px;height:10px;border-radius:2px;border:1px solid #17382b;background:#baffdb;box-shadow:0 1px 4px #0009}.hint{position:absolute;display:flex;align-items:center;gap:8px;transform:translate(-50%,calc(-100% - 8px));color:#fff;background:rgba(0,0,0,.86);border-radius:7px;padding:4px 4px 4px 10px;font:600 12px/1.4 system-ui;pointer-events:auto;white-space:nowrap;max-width:calc(100vw - 16px);z-index:5;box-shadow:0 2px 8px #0006}.hint.inside{transform:translate(-50%,8px)}.hint-label{overflow:hidden;text-overflow:ellipsis}.hint-save{display:grid;place-items:center;min-width:28px;min-height:28px;border:1px solid #77818a;border-radius:5px;background:#26313b;color:#fff;font:700 20px/1 system-ui;cursor:pointer;padding:0}.hint-save:hover,.hint-save:focus-visible{background:#426b56;outline:2px solid #baffdb;outline-offset:1px}.hint-save:disabled{opacity:.5;cursor:wait}';
    const surface=document.createElement('div');surface.className='surface';surface.setAttribute('aria-label','拖曳調整影片擷取範圍');
    const box=document.createElement('div');box.className='selection';
    const hint=document.createElement('div');hint.className='hint';
    const hintText=document.createElement('span');hintText.className='hint-label';
    const closeButton=document.createElement('button');closeButton.type='button';closeButton.className='hint-save';
    closeButton.textContent='×';closeButton.title='儲存裁切範圍並關閉';closeButton.setAttribute('aria-label','儲存裁切範圍並關閉');
    hint.append(hintText,closeButton);
    for(const [edge,x,y,cursor] of [['nw',0,0,'nwse-resize'],['n',50,0,'ns-resize'],['ne',100,0,'nesw-resize'],['e',100,50,'ew-resize'],['se',100,100,'nwse-resize'],['s',50,100,'ns-resize'],['sw',0,100,'nesw-resize'],['w',0,50,'ew-resize']]){
      const h=document.createElement('div');h.className='handle';h.dataset.edge=edge;
      Object.assign(h.style,{left:x+'%',top:y+'%',cursor});box.append(h);
    }
    // The toolbar is outside the clipping surface so it can sit above the dashed border.
    surface.append(box);rs.append(css,surface,hint);
    const e={root,surface,box,hint,hintText,closeButton,v,session:current,initial:selectedCrop(),rect,raf:null,drag:null,observer:null,saving:false};cropEditor=e;
    closeButton.addEventListener('pointerdown',ev=>ev.stopPropagation());
    closeButton.addEventListener('click',ev=>{
      ev.preventDefault();ev.stopPropagation();
      if(cropEditor!==e||e.drag||e.saving)return;
      e.saving=true;closeButton.disabled=true;
      const units=selectedCrop(),key=CROP_SAVE_PREFIX+e.session.id;
      void chrome.storage.local.set({[key]:units}).then(()=>{
        if(cropEditor===e){hideCropEditor();status('已儲存此影片的裁切範圍。');}
      }).catch(err=>{
        if(cropEditor===e){closeButton.disabled=false;status('儲存裁切範圍失敗：'+String(err?.message||err));}
      }).finally(()=>{e.saving=false;});
    });
    function putRect(r){e.rect=r;Object.assign(root.style,{left:r.left+'px',top:r.top+'px',width:r.width+'px',height:r.height+'px'});paintCrop(e,selectedCrop());}
    function point(ev){const r=e.rect;return [clamp((ev.clientX-r.left)/r.width*1000,0,1000),clamp((ev.clientY-r.top)/r.height*1000,0,1000)];}
    e.geometry=()=>{
      if(cropEditor!==e||e.raf!==null)return;
      e.raf=requestAnimationFrame(()=>{
        e.raf=null;if(cropEditor!==e)return;
        try{
          if(e.session!==current||video()!==v||!cropAllowed())throw Error('changed');
          const r=videoContentRect(v);if(!rectVisible(r,innerWidth,innerHeight))throw Error('not visible');
          if(e.drag&&['left','top','width','height'].some(k=>Math.abs(r[k]-e.rect[k])>.5)){hideCropEditor();return;}
          putRect(r);
        }catch(_){hideCropEditor();}
      });
    };
    e.close=()=>{if(cropEditor===e)hideCropEditor();};
    e.visibility=()=>{if(document.visibilityState!=='visible')e.close();};
    e.key=ev=>{if(ev.key==='Escape'){ev.preventDefault();ev.stopImmediatePropagation();if(e.session===current)setCropUnits(e.initial,true);e.close();}};
    surface.addEventListener('pointerdown',ev=>{
      if(ev.button!==0||e.drag||cropEditor!==e||!cropAllowed())return;
      ev.preventDefault();ev.stopPropagation();
      const base=selectedCrop(),handle=ev.target.closest?.('[data-edge]');
      const kind=handle?.dataset.edge||(!fullCrop(base)&&box.contains(ev.target)?'move':'new');
      e.drag={id:ev.pointerId,base,kind,start:point(ev),x:ev.clientX,y:ev.clientY,moved:false};
      try{surface.setPointerCapture(ev.pointerId);}catch(_){}
    });
    surface.addEventListener('pointermove',ev=>{
      if(cropEditor!==e)return;const d=e.drag;
      if(!d)return;if(d.id!==ev.pointerId)return;
      ev.preventDefault();ev.stopPropagation();
      if(!d.moved&&Math.hypot(ev.clientX-d.x,ev.clientY-d.y)<4)return;
      d.moved=true;setCropUnits(dragCrop(d.base,d.kind,d.start,point(ev)),true);
    });
    function endDrag(ev,cancel=false){
      const d=e.drag;if(!d||d.id!==ev.pointerId)return;
      ev.preventDefault();ev.stopPropagation();e.drag=null;
      if(cancel&&cropEditor===e)setCropUnits(d.base,true);
      try{if(surface.hasPointerCapture(ev.pointerId))surface.releasePointerCapture(ev.pointerId);}catch(_){}
    }
    surface.addEventListener('pointerup',ev=>endDrag(ev));
    surface.addEventListener('pointercancel',ev=>endDrag(ev,true));
    surface.addEventListener('lostpointercapture',ev=>{if(e.drag?.id===ev.pointerId)endDrag(ev);});
    for(const type of ['click','dblclick','contextmenu'])surface.addEventListener(type,ev=>{ev.preventDefault();ev.stopPropagation();});
    (document.body||document.documentElement).append(root);putRect(rect);paintCrop(e,selectedCrop());
    window.addEventListener('resize',e.geometry);window.addEventListener('scroll',e.geometry,true);
    document.addEventListener('keydown',e.key,true);document.addEventListener('fullscreenchange',e.close);
    document.addEventListener('visibilitychange',e.visibility);
    if(typeof ResizeObserver==='function'){e.observer=new ResizeObserver(e.geometry);e.observer.observe(v);}
  }
  function wireCropEditor(){
    $('cropAdjust').onclick=()=>showCropEditor();
    $('cropReset').onclick=()=>{if(!cropAllowed())return;setCropUnits(CROP_FULL.slice(),true);showCropEditor();};
    for(const k of cropKeys)$(k).addEventListener('change',()=>{
      if(!cropAllowed())return;
      try{setCropUnits(cropUnits(),true);showCropEditor();}
      catch(e){setCropUnits(selectedCrop());status(e.message);}
    });
  }
  async function start(){hideCropEditor();if(running||starting||exporting||folderBusy)return;$('scanReport').hidden=true;route();if(folderBusy||(folderAccess&&!current?.loaded))return;const v=video();if(!v||!current||current.id!==activeId()||v.readyState<2||!v.videoWidth){status('請先播放影片，等待影片載入。');return;}if(ad()){status('廣告播放中，請稍後再開始。');return;}try{crop();}catch(e){status(e.message);return;}if(!current.frames.length)current.title=titleOf()||current.id;starting=true;const token=++generation;update();try{mode='direct';if($('forceTab').checked)mode='tab';else try{drawTest(v);}catch(_){mode='tab';}if(mode==='tab'){if(!navigator.mediaDevices?.getDisplayMedia)throw Error('瀏覽器不支援分頁擷取。請使用桌面 Chrome 或 Edge。');status('請在分享視窗選「這個分頁」，不要選其他分頁或螢幕。');let handle=null;try{handle=crypto.randomUUID();navigator.mediaDevices.setCaptureHandleConfig({handle,exposeOrigin:false,permittedOrigins:[location.origin]});}catch(_){handle=null;}const s=await navigator.mediaDevices.getDisplayMedia({video:{displaySurface:'browser',frameRate:{ideal:5,max:10}},audio:false,preferCurrentTab:true,selfBrowserSurface:'include',surfaceSwitching:'exclude',monitorTypeSurfaces:'exclude'});if(token!==generation){s.getTracks().forEach(t=>t.stop());return;}stream=s;const track=s.getVideoTracks()[0];if(!track)throw Error('沒有取得視訊串流。');if(track.getSettings().displaySurface&&track.getSettings().displaySurface!=='browser')throw Error('請只選擇目前的 YouTube 分頁。');if(handle&&typeof track.getCaptureHandle==='function'){if(track.getCaptureHandle()?.handle!==handle)throw Error('不是目前的 YouTube 分頁，已停止以保護隱私。');verified=true;}captureVideo=document.createElement('video');captureVideo.muted=true;captureVideo.playsInline=true;captureVideo.srcObject=s;await captureVideo.play();if(token!==generation)return;track.addEventListener('ended',()=>{if(token===generation)stop('分頁分享已停止。');});}if(token!==generation)return;running=true;starting=false;lastTime=-1;lastTick=0;previous=null;status(mode==='direct'?'自動擷取中（直接讀取影片）。':`自動擷取中（分頁分享${verified?'，已確認目前分頁':''}）。請勿覆蓋或捲走影片。`);update();beginCaptureTimer();}catch(e){if(token===generation)stop(`無法開始：${e.message||e.name}`);}}
  // Compute the rendered video content rectangle, not the controls/container.
  // Reusable canvases: the full-resolution buffer is allocated only on a
  // candidate, and released when capture stops. toBlob snapshots its bitmap.
  let smallCanvas=null,fullCanvas=null,thumbCanvas=null;
  function canvasFor(kind,w,h){
    let c=kind==='small'?smallCanvas:kind==='full'?fullCanvas:thumbCanvas;
    if(!c){c=document.createElement('canvas');if(kind==='small')smallCanvas=c;else if(kind==='full')fullCanvas=c;else thumbCanvas=c;}
    if(c.width!==w)c.width=w;if(c.height!==h)c.height=h;return c;
  }
  function releaseCaptureCanvas(){if(fullCanvas){fullCanvas.width=0;fullCanvas.height=0;fullCanvas=null;}}
  function previewOf(source,w,h){
    const ratio=Math.min(1,320/Math.max(1,w),180/Math.max(1,h)),tw=Math.max(1,Math.round(w*ratio)),th=Math.max(1,Math.round(h*ratio));
    try{
      const c=canvasFor('thumb',tw,th),ctx=c.getContext('2d',{alpha:false});ctx.fillStyle='#111';ctx.fillRect(0,0,tw,th);ctx.drawImage(source,0,0,tw,th);
      return new Promise(resolve=>{try{c.toBlob(b=>resolve(b?.type==='image/jpeg'&&b.size<=98304?b:null),'image/jpeg',.76);}catch(_){resolve(null);}});
    }catch(_){return Promise.resolve(null);}
  }
  async function encodeSlide(c){
    // Start both encodes before awaiting so both use the exact same frame.
    const thumbPromise=previewOf(c,c.width,c.height),pngPromise=blobOf(c);
    const [blob,thumb]=await Promise.all([pngPromise,thumbPromise]);return {blob,thumb};
  }
  function frame(v,signatureOnly=false){const [l,t,r,b]=crop();let source=v,sx=0,sy=0,sw=v.videoWidth,sh=v.videoHeight;if(mode==='tab'){if(!captureVideo?.videoWidth||document.visibilityState!=='visible')throw Error('請讓影片分頁保持可見。');const rect=videoContentRect(v),{left:x,top:y,width:rw,height:rh}=rect;if(!rectVisible(rect,innerWidth,innerHeight))throw Error('影片未完整顯示，請捲回播放器或縮小視窗內容。');const kx=captureVideo.videoWidth/innerWidth,ky=captureVideo.videoHeight/innerHeight;if(Math.abs(kx/ky-1)>.06)throw Error('分享畫面與分頁比例不符，請重新分享目前分頁。');source=captureVideo;sx=x*kx;sy=y*ky;sw=rw*kx;sh=rh*ky;const overlay=host.getBoundingClientRect();if(overlay.left<x+rw&&overlay.right>x&&overlay.top<y+rh&&overlay.bottom>y)throw Error('擷取面板覆蓋影片，請先收合；若仍重疊，退出滿版影片。');}sx+=sw*l;sy+=sh*t;sw*=r-l;sh*=b-t;let c=null;const small=canvasFor('small',W,H);const sc=small.getContext('2d',{willReadFrequently:true});if(signatureOnly){sc.drawImage(source,sx,sy,sw,sh,0,0,W,H);}else{c=canvasFor('full',Math.max(1,Math.round(sw)),Math.max(1,Math.round(sh)));const ctx=c.getContext('2d');ctx.drawImage(source,sx,sy,sw,sh,0,0,c.width,c.height);sc.drawImage(c,0,0,W,H);}const sig=signature(sc.getImageData(0,0,W,H).data);let sum=0,sq=0;for(let i=0;i<sig.length;i+=3){sum+=sig[i];sq+=sig[i]**2;}const n=sig.length/3,avg=sum/n;if(sq/n-avg*avg<12&&(avg<15||avg>245))throw Error('偵測到近乎空白畫面，暫不擷取。');return {c,sig};}
  function blobOf(c){return new Promise((resolve,reject)=>c.toBlob(b=>b?.type==='image/png'?resolve(b):reject(Error('PNG 圖片編碼失敗')),'image/png'));}
  async function sample(manual=false){if(scan||!running||busy||!current||current.id!==activeId())return;const v=video();if(!v||v.readyState<2||v.seeking||ad()||(!manual&&(v.paused||v.ended))){previous=null;lastTime=-1;return;}if(current.frames.length>=MAX){stop('已達 500 張上限，請匯出。');return;}const t=v.currentTime;if(!Number.isFinite(t))return;if(!manual&&lastTime>=0&&(t<=lastTime||t-lastTime>Math.max(15,Number($('interval').value)*Math.max(1,v.playbackRate)*3)))previous=null;lastTime=t;busy=true;const token=generation,s=current;update();try{const threshold=Number($('sensitivity').value),prior=previous;let candidate=frame(v,!manual);const time=manual?t:(prior?.time??t);previous={sig:candidate.sig,time:t};if(!manual&&!decide(prior?.sig,candidate.sig,s.frames,threshold)){status('自動偵測中：等待畫面穩定或略過相似畫面。');return;}if(!manual){candidate=frame(v);previous={sig:candidate.sig,time:t};if(!decide(prior?.sig,candidate.sig,s.frames,threshold))return;}const {blob,thumb}=await encodeSlide(candidate.c);if(token!==generation||s!==current||!running)return;const f={time,sig:candidate.sig,blob,thumb,mode,url:URL.createObjectURL(thumb||blob)};s.frames.push(f);scheduleSave(s,f);render();status(`已擷取 ${stamp(time)}${manual?'（手動）':''}，共 ${s.frames.length} 張。`);}catch(e){if(token===generation){previous=null;status(`暫停取樣：${e.message||e.name}`);if(e.name==='SecurityError')stop('影片不允許直接讀取，請勾選「強制使用分頁擷取」再開始。');}}finally{if(token===generation){busy=false;update();}}}

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
          try{b=frame(q.v,true);if(decide(a.sig,b.sig,q.session.frames,q.threshold))b=frame(q.v);else b=null;}catch(e){b=null;if(!String(e.message).includes('近乎空白'))throw e;}
          if(b&&decide(a.sig,b.sig,q.session.frames,q.threshold)){
            const {blob,thumb}=await encodeSlide(b.c);scanCheck(q);
            if(q.bytes+blob.size>SCAN_BYTES){finishScan(q,'已達約 400 MiB 圖片安全上限，請先匯出已擷取的圖片。');return;}
            const f={time:actual,sig:b.sig,blob,thumb,mode:'direct',method:'quick-scan',url:URL.createObjectURL(thumb||blob)};q.session.frames.push(f);scheduleSave(q.session,f);
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
  function startScan(){hideCropEditor();
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


  // Optional storage binding used by the cloud-first extension. Offline PNGs
  // live in extension IndexedDB; lightweight history counts use extension storage.
  let folderHandle=null,folderBusy=0,folderPending=0,folderAccess=false,folderNote='',folderQueue=Promise.resolve();
  const folderSupported=()=>!!chrome.runtime?.id;
  const cloudLocal={name:'本機離線資料庫'};let cloudState={connected:false,pending:0},cloudStatusAt=0,cloudStatusBusy=false,cloudStatusReady=false;
  function cloudPhase(s){
    if(!cloudStatusReady)return ['Google Drive · 讀取狀態…','neutral'];
    if(s.syncing)return ['Google Drive · 同步中 · 待傳 '+s.pending+' 張','warn'];
    if(!s.connected)return ['離線本機模式 · 待傳 '+s.pending+' 張','neutral'];
    if(s.checkError||s.syncError)return ['Google Drive · 需檢查同步 · 待傳 '+s.pending+' 張','bad'];
    if(s.pending)return ['Google Drive · 待同步 '+s.pending+' 張','warn'];
    if(s.lastUploadedAt)return ['Google Drive · 最近成功上傳 '+(s.lastUploadCount||1)+' 張（'+new Date(s.lastUploadedAt).toLocaleTimeString('zh-TW',{hour12:false})+'） · 待傳 0 張','good'];
    return ['Google Drive · 已綁定 · 無待傳','good'];
  }
  async function pollCloudStatus(force=false){
    if(cloudStatusBusy||(!force&&(document.hidden||$('panel').hidden||performance.now()-cloudStatusAt<6000)))return;
    cloudStatusBusy=true;cloudStatusAt=performance.now();
    try{cloudState=await rpc('status');cloudStatusReady=true;updateFolderUI();}
    catch(_){if(!cloudStatusReady){$('cloudSummary').textContent='同步狀態暫不可用';$('cloudSummary').dataset.tone='warn';}}
    finally{cloudStatusBusy=false;}
  }
  async function rpc(type,data={}){const r=await chrome.runtime.sendMessage({type,...data});if(!r?.ok)throw Error(r?.error||'擴充套件尚未準備好');return r.data;}
  function toBase64(blob){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(reader.error);reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.readAsDataURL(blob);});}
  function fromBase64(raw,modified){const bytes=Uint8Array.from(atob(raw),c=>c.charCodeAt(0));return new File([bytes],'slide.png',{type:'image/png',lastModified:modified||0});}

  // History counts live in extension storage and are rendered without fetching PNGs.
  // The original Drive files remain authoritative; legacy youtube.com storage is
  // read only once for a safe migration.
  const countPrefix='dg-slides-extension-count-v1:';
  const historyIndex=new Map();let positiveHistoryCount=0;
  const pendingHistory=new Map();let historyFlushTimer=null,historyFlushBusy=false,historyReady=false;
  let historyDirty=true,historyLimit=50,historyView=false,historyUpdating=false;
  function validIndexId(id){return /^[A-Za-z0-9_-]{11}$/.test(id||'');}
  function cleanTitle(title,id){
    const t=typeof title==='string'?title.replace(/\s*-\s*YouTube\s*$/i,'').trim().slice(0,350):'';
    return t&&t!==id&&t.toLowerCase()!=='youtube'?t:'';
  }
  function decodeRecord(raw){
    try{
      const v=JSON.parse(raw);
      if(!Number.isSafeInteger(v?.count)||v.count<0)return null;
      return {count:v.count,updatedAt:Number.isFinite(v.updatedAt)?v.updatedAt:0,title:typeof v.title==='string'?v.title.slice(0,350):''};
    }catch(_){return null;}
  }
  function setHistoryRow(id,row){
    const prior=historyIndex.get(id),oldPositive=!!(prior&&prior.count>0),newPositive=!!(row&&row.count>0);
    if(oldPositive!==newPositive)positiveHistoryCount+=newPositive?1:-1;
    if(row)historyIndex.set(id,row);else historyIndex.delete(id);
    const session=sessions.get(id);if(session&&!session.loaded)session.diskCount=row?.count??null;
  }
  function readLegacyHistory(){
    const rows=[],keys=[];
    try{
      for(let i=0;i<localStorage.length;i++){
        const key=localStorage.key(i);if(!key?.startsWith(countPrefix))continue;
        const id=key.slice(countPrefix.length);if(!validIndexId(id))continue;
        const row=decodeRecord(localStorage.getItem(key));
        if(row){rows.push({videoId:id,...row});keys.push(key);}
      }
    }catch(_){}
    return {rows,keys};
  }
  function queueHistoryWrite(id,row){
    pendingHistory.set(id,{videoId:id,...row});
    if(historyFlushTimer!==null)return;
    historyFlushTimer=setTimeout(()=>{historyFlushTimer=null;void flushHistoryWrites();},750);
  }
  async function flushHistoryWrites(){
    if(historyFlushBusy||!historyReady||!pendingHistory.size)return;
    historyFlushBusy=true;
    const chunk=[...pendingHistory.values()].slice(0,300);
    for(const v of chunk)pendingHistory.delete(v.videoId);
    try{
      const merged=await rpc('historyUpsert',{rows:chunk});
      for(const v of merged){
        const existing=historyIndex.get(v.videoId);
        if(!existing||v.count>existing.count||(!existing.title&&v.title))setHistoryRow(v.videoId,{count:Math.max(v.count,existing?.count||0),title:existing?.title||v.title,updatedAt:Math.max(v.updatedAt,existing?.updatedAt||0)});
      }
    }catch(_){
      for(const v of chunk)if(!pendingHistory.has(v.videoId))pendingHistory.set(v.videoId,v);
    }finally{
      historyFlushBusy=false;
      if(pendingHistory.size&&historyFlushTimer===null)historyFlushTimer=setTimeout(()=>{historyFlushTimer=null;void flushHistoryWrites();},2000);
    }
  }
  async function initializeHistory(){
    try{
      const initial=await rpc('historySnapshot');
      for(const v of initial){
        const existing=historyIndex.get(v.videoId);
        if(!existing||v.count>existing.count||(!existing.title&&v.title))setHistoryRow(v.videoId,{count:Math.max(v.count,existing?.count||0),title:existing?.title||v.title,updatedAt:Math.max(v.updatedAt,existing?.updatedAt||0)});
      }
      const legacy=readLegacyHistory();
      // Commit migration to extension storage before deleting any youtube.com legacy data.
      for(let i=0;i<legacy.rows.length;i+=300){
        const merged=await rpc('historyUpsert',{rows:legacy.rows.slice(i,i+300)});
        for(const v of merged){
          const existing=historyIndex.get(v.videoId);
          if(!existing||v.count>existing.count||(!existing.title&&v.title))setHistoryRow(v.videoId,{count:Math.max(v.count,existing?.count||0),title:existing?.title||v.title,updatedAt:Math.max(v.updatedAt,existing?.updatedAt||0)});
        }
      }
      for(const key of legacy.keys)try{localStorage.removeItem(key);}catch(_){}
    }catch(_){
      // A temporary extension-storage error must not prevent using the legacy cache.
      const legacy=readLegacyHistory();
      for(const v of legacy.rows){
        const prior=historyIndex.get(v.videoId);
        if(!prior||v.count>prior.count)setHistoryRow(v.videoId,{count:Math.max(v.count,prior?.count||0),title:prior?.title||v.title,updatedAt:Math.max(v.updatedAt,prior?.updatedAt||0)});
      }
    }finally{historyReady=true;onIndexChange();update();void flushHistoryWrites();}
  }
  function cachedCount(id){return historyIndex.get(id)?.count??null;}
  function storeRecord(id,count,title,changedAt,quiet=false){
    if(!validIndexId(id)||!Number.isSafeInteger(count)||count<0)return;
    const prior=historyIndex.get(id),next={count,title:cleanTitle(title,id)||prior?.title||'',updatedAt:changedAt??(prior?.count===count?prior.updatedAt:Date.now())};
    if(prior&&prior.count===next.count&&prior.title===next.title&&prior.updatedAt===next.updatedAt)return;
    setHistoryRow(id,next);
    queueHistoryWrite(id,next);
    // Updating a title has no effect on badge counts; avoid scanning all thumbnails.
    if(!quiet){historyDirty=true;if(prior?.count!==next.count)queueBadgeScan(document);if(historyView&&!$('panel').hidden&&!historyUpdating)renderHistory();}
  }
  function cacheCount(s){
    if(!s.diskNames)return;
    s.diskCount=s.diskNames.size;
    storeRecord(s.id,s.diskCount,s.title);
  }
  function rememberCurrentTitle(){
    if(!current||current.id!==activeId())return;
    const t=cleanTitle(titleOf(),current.id);
    if(!t)return;
    // Do not overwrite a useful recorded title with a generic initial SPA title.
    current.title=t;
    const r=historyIndex.get(current.id);
    if(r&&r.title!==t)storeRecord(current.id,r.count,t,r.updatedAt);
  }
  function newSession(id,title){const session={id,title:historyIndex.get(id)?.title||title,frames:[],diskCount:cachedCount(id),diskNames:null,loaded:false,loading:false,loadAttempted:false,cropEdited:false};void loadSavedCrop(session);return session;}
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
    if($('panel').hidden||historyView||!folderHandle||!folderAccess||!current||current.loaded||current.loading||current.loadAttempted||folderBusy||running||starting||exporting)return;
    void refreshFolder(current);
  }

  const safeId=id=>typeof id==='string'&&/^[A-Za-z0-9_-]{11}$/.test(id);
  function diskMeta(name,extra={}){
    const old=String(name).match(/^slide_(\d{13})_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})_(direct|tab)_(quick|normal)\.png$/);
    const simple=String(name).match(/^(\d{2,})-(\d{2})-(\d{2})-(\d{3})(?:_(\d{2,}))?\.png$/);
    if(!old&&!simple)return null;
    if(simple&&(Number(simple[2])>59||Number(simple[3])>59||Number(simple[4])>999||simple[5]&&Number(simple[5])<2))return null;
    const parsedMs=old?Number(old[1]):((Number(simple[1])*60+Number(simple[2]))*60+Number(simple[3]))*1000+Number(simple[4]);
    const timestampMs=Number.isSafeInteger(extra.timestampMs)&&extra.timestampMs>=0?extra.timestampMs:parsedMs;
    if(!Number.isSafeInteger(timestampMs)||timestampMs<0)return null;
    const source=['direct','tab'].includes(extra.source)?extra.source:old?.[3]||'direct';
    const method=['quick','normal'].includes(extra.mode)?extra.mode:old?.[4]||'normal';
    return {time:timestampMs/1000,mode:source,...(method==='quick'?{method:'quick-scan'}:{}),...(extra.slideId||old?.[2]?{slideId:extra.slideId||old?.[2]}:{}),...(extra.capturedAt?{capturedAt:extra.capturedAt}:{})};
  }
  function slideTimeName(timeMs,serial=1){
    const ms=Math.round(Math.max(0,timeMs)),pad=(n,k)=>String(n).padStart(k,'0');
    return pad(Math.floor(ms/3600000),2)+'-'+pad(Math.floor(ms/60000)%60,2)+'-'+pad(Math.floor(ms/1000)%60,2)+'-'+pad(ms%1000,3)+(serial>1?'_'+pad(serial,2):'')+'.png';
  }
  function assignDiskName(f,s){
    if(diskMeta(f.diskName))return f.diskName;
    const timeMs=Math.round(Math.max(0,f.time)*1000);
    const used=s.diskNames||new Set();
    const active=new Set(s.frames.map(x=>x.diskName).filter(Boolean));
    for(let serial=1;serial<=9999;serial++){
      const name=slideTimeName(timeMs,serial);
      if(!used.has(name)&&!active.has(name)){f.diskName=name;return name;}
    }
    throw Error('同一時間點圖片過多，無法命名');
  }
  function errorText(e){return String(e?.message||e?.name||'未知錯誤').replace(/[\r\n]+/g,' ').slice(0,180);}
  function updateFolderUI(){
    const choose=$('folderChoose'),refresh=$('folderRefresh'),info=$('folderInfo');
    const summary=$('cloudSummary'),[label,tone]=cloudPhase(cloudState);if(summary.textContent!==label)summary.textContent=label;summary.dataset.tone=tone;
    choose.disabled=!folderSupported();
    refresh.disabled=!current||running||starting||exporting||folderBusy>0;
    const n=current?.frames.length||0,saved=current?.frames.filter(f=>f.saved).length||0;
    info.textContent=(cloudState.connected?'Google Drive 已設定':'離線本機模式')+' · 本機已保留／已讀取 '+saved+'/'+n+' 張'+(folderPending?' · 本機寫入中 '+folderPending+' 張':'')+(folderBusy?' · 處理中':'')+(folderNote?' · '+folderNote:'');
  }
  function enqueueFolder(work){const p=folderQueue.then(work);folderQueue=p.catch(()=>{});return p;}
  async function saveFrame(h,s,f){
    if(h!==folderHandle||!s.frames.includes(f)||f.saved)return;
    if(f.blob.size>24*1024*1024)throw Error('單張超過測試版 24 MiB 傳輸上限，請先匯出 ZIP');
    const name=assignDiskName(f,s),data=await toBase64(f.blob);
    f.slideId??=crypto.randomUUID();f.capturedAt??=new Date().toISOString();
    const result=await rpc('put',{videoId:s.id,name,title:s.title,data,slideId:f.slideId,timestampMs:Math.round(f.time*1000),source:f.mode==='tab'?'tab':'direct',mode:f.method==='quick-scan'?'quick':'normal',capturedAt:f.capturedAt});
    if(result?.name&&result.name!==name)f.diskName=result.name;
    f.saved=true;
    if(!s.diskNames)s.diskNames=new Set(s.frames.filter(x=>x.saved&&x.diskName).map(x=>x.diskName));
    s.diskNames.add(f.diskName||name);cacheCount(s);
  }
  function scheduleSave(s,f){
    if(!folderHandle)return;
    const h=folderHandle;folderPending++;updateFolderUI();
    void enqueueFolder(async()=>{try{await saveFrame(h,s,f);folderNote='PNG 已保存本機；雲端結果見上方';}catch(e){folderNote='本機寫入失敗：'+errorText(e)+'；先匯出 ZIP';}finally{folderPending--;releaseInactive();update();void pollCloudStatus(true);}});
  }
  // Derived data only: a bounded, per-origin IndexedDB preview/signature cache.
  // Original files retain their original bytes; File metadata is checked before
  // a cache hit. A miss (or storage failure) always falls back to the PNG.
  const previewDBName='dg-youtube-slides-preview-v1',previewStore='previews',previewVersion=1,previewLimit=600;
  let previewDBPromise=null,previewWrites=0;
  function openPreviewDB(){
    if(previewDBPromise)return previewDBPromise;
    previewDBPromise=new Promise(resolve=>{
      try{
        const req=indexedDB.open(previewDBName,1);
        req.onupgradeneeded=()=>{const store=req.result.createObjectStore(previewStore,{keyPath:'key'});store.createIndex('at','at');};
        req.onerror=req.onblocked=()=>resolve(null);
        req.onsuccess=()=>{const db=req.result;db.onversionchange=()=>{db.close();previewDBPromise=null;};resolve(db);};
      }catch(_){resolve(null);}
    });return previewDBPromise;
  }
  async function previewOp(mode,work){
    const db=await openPreviewDB();if(!db)return null;
    return new Promise(resolve=>{
      try{
        const tx=db.transaction(previewStore,mode),store=tx.objectStore(previewStore);let result=null;
        tx.oncomplete=()=>resolve(result);tx.onerror=tx.onabort=()=>resolve(null);
        work(store,v=>{result=v;});
      }catch(_){resolve(null);}
    });
  }
  function previewKey(id,name){return id+'/'+name;}
  async function readPreview(id,name,file){
    if(!Number.isFinite(file.lastModified))return null;
    const r=await previewOp('readonly',(store,done)=>{const op=store.get(previewKey(id,name));op.onsuccess=()=>done(op.result);});
    if(!r||r.version!==previewVersion||r.size!==file.size||r.modified!==file.lastModified||
      !(r.sig instanceof Uint8Array)||r.sig.length!==W*H*3||!(r.thumb instanceof Blob)||r.thumb.type!=='image/jpeg'||r.thumb.size>98304)return null;
    return {sig:r.sig,thumb:r.thumb};
  }
  async function prunePreviews(){
    await previewOp('readwrite',(store,done)=>{
      const count=store.count();count.onsuccess=()=>{
        let excess=count.result-previewLimit;if(excess<=0){done(true);return;}
        const cursor=store.index('at').openCursor();cursor.onsuccess=()=>{const c=cursor.result;if(c&&excess>0){c.delete();excess--;c.continue();}else done(true);};
      };
    });
  }
  async function writePreview(id,name,file,derived){
    if(!Number.isFinite(file.lastModified)||!derived.thumb||derived.thumb.size>98304||derived.sig?.length!==W*H*3)return;
    await previewOp('readwrite',(store,done)=>{const op=store.put({key:previewKey(id,name),version:previewVersion,size:file.size,modified:file.lastModified,sig:derived.sig,thumb:derived.thumb,at:Date.now()});op.onsuccess=()=>done(true);});
    if(++previewWrites%32===0)await prunePreviews();
  }
  async function deletePreview(id,name){
    await previewOp('readwrite',(store,done)=>{const op=store.delete(previewKey(id,name));op.onsuccess=()=>done(true);});
  }
  async function derivePreview(file){
    const bytes=new Uint8Array(await file.slice(0,8).arrayBuffer());
    if(bytes.join(',')!=='137,80,78,71,13,10,26,10')throw Error('PNG 格式不符');
    const bitmap=await createImageBitmap(file);
    try{
      const c=canvasFor('small',W,H),ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(bitmap,0,0,W,H);
      const sig=signature(ctx.getImageData(0,0,W,H).data),promise=previewOf(bitmap,bitmap.width,bitmap.height);
      return {sig,thumb:await promise};
    }finally{bitmap.close();}
  }
  async function getDerived(id,name,file){
    const hit=await readPreview(id,name,file);if(hit)return hit;
    const derived=await derivePreview(file);await writePreview(id,name,file,derived);return derived;
  }
  async function readAndSave(h,s){
    if(h!==folderHandle||current!==s)return false;
    const listed=await rpc('list',{videoId:s.id});
    if(current!==s)return false;
    cloudState=listed.state||cloudState;
    const files=listed.files.filter(x=>diskMeta(x.name)).sort((a,b)=>diskMeta(a.name).time-diskMeta(b.name).time||a.name.localeCompare(b.name));
    s.diskNames=new Set([...files.map(x=>x.name),...s.frames.filter(f=>f.saved&&f.diskName).map(f=>f.diskName)]);
    cacheCount(s);
    let skipped=0,restored=0,partial=false,total=s.frames.reduce((n,f)=>n+f.blob.size,0);
    const known=new Set(s.frames.map(f=>f.diskName).filter(Boolean));
    for(const item of files){
      if(current!==s)return false;if(known.has(item.name))continue;
      if(s.frames.length>=MAX){partial=true;break;}
      if(item.size>24*1024*1024){skipped++;continue;}
      try{
        if(total+item.size>SCAN_BYTES){partial=true;break;}
        const result=await rpc('get',{videoId:s.id,name:item.name});
        const blob=fromBase64(result.data,result.modified);
        if(total+blob.size>SCAN_BYTES){partial=true;break;}
        const {sig,thumb}=await getDerived(s.id,item.name,blob);
        if(current!==s)return false;
        const f={...diskMeta(item.name,item),sig,blob,thumb,diskName:item.name,saved:true,url:URL.createObjectURL(thumb||blob)};
        s.frames.push(f);known.add(item.name);total+=blob.size;restored++;
      }catch(_){skipped++;}
    }
    for(const f of s.frames){if(current!==s)return false;if(!f.saved)try{await saveFrame(h,s,f);}catch(_){skipped++;}}
    const notes=[restored?'還原 '+restored+' 張':'已讀取',listed.warning,partial?'達記憶體上限':'',skipped?'略過 '+skipped+' 張（未讀取／超過傳輸上限）':''].filter(Boolean);
    folderNote=notes.join('；');s.loaded=true;if(current===s)render();return true;
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
  async function chooseFolder(){try{await rpc('options');}catch(e){folderNote=errorText(e);update();}}
  async function requestFolder(){
    if(!current||running||starting||exporting||folderBusy)return;
    try{cloudState=await rpc('status');await refreshFolder(current);void rpc('sync').catch(()=>{});}catch(e){folderNote=errorText(e);update();}
  }
  async function deleteSlides(){status('測試版暫停刪除，原始 PNG 不會被移除。');}
  async function initFolder(){
    folderHandle=cloudLocal;folderAccess=true;folderBusy++;update();
    try{cloudState=await rpc('status');cloudStatusReady=true;}catch(e){folderNote=errorText(e);}
    finally{folderBusy--;update();maybeLoadCurrent();}
  }

  function syncHistoryControls(){
    $('historyRefresh').disabled=historyUpdating||running||starting||exporting||folderBusy>0||folderPending>0;$('historyRebuild').disabled=$('historyRefresh').disabled;
    $('tabHistory').disabled=running||starting||exporting;
  }
  function setHistoryView(show,interact=true){
    if(interact&&show&&(running||starting||exporting))return;
    historyView=!!show;if(historyView)hideCropEditor();
    $('viewCurrent').hidden=historyView;$('viewHistory').hidden=!historyView;
    $('tabCurrent').setAttribute('aria-pressed',String(!historyView));$('tabHistory').setAttribute('aria-pressed',String(historyView));
    if(!interact)return;
    if(historyView){historyLimit=50;renderHistory();}
    else{rememberCurrentTitle();if(current&&!current.loaded&&!current.loading)current.loadAttempted=false;render();maybeLoadCurrent();}
  }
  function historyRows(){
    const q=$('historySearch').value.trim().toLowerCase();
    return [...historyIndex.entries()].filter(([id,r])=>r.count>0&&(!q||(id+' '+r.title).toLowerCase().includes(q))).sort((a,b)=>b[1].updatedAt-a[1].updatedAt||a[0].localeCompare(b[0]));
  }
  function renderHistory(force=false){
    if(!historyView||$('panel').hidden)return;
    if(!historyDirty&&!force)return;
    historyDirty=false;
    const rows=historyRows(),all=[...historyIndex.values()].filter(r=>r.count>0);
    $('historySummary').textContent=all.length+' 部影片 · '+all.reduce((n,r)=>n+r.count,0)+' 張';
    const list=$('historyList'),frag=document.createDocumentFragment();
    const formatter=new Intl.DateTimeFormat('zh-TW',{year:'numeric',month:'2-digit',day:'2-digit'});
    for(const [id,r] of rows.slice(0,historyLimit)){
      const a=document.createElement('a');a.href='/watch?v='+encodeURIComponent(id);
      a.title=r.title||id;
      const line=document.createElement('div');line.className='histline';
      const name=document.createElement('span');name.className='histtitle';name.textContent=r.title||id;
      const count=document.createElement('span');count.className='histcount';count.textContent=r.count+' 張';
      line.append(name,count);
      const meta=document.createElement('div');meta.className='histmeta';
      meta.textContent=r.updatedAt>0?'索引更新：'+formatter.format(new Date(r.updatedAt)):id;
      a.append(line,meta);frag.append(a);
    }
    if(!rows.length){const empty=document.createElement('p');empty.className='muted';empty.textContent=all.length?'沒有符合搜尋條件的影片。':'尚無已索引的影片。可點「更新索引」或開啟已擷取影片。';frag.append(empty);}
    list.replaceChildren(frag);$('historyMore').hidden=rows.length<=historyLimit;
  }
  function onIndexChange(){
    historyDirty=true;queueBadgeScan(document);
    if(historyView&&!$('panel').hidden&&!historyUpdating)renderHistory();
  }
  // Explicitly requested index refresh enumerates only filenames, never getFile,
  // createImageBitmap, thumbnails, video streams, or ZIP contents.
  function applyHistoryRows(rows,protectLocal=true){
    for(const row of rows||[]){
      if(!validIndexId(row.videoId)||!Number.isSafeInteger(row.count)||row.count<0)continue;
      const existing=historyIndex.get(row.videoId),count=protectLocal?Math.max(existing?.count||0,row.count):row.count;
      const session=sessions.get(row.videoId);
      if(session&&!session.loaded){session.diskCount=count;session.loadAttempted=false;}
      storeRecord(row.videoId,count,row.title||session?.title||existing?.title||'',Math.max(existing?.updatedAt||0,row.updatedAt||0),true);
    }
    onIndexChange();
  }
  async function refreshHistory(rebuild=false){
    if(historyUpdating||running||starting||exporting||folderBusy||folderPending)return;
    historyUpdating=true;folderBusy++;update();
    try{
      $('historyStatus').textContent=rebuild?'正在重新掃描雲端 PNG 檔名（不下載圖片）…':'正在讀取 Google Drive 索引…';
      const result=await rpc(rebuild?'rebuildIndex':'index');cloudState=result.state||cloudState;
      applyHistoryRows(result.rows,!rebuild);
      $('historyStatus').textContent=result.warning||({index:'已讀取雲端 index.json。',rebuild:'已完成完整掃描並更新 index.json、INDEX.md。',cache:'已載入本機索引。'}[result.source]||'索引已更新。');
    }catch(e){$('historyStatus').textContent='更新失敗：'+errorText(e)+'；原快取已保留。';}
    finally{historyUpdating=false;folderBusy--;historyDirty=true;renderHistory();releaseInactive();update();maybeLoadCurrent();}
  }
  // Read a small cloud index after the first paint; never enumerate PNGs during startup.
  async function quickHistorySync(){
    try{const result=await rpc('indexQuick');if(result.source==='local')return;applyHistoryRows(result.rows,true);}catch(_){}
  }
  // Thumbnail badges: batched incremental observation of YouTube thumbnail
  // anchors, with no image fetches and no mutation of YouTube links.
  const badgeClass='dg-slide-count-badge',badgeSelector='a#thumbnail[href],a.yt-lockup-view-model__content-image[href],a.yt-lockup-view-model-wiz__content-image[href],a.yt-lockup-view-model__content-image,a.yt-lockup-view-model-wiz__content-image,a[href] > yt-thumbnail-view-model';
  let badgeObserver=null,badgeTimer=null,badgeRoots=new Set(),badgeRecords=new Map();
  function linkVideoId(anchor){
    try{
      const u=new URL(anchor.getAttribute('href')||'',location.origin);
      if(u.origin!==location.origin||!(u.pathname==='/watch'||/^\/(?:live|shorts)\//.test(u.pathname)))return null;
      const id=u.pathname==='/watch'?u.searchParams.get('v'):u.pathname.split('/')[2];
      return validIndexId(id)?id:null;
    }catch(_){return null;}
  }
  function badgeTarget(el){return el?.tagName==='A'?el:el?.closest?.('a[href]');}
  function removeBadge(anchor){
    const old=badgeRecords.get(anchor);if(!old)return;
    old.badge.remove();
    if(old.positionChanged&&anchor.style.position==='relative')anchor.style.position=old.previousPosition;
    badgeRecords.delete(anchor);
  }
  function cardTitle(anchor,id){
    const card=anchor.closest('ytd-rich-item-renderer,ytd-video-renderer,ytd-grid-video-renderer,ytd-compact-video-renderer,ytd-playlist-video-renderer,ytd-reel-item-renderer,yt-lockup-view-model');
    if(!card)return '';
    const candidates=card.querySelectorAll('a#video-title,a#video-title-link,a.yt-lockup-metadata-view-model__title,a.yt-lockup-metadata-view-model-wiz__title');
    for(const a of candidates){if(linkVideoId(a)!==id)continue;const t=cleanTitle(a.getAttribute('title')||a.textContent,id);if(t)return t;}
    return '';
  }
  function paintBadge(anchor){
    if(!anchor?.isConnected){if(anchor)removeBadge(anchor);return;}
    const id=linkVideoId(anchor),r=id?historyIndex.get(id):null;
    if(!r||r.count<=0){removeBadge(anchor);return;}
    let item=badgeRecords.get(anchor);
    if(!item){
      const badge=document.createElement('span');badge.className=badgeClass;
      // The overlay lives inside the existing thumbnail anchor and is inert.
      const changed=getComputedStyle(anchor).position==='static',previousPosition=anchor.style.position;
      if(changed)anchor.style.position='relative';
      anchor.append(badge);item={badge,positionChanged:changed,previousPosition};badgeRecords.set(anchor,item);
    }
    if(item.badge.parentNode!==anchor)anchor.append(item.badge);
    const label=r.count+' 張投影片';if(item.badge.textContent!==label)item.badge.textContent=label;
    item.badge.title='已記錄 '+r.count+' 張投影片（本機索引）';
    if(!r.title){const title=cardTitle(anchor,id);if(title)storeRecord(id,r.count,title,r.updatedAt);}
  }
  function flushBadges(){
    badgeTimer=null;const roots=[...badgeRoots];badgeRoots.clear();
    // Remove records whose cards were recycled or detached; avoid retaining DOM.
    for(const [anchor] of badgeRecords)if(!anchor.isConnected)removeBadge(anchor);
    const hasRecords=positiveHistoryCount>0;
    if(!hasRecords){for(const [anchor] of badgeRecords)removeBadge(anchor);return;}
    const anchors=new Set();
    for(const root of roots){
      if(!root?.isConnected&&root!==document)continue;
      if(root.nodeType===1){if(root.matches(badgeSelector))anchors.add(badgeTarget(root));const near=root.closest('a[href]');if(near&&(near.matches(badgeSelector)||badgeRecords.has(near)))anchors.add(near);}
      for(const el of root.querySelectorAll?.(badgeSelector)||[])anchors.add(badgeTarget(el));
    }
    if(roots.includes(document))for(const [anchor] of badgeRecords)anchors.add(anchor);
    for(const anchor of anchors)paintBadge(anchor);
  }
  function queueBadgeScan(root){
    const hasRecords=positiveHistoryCount>0;
    if(!hasRecords&&!badgeRecords.size)return;
    if(root===document||badgeRoots.size>=80){badgeRoots.clear();badgeRoots.add(document);}
    else if(!badgeRoots.has(document))badgeRoots.add(root);
    if(badgeTimer===null)badgeTimer=setTimeout(flushBadges,160);
  }
  function installBadgeLayer(){
    const css=document.createElement('style');
    css.textContent='.'+badgeClass+'{position:absolute;left:5px;bottom:5px;z-index:3;padding:3px 7px;border-radius:5px;background:rgba(29,78,216,.94);color:white;font:600 11px/1.4 system-ui;pointer-events:none;white-space:nowrap;max-width:calc(100% - 10px);overflow:hidden;text-overflow:ellipsis;box-sizing:border-box}';
    (document.head||document.documentElement).append(css);
    if(typeof MutationObserver==='function'){
      badgeObserver=new MutationObserver(records=>{
        // No work for unindexed users. Ignore our own overlay mutations.
        if(!badgeRecords.size&&positiveHistoryCount===0)return;
        for(const m of records){
          if(m.type==='attributes'){if(m.target.matches?.('a[href]')||badgeRecords.has(m.target))queueBadgeScan(m.target);continue;}
          for(const node of m.addedNodes){if(node.nodeType===1&&!node.classList?.contains(badgeClass)&&node.id!=='dg-slides-host')queueBadgeScan(node);}
          if([...m.removedNodes].some(n=>n.nodeType===1&&!n.classList?.contains(badgeClass)))queueBadgeScan(m.target);
        }
      });
      badgeObserver.observe(document.body||document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['href']});
    }
    chrome.storage.onChanged.addListener((changes,area)=>{
      if(area!=='local')return;
      let countsChanged=false,changed=false;
      for(const [key,value] of Object.entries(changes)){
        if(!key.startsWith('dg-slides-history-v2:'))continue;
        const id=key.slice('dg-slides-history-v2:'.length);
        if(!validIndexId(id))continue;
        const v=value.newValue,previous=historyIndex.get(id);
        const count=Number.isSafeInteger(v?.count)&&v.count>=0?v.count:null;
        if(count===null)continue;
        const next={count:Math.max(count,previous?.count||0),title:previous?.title||cleanTitle(v.title,id),updatedAt:Math.max(previous?.updatedAt||0,v.updatedAt||0)};
        if(previous&&JSON.stringify(previous)===JSON.stringify(next))continue;
        if(previous?.count!==next.count)countsChanged=true;
        setHistoryRow(id,next);changed=true;
      }
      if(changed){historyDirty=true;if(countsChanged)queueBadgeScan(document);if(historyView&&!$('panel').hidden&&!historyUpdating)renderHistory();update();}
    });
    queueBadgeScan(document);
  }
  $('tabCurrent').onclick=()=>setHistoryView(false);
  $('tabHistory').onclick=()=>setHistoryView(true);
  $('historySearch').oninput=()=>{historyLimit=50;historyDirty=true;renderHistory();};
  $('historyMore').onclick=()=>{historyLimit+=50;renderHistory(true);};
  $('historyRefresh').onclick=()=>void refreshHistory(false);$('historyRebuild').onclick=()=>{if(confirm('完整修復會列出所有影片資料夾與 PNG 檔名，耗時較久。確定繼續？'))void refreshHistory(true);};

  $('folderChoose').onclick=chooseFolder;$('folderRefresh').onclick=requestFolder;

  $('toggle').onclick=()=>{route();$('panel').hidden=!$('panel').hidden;$('toggle').setAttribute('aria-expanded',String(!$('panel').hidden));if(!$('panel').hidden){void pollCloudStatus(true);if(historyView){renderHistory();}else{rememberCurrentTitle();if(current&&!current.loaded&&!current.loading)current.loadAttempted=false;render();maybeLoadCurrent();}}};$('start').onclick=start;$('quickStart').onclick=startScan;$('scanPause').onclick=toggleScanPause;$('stop').onclick=()=>{if(scan)scanReport(scan,'手動停止');stop(undefined,true);};$('manual').onclick=()=>sample(true);$('session').onchange=()=>{if(running||starting)return;hideCropEditor();current=sessions.get($('session').value)||null;setCropUnits(selectedCrop());if(current&&!current.loaded&&!current.loading)current.loadAttempted=false;releaseInactive();render();maybeLoadCurrent();};$('clear').onclick=()=>{if(!current||running||starting||exporting||folderBusy)return;void deleteSlides(current,[...current.frames]);};$('export').onclick=async()=>{if(!current?.frames.length||exporting||scan||folderBusy)return;exporting=true;update();try{const s=current,files=makeFiles(s);const blob=await zip(files);const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=exportName(s);a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);status(`已提出下載：${files.length-2} 張投影片。`);}catch(e){status(`匯出失敗：${e.message}`);}finally{exporting=false;releaseInactive();update();maybeLoadCurrent();}};
  window.addEventListener('yt-navigate-finish',route);document.addEventListener('fullscreenchange',()=>{previous=null;});window.addEventListener('pagehide',()=>{hideCropEditor();stop();});window.addEventListener('beforeunload',e=>{if(folderPending||[...sessions.values()].some(s=>s.frames.some(f=>!f.saved))){e.preventDefault();e.returnValue='';}});// YouTube navigation events handle normal routes; a lightweight 3-second
  // fallback repairs the host or missed navigation, without capture polling.
  function repairRoute(){if(!host.isConnected)(document.body||document.documentElement).append(host);route();}
  let captureTimer=null;
  function endCaptureTimer(){if(captureTimer!==null){clearInterval(captureTimer);captureTimer=null;}}
  function beginCaptureTimer(){
    endCaptureTimer();captureTimer=setInterval(()=>{
      route();if(!running||busy||scan)return;
      const now=performance.now();if(now-lastTick>=Number($('interval').value)*1000){lastTick=now;void sample();}
    },250);
  }
  wireCropEditor();installBadgeLayer();void initializeHistory();setInterval(()=>{repairRoute();void pollCloudStatus();},3000);route();update();void initFolder();setTimeout(()=>{void quickHistorySync();},1400);
})();
