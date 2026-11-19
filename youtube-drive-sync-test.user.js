// ==UserScript==
// @name         YouTube Slides - Google Drive Pilot
// @namespace    https://github.com/kevinsmemo/tampermonkey-scripts
// @version      0.1.0
// @description  Open an isolated Google Drive upload/readback test; no changes to the slide extractor.
// @match        https://www.youtube.com/*
// @grant        none
// @run-at       document-idle
// @noframes
// @updateURL    https://raw.githubusercontent.com/kevinsmemo/tampermonkey-scripts/main/youtube-drive-sync-test.user.js
// @downloadURL  https://raw.githubusercontent.com/kevinsmemo/tampermonkey-scripts/main/youtube-drive-sync-test.user.js
// ==/UserScript==
(()=>{
'use strict';
const id='dg-drive-pilot-launcher', destination='https://kevinsmemo.github.io/tampermonkey-scripts/drive-sync-test/';
function videoId(){
 const u=new URL(location.href);
 const v=u.pathname==='/watch'?u.searchParams.get('v'):u.pathname.match(/^\/(?:live|shorts)\/([A-Za-z0-9_-]{11})(?:\/|$)/)?.[1];
 return /^[A-Za-z0-9_-]{11}$/.test(v||'')?v:null;
}
function render(){
 const v=videoId(),old=document.getElementById(id);
 if(!v){old?.remove();return;}
 if(old)return;
 const host=document.createElement('div');host.id=id;host.style.cssText='position:fixed;right:16px;bottom:78px;z-index:2147483645';
 const root=host.attachShadow({mode:'open'}),a=document.createElement('a');
 a.textContent='Drive 同步測試';a.target='_blank';a.rel='noopener noreferrer';a.href=destination+'?v='+encodeURIComponent(v);
 a.style.cssText='display:block;padding:10px 13px;background:#176b47;color:white;font:600 14px system-ui;text-decoration:none;border-radius:9px;border:1px solid #ffffff55;box-shadow:0 2px 8px #0004';
 root.append(a);(document.body||document.documentElement).append(host);
}
function refresh(){const old=document.getElementById(id);old?.remove();render();}
window.addEventListener('yt-navigate-finish',refresh);render();
})();
