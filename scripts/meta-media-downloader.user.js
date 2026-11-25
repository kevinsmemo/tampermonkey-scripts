// ==UserScript==
// @name         Meta Media Downloader
// @namespace    https://github.com/kevinsmemo/tampermonkey-scripts
// @version      6.6.0
// @description  Download photos and videos from Threads and Instagram with isolated site adapters.
// @author       StevenJon0826 (original); kevinsmemo (maintenance)
// @homepageURL  https://github.com/kevinsmemo/tampermonkey-scripts
// @match        https://www.threads.com/*
// @match        https://threads.com/*
// @match        https://www.threads.net/*
// @match        https://threads.net/*
// @match        https://www.instagram.com/*
// @match        https://instagram.com/*
// @grant        GM_download
// @grant        GM_xmlhttpRequest
// @connect      fbcdn.net
// @connect      cdninstagram.com
// @noframes
// @run-at       document-idle
// @updateURL    none
// @downloadURL  none
// @license      MIT
// ==/UserScript==

/*
 * Based on Threads.net Media Downloader v5, original script 508541
 * https://greasyfork.org/en/scripts/508541-threads-net-media-downloader-v5
 *
 * Original author (script metadata): StevenJon0826
 * Greasy Fork publisher: d1 shakeyou
 * Maintained adaptation: Copyright (c) 2026 kevinsmemo
 *
 * Released under the MIT License.
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to
 * deal in the Software without restriction, including without limitation the
 * rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
 * sell copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */

(() => {
  'use strict';

  const CONFIG = Object.freeze({
    autoLikeAfterDownload: false,
    autoRevealSpoilers: false,
    scanDelayMs: 170,
  });
  const BTN = 'tm-threads-v5-download';
  const POST_LINK = 'a[href*="/post/"]';
  const MEDIA_SELECTOR = 'picture img, a[href*="/media"] img, video';
  const ALLOWED_HOSTS = ['fbcdn.net', 'cdninstagram.com', 'threads.com', 'threads.net'];
  const installed = new WeakMap();
  const MORE_GAP = 8;
  const VIEWER='tm-threads-media-viewer',THUMB='tm-threads-media-thumb';
  const thumbnailEntries=new Map();
  let viewerEntry=null, viewerOrigin=null, viewerTimer=null;
  let viewerResizeObserver=null, observedViewerMedia=null;
  const metadataLimit = 64 * 1024 * 1024;
  let scanTimer = null;
  let captureMode = false;
  let captureStartedAt = 0;
  let capturePreviewSeen = false;
  let captureCheckTimer = null;

  if (/^(?:www\.)?instagram\.com$/i.test(location.hostname)) {
    initInstagram();
    return;
  }

  const style = document.createElement('style');
  style.textContent = [
    '.'+BTN+'{position:absolute!important;display:inline-flex!important;flex-direction:row;align-items:center;justify-content:center;gap:8px;z-index:100;margin:0!important;padding:0;border:0;background:transparent;box-shadow:none;box-sizing:border-box;line-height:0;white-space:nowrap;right:12px;top:8px}',
    '.'+BTN+' button{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;min-width:28px;box-sizing:border-box;padding:3px;border:0;border-radius:6px;background:transparent;color:inherit;cursor:pointer;line-height:0}',
    '.'+BTN+' button:hover{background:rgba(128,128,128,.15)}',
    '.'+BTN+' button:disabled{opacity:.6;cursor:wait}',
    '.'+BTN+' button:focus-visible{outline:2px solid currentColor;outline-offset:2px}',
    '.'+BTN+' svg{display:block;width:22px;height:22px;flex:none}',
    '[role="dialog"] .'+BTN+':not(.'+VIEWER+'),[aria-modal="true"] .'+BTN+':not(.'+VIEWER+'){display:none!important}',
    '.'+BTN+'.'+VIEWER+'{position:fixed!important;top:18px;right:18px;z-index:2147483000;color:white;background:rgba(0,0,0,.45);padding:4px 6px;border-radius:9px;backdrop-filter:blur(8px);pointer-events:auto}',
    '.'+VIEWER+'[hidden]{display:none!important}',
    '.'+BTN+'.'+THUMB+'{position:absolute!important;right:auto;top:0;z-index:10;color:white;background:rgba(0,0,0,.45);padding:4px 6px;border-radius:9px;backdrop-filter:blur(8px);pointer-events:auto}',
    '.'+THUMB+'[hidden]{display:none!important}',
    '.'+THUMB+' button:hover{background:rgba(255,255,255,.22)}'
  ].join('');
  (document.head || document.documentElement).appendChild(style);

  function downloadIcon(button,name){
    const icons={
    current:'<path d="M12 3v12m-5-5 5 5 5-5M4 16v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/>',
    all:'<path d="M7 17H6a5 5 0 0 1-1-9.9A7 7 0 0 1 18 8a4.5 4.5 0 0 1 1 8.9h-2M12 11v10m-4-4 4 4 4-4"/>',
    done:'<path d="m5 12 4 4L19 6"/>',
    error:'<path d="M12 4v10m0 4v1"/>',
    busy:'<path d="M12 3a9 9 0 1 1-9 9"/>'
    };
    button.innerHTML='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+icons[name]+'</svg>';
  }

  function identityFrom(href) {
    try {
      const url = new URL(href, location.href);
      if (!/^(?:www\.)?threads\.(?:com|net)$/i.test(url.hostname)) return null;
      const match = /^\/@([^/]+)\/post\/([A-Za-z0-9_-]+)(?:\/|$)/.exec(url.pathname);
      return match ? { user: match[1], code: match[2] } : null;
    } catch (_) { return null; }
  }

  function mediaURL(raw) {
    if (!raw) return null;
    try {
      const url = new URL(raw, location.href);
      if (url.protocol !== 'https:') return null;
      const host = url.hostname.toLowerCase();
      if (!ALLOWED_HOSTS.some(s => host === s || host.endsWith('.' + s))) return null;
      if (/\.(?:m3u8|mpd|m4s|ts)$/i.test(url.pathname)) return null;
      return url.href;
    } catch (_) { return null; }
  }

  function bestSrcset(srcset) {
    if (!srcset) return null;
    const items = srcset.split(',').map(text => {
      const [url, desc = ''] = text.trim().split(/\s+/);
      const n = Number.parseFloat(desc);
      const score = Number.isFinite(n) ?
        (desc.endsWith('w') ? n : desc.endsWith('x') ? n * 1000 : 0) : 0;
      return { url: mediaURL(url), score };
    }).filter(x => x.url);
    items.sort((a, b) => b.score - a.score);
    return items[0]?.url || null;
  }

  function directURL(element) {
    if (element.tagName === 'VIDEO') {
      const sources = [...element.querySelectorAll('source[src]')].map(el => el.src);
      return [element.currentSrc, element.src, ...sources].map(mediaURL).find(Boolean) || null;
    }
    let url = bestSrcset(element.getAttribute('srcset') || element.srcset);
    if (!url) {
      const picture = element.closest('picture');
      if (picture) {
        const variants = [...picture.querySelectorAll('source[srcset]')]
          .map(el => bestSrcset(el.srcset)).filter(Boolean);
        url = variants[0] || null;
      }
    }
    return url || mediaURL(element.currentSrc || element.src);
  }

  // Use a post's own carousel_media list: each entry is one attachment,
  // while video_versions 101/102/103 are quality choices for that attachment.
  function parseNativeMedia(record) {
    const nested = record.media;
    const hasNestedMedia = nested && typeof nested === 'object' &&
      (Array.isArray(nested.carousel_media) || Array.isArray(nested.video_versions) ||
       !!nested.image_versions2);
    const root = hasNestedMedia ? nested : record;
    const carousel = Array.isArray(root.carousel_media) && root.carousel_media.length > 0;
    const attachments = carousel ? root.carousel_media : [root];
    const files = [], seen = new Set();
    let unavailableVideos = 0;
    for (const [position,raw] of attachments.slice(0, 30).entries()) {
      const item = raw?.node || raw?.media || raw;
      if (!item || typeof item !== 'object') continue;
      const versions = Array.isArray(item.video_versions) ? item.video_versions : [];
      const isVideo = versions.length > 0 || item.media_type === 2 ||
        String(item.media_type || '').toUpperCase() === 'VIDEO';
      let url = null;
      if (isVideo) {
        const candidates = versions.map((v, i) => ({
          url: mediaURL(v?.url || v?.src),
          pixels: (Number(v?.width) || 0) * (Number(v?.height) || 0), i
        })).filter(v => v.url).sort((a, b) => b.pixels - a.pixels || a.i - b.i);
        url = candidates[0]?.url || mediaURL(item.video_url);
        if (!url) unavailableVideos++;
      } else {
        const candidates = Array.isArray(item.image_versions2?.candidates)
          ? item.image_versions2.candidates : [];
        const images = candidates.map((v, i) => ({
          url: mediaURL(v?.url || v?.src),
          pixels: (Number(v?.width) || 0) * (Number(v?.height) || 0), i
        })).filter(v => v.url).sort((a, b) => b.pixels - a.pixels || a.i - b.i);
        url = images[0]?.url || mediaURL(item.image_versions2?.url);
      }
      if (!url) continue;
      const parsed = new URL(url);
      const key = parsed.origin + parsed.pathname;
      if (seen.has(key)) continue;
      seen.add(key);
      const aliases = [...new Set([url,...(isVideo?versions:
        (Array.isArray(item.image_versions2?.candidates)?item.image_versions2.candidates:[]))
        .map(v=>mediaURL(v?.url||v?.src)).filter(Boolean)].map(threadsMediaPath).filter(Boolean))];
      const posters = isVideo ? (Array.isArray(item.image_versions2?.candidates)?
        item.image_versions2.candidates:[]).map(v=>mediaURL(v?.url||v?.src)).filter(Boolean)
        .map(threadsMediaPath).filter(Boolean) : [];
      files.push({ type: isVideo ? 'video' : 'image', url, aliases, posters, position:position+1 });
    }
    return { files, total: attachments.length, unavailableVideos, carousel };
  }

  // Threads stores an explicitly attached Instagram post/reel in
  // text_post_app_info.linked_inline_media. Never follow share_info,
  // containing_thread or direct_replies: those are different posts.
  function parsePostRecord(record) {
    const native = parseNativeMedia(record);
    const postMeta={published:postDate(record.taken_at||record.taken_at_timestamp||record.media?.taken_at),
      caption:typeof record.caption?.text==='string'?record.caption.text:
        typeof record.media?.caption?.text==='string'?record.media.caption.text:null};
    native.postMeta=postMeta;
    const linked = record.text_post_app_info?.linked_inline_media ||
      record.linked_inline_media || record.media?.text_post_app_info?.linked_inline_media;
    if (!linked || typeof linked !== 'object' || native.carousel ||
        native.files.some(file => file.type === 'video')) return native;
    const items = Array.isArray(linked) ? linked : [linked];
    const results = items.slice(0,30).map(item => parseNativeMedia(item?.node || item));
    const files = [], seen = new Set();
    for (const item of results) {
      for (const file of item.files) {
        if (seen.has(file.url)) continue;
        seen.add(file.url); files.push(file);
      }
    }
    const videoFiles = files.filter(file => file.type === 'video');
    if(results.length>1)files.forEach((file,i)=>{file.position=results.every(r=>r.files.length===r.total)?i+1:null;});
    const unavailableVideos = results.reduce((sum,r) => sum + r.unavailableVideos,0);
    if (videoFiles.length) return {
      files, total:results.reduce((sum,r) => sum+r.total,0),
      unavailableVideos, carousel:results.some(r=>r.carousel)||items.length>1,
      linked:true,postMeta
    };
    // A linked video without a usable URL is not a downloadable still image.
    if (unavailableVideos) return {files:[],total:0,unavailableVideos,carousel:false,linked:true,postMeta};
    if (!native.files.length && files.length)
      return {files,total:files.length,unavailableVideos:0,carousel:files.length>1,linked:true,postMeta};
    return {...native,linked:true};
  }

  function collectStructuredPost(doc, postCode) {
    let best = { files: [], total: 0, unavailableVideos: 0, carousel: false };
    const scripts = doc.querySelectorAll(
      'script[type="application/json"],script[type="application/ld+json"]'
    );
    for (const script of scripts) {
      const content = script.textContent || '';
      if (content.length > 4000000 || !content.includes(postCode) ||
          !/(video_versions|carousel_media|image_versions2|linked_inline_media)/.test(content)) continue;
      let root;
      try { root = JSON.parse(content); } catch (_) { continue; }
      let seen = 0;
      function walk(node, depth) {
        if (!node || typeof node !== 'object' || depth > 32 || ++seen > 25000) return;
        if (Array.isArray(node)) {
          for (const child of node) walk(child, depth + 1);
          return;
        }
        const code = node.code || node.shortcode || node.post_code || node.postCode;
        if (code === postCode) {
          const candidate = parsePostRecord(node);
          const score = (candidate.carousel ? 1000 : 0) + candidate.files.length * 20 + candidate.total;
          const current = (best.carousel ? 1000 : 0) + best.files.length * 20 + best.total;
          const videoCount = p => p.files.filter(file=>file.type==='video').length;
          if ((candidate.files.length && (videoCount(candidate)>videoCount(best) ||
                (videoCount(candidate)===videoCount(best) && score>current))) ||
              (!best.files.length && candidate.linked && !best.linked)) best = candidate;
        }
        for (const [key, value] of Object.entries(node)) {
          if (key !== 'video_versions' && key !== 'image_versions2') walk(value, depth + 1);
        }
      }
      walk(root, 0);
    }
    return best;
  }

  // Canonical post pages may expose one original MP4 in Open Graph metadata
  // even when the dynamic player uses a blob: URL. This stays on the same
  // Threads origin and only accepts permitted HTTPS media hosts.
  function videoFromCanonicalMeta(doc) {
    const selectors = [
      'meta[property="og:video:secure_url"]',
      'meta[property="og:video:url"]',
      'meta[property="og:video"]',
      'meta[name="twitter:player:stream"]',
    ];
    for (const selector of selectors) {
      const node = doc.querySelector(selector);
      const raw = node?.getAttribute('content');
      const url = mediaURL(raw);
      if (url && /\.mp4$/i.test(new URL(url).pathname)) return url;
    }
    return null;
  }

  async function permalinkPostMedia(identity) {
    // Same-origin, explicit-click GET. No proxy or third-party downloader.
    try {
      const path = '/@' + encodeURIComponent(identity.user) + '/post/' +
        encodeURIComponent(identity.code);
      const response = await fetch(new URL(path, location.origin), {
        method: 'GET', credentials: 'same-origin',
        redirect: 'error', cache: 'no-store', headers: { Accept: 'text/html' }
      });
      if (!response.ok) return null;
      const html = await response.text();
      if (html.length > 8000000) return null;
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const structured = collectStructuredPost(doc, identity.code);
      if (structured.carousel || structured.files.some(file => file.type === 'video'))
        return structured;
      // Use og:video only on the explicitly requested canonical post page,
      // never from the current feed or an unrelated suggested post.
      const mp4 = videoFromCanonicalMeta(doc);
      return mp4 ? {
        files: [{ type: 'video', url: mp4 }],
        total: 1, unavailableVideos: 0, carousel: false, linked: structured.linked, postMeta:structured.postMeta
      } : structured;
    } catch (_) {
      return null;
    }
  }

  function safeFilenameSegment(input, fallback = 'Threads') {
    return (String(input || fallback).replace(/[\\/:*?"<>|\x00-\x1f]/g, '_')
      .replace(/\s+/g, '_').slice(0, 60) || fallback);
  }

  function getTimestamp(card) {
    const raw = card.querySelector('time[datetime]')?.getAttribute('datetime');
    const date = new Date(raw || Date.now());
    const d = Number.isNaN(date.getTime()) ? new Date() : date;
    const pad = n => String(n).padStart(2, '0');
    return [d.getFullYear(), pad(d.getMonth() + 1), pad(d.getDate())].join('') +
      '_' + [pad(d.getHours()), pad(d.getMinutes()), pad(d.getSeconds())].join('');
  }

  function mediaExtension(url, type) {
    const match = /\.(mp4|jpg|jpeg|png|gif|webp|avif)$/i.exec(new URL(url).pathname);
    return match ? '.' + match[1].toLowerCase() : type === 'video' ? '.mp4' : '.jpg';
  }

  function belongsToPost(element, identity, card) {
    if (!card.contains(element)) return false;
    const mediaLink = element.closest('a[href*="/media"]');
    if (mediaLink) {
      const mediaOwner = identityFrom(mediaLink.href);
      if (mediaOwner && mediaOwner.code !== identity.code) return false;
    }
    // Nested quoted posts and linked replies may themselves be articles. Do
    // not mistake their media for the active reply's own media.
    for (let node = element.parentElement; node && node !== card;
         node = node.parentElement) {
      if (!node.matches('article,[role="article"]')) continue;
      const codes = postTimeCodes(node);
      if (codes.size && !codes.has(identity.code)) return false;
    }
    if (element.tagName === 'VIDEO') return true;
    if (/profile picture|avatar|頭像|大頭貼/i.test(element.alt || '')) return false;
    if (mediaLink) return true;
    const rect = element.getBoundingClientRect();
    return rect.width >= 150 && rect.height >= 110 &&
      !element.closest('header,nav,aside');
  }

  function instagramEmbedPresent(card) {
    // Only recognize actual video/reel URLs or a rendered Instagram logo,
    // never a random mention of Instagram in the post text.
    if (card.querySelector('[aria-label="Instagram logo"],[alt="Instagram logo"],[aria-label="Instagram 標誌"],[alt="Instagram 標誌"]')) return true;
    return [...card.querySelectorAll('a[href],iframe[src]')].some(el => {
      try {
        const u = new URL(el.getAttribute('href') || el.getAttribute('src'),location.href);
        return u.protocol==='https:' && /^(?:www\.)?instagram\.com$/i.test(u.hostname) &&
          /^\/(?:reel|reels|tv)\/[A-Za-z0-9_-]+(?:\/|$)/.test(u.pathname);
      } catch (_) { return false; }
    });
  }

  async function mediaInPost(card, identity) {
    const codes = postTimeCodes(card);
    if (codes.size !== 1 || !codes.has(identity.code))
      return {result:[],unavailableVideos:0,ambiguous:true};
    const instagram = instagramEmbedPresent(card);
    const nodes = [...card.querySelectorAll(MEDIA_SELECTOR)]
      .filter(node => belongsToPost(node, identity, card));
    const domFiles = [], seen = new Set();
    let unresolvedDOMVideos = 0;
    const videoCount = nodes.filter(node => node.tagName === 'VIDEO').length;
    for (const node of nodes) {
      const type = node.tagName === 'VIDEO' ? 'video' : 'image';
      const url = directURL(node);
      if (!url) {
        if (type === 'video') unresolvedDOMVideos++;
        continue;
      }
      const parsed = new URL(url);
      const key = parsed.origin + parsed.pathname;
      if (seen.has(key)) continue;
      seen.add(key);
      domFiles.push({ type, url });
    }

    let structured = collectStructuredPost(document, identity.code);
    const carouselControls = !!card.querySelector(
      '[aria-roledescription="carousel"],button[aria-label*="Next"],' +
      'button[aria-label*="next"],button[aria-label*="下一"],'+
      '[data-testid*="carousel"]'
    );
    // Embedded players may have no video element until playback begins.
    // In that case the previous version skipped the permalink fallback.
    if (!domFiles.length || instagram || structured.linked ||
        ((videoCount > 0 || carouselControls) && (!structured.carousel ||
         structured.unavailableVideos || structured.total < videoCount))) {
      const remote = await permalinkPostMedia(identity);
      if (remote) {
        const rank = p => (p.carousel ? 1000 : 0) + p.files.length * 20 + p.total;
        const videos = p => p.files.filter(f=>f.type==='video').length;
        if (videos(remote)>videos(structured) ||
            (videos(remote)===videos(structured) && rank(remote)>rank(structured)) ||
            (!structured.files.length && remote.linked)) structured = remote;
      }
    }
    // Carousel record preserves order and off-screen attachments. With only a
    // single structured item, use DOM instead when it exposes more actual URLs.
    const structuredVideos = structured.files.filter(f => f.type === 'video').length;
    const directVideos = domFiles.filter(f => f.type === 'video').length;
    // Never replace a real reply video with a static parent/preview image.
    const useStructured = structured.files.length > 0 &&
      structuredVideos >= directVideos &&
      (structured.carousel || structured.files.length >= domFiles.length ||
       (structuredVideos>directVideos && (structured.linked || instagram || videoCount>0)));
    const result = useStructured ? structured.files : domFiles;
    const embedded = Boolean(instagram || structured.linked);
    // Never report a video as downloaded when only its poster was obtained.
    if (!structured.carousel && !result.some(f=>f.type==='video') &&
        (instagram || (structured.linked && structured.unavailableVideos>0))) {
      return {result:[],unavailableVideos:Math.max(1,structured.unavailableVideos),
        embedded:true};
    }
    return {result,embedded,postMeta:structured.postMeta,total:useStructured?structured.total:null,
      unavailableVideos:useStructured?structured.unavailableVideos:unresolvedDOMVideos};
  }

  function downloadOne(url, filename) {
    return new Promise((resolve, reject) => {
      try {
        GM_download({
          url, name: filename, saveAs: false,
          onload: resolve, onerror: reject,
          ontimeout: () => reject(new Error('Download timed out')),
        });
      } catch (error) { reject(error); }
    });
  }

  function threadsMediaPath(raw) {
    if (!raw) return null;
    try { return new URL(raw).pathname; } catch (_) { return null; }
  }

  function threadsIntersection(a,b) {
    const left=Math.max(a.left,b.left),right=Math.min(a.right,b.right),
      top=Math.max(a.top,b.top),bottom=Math.min(a.bottom,b.bottom);
    return {left,right,top,bottom,width:Math.max(0,right-left),height:Math.max(0,bottom-top)};
  }

  function chooseThreadMedia(entries) {
    const videos=entries.filter(x=>x.type==='video');
    const candidates=entries.filter(x=>x.type==='video'||!videos.some(v=>{
      const r=threadsIntersection(x.rect,v.rect);
      return r.width*r.height>=Math.min(x.area,v.area)*.75;
    })).sort((a,b)=>b.area-a.area||b.ratio-a.ratio);
    const first=candidates[0],second=candidates[1];
    if(!first)return null;
    if(second&&second.area>=first.area*.85&&
       !(first.path&&first.path===second.path&&first.type===second.type))return null;
    return first;
  }

  function captureThreadMedia(card,identity) {
    const entries=[];
    for(const node of card.querySelectorAll(MEDIA_SELECTOR)){
      if(!belongsToPost(node,identity,card))continue;
      const full=node.getBoundingClientRect(),css=getComputedStyle(node);
      if(full.width<80||full.height<80||css.display==='none'||css.visibility==='hidden')continue;
      let rect=threadsIntersection(full,card.getBoundingClientRect());
      for(let p=node.parentElement;p&&p!==card;p=p.parentElement){
        const st=getComputedStyle(p),r=p.getBoundingClientRect();
        const x=/hidden|clip|auto|scroll/.test(st.overflowX),y=/hidden|clip|auto|scroll/.test(st.overflowY);
        if(x||y)rect=threadsIntersection(rect,{left:x?r.left:rect.left,right:x?r.right:rect.right,
          top:y?r.top:rect.top,bottom:y?r.bottom:rect.bottom});
      }
      const area=rect.width*rect.height,ratio=area/(full.width*full.height);
      if(area<6400||ratio<.45)continue;
      const type=node.tagName==='VIDEO'?'video':'image',url=directURL(node);
      entries.push({node,type,url,path:threadsMediaPath(url),poster:threadsMediaPath(node.poster),rect,area,ratio});
    }
    return chooseThreadMedia(entries);
  }

  function selectThreadCurrent(snapshot,files) {
    if(!snapshot)return null;
    const candidates=files.map((file,index)=>({file,index})).filter(({file})=>file.type===snapshot.type);
    const matches=candidates.filter(({file})=>
      (snapshot.path&&(threadsMediaPath(file.url)===snapshot.path||(file.aliases||[]).includes(snapshot.path)))||
      (snapshot.poster&&(file.posters||[]).includes(snapshot.poster)));
    if(matches.length===1)return {...matches[0].file,ordinal:matches[0].file.position||null};
    if(matches.length>1)return null;
    // A verified direct media URL is sufficient; never guess a different
    // slide from a list of videos, even if only one of them has a usable URL.
    if(snapshot.url)return {type:snapshot.type,url:snapshot.url,ordinal:null};
    return null;
  }

  // Shared local metadata writer. No re-encoding, no external libraries.
  // Existing XMP is left untouched rather than destructively replaced.
  function postDate(value) {
    if(value===null||value===undefined||value==='')return null;
    const n=typeof value==='number'||/^\d{10,13}$/.test(String(value))?Number(value):null;
    const d=new Date(n===null?value:n<1e12?n*1000:n);
    return Number.isFinite(d.getTime())&&d.getUTCFullYear()>=2000&&d.getTime()<=Date.now()+86400000?d.toISOString():null;
  }
  function twDate(value) {
    const iso=postDate(value);
    return iso?new Date(Date.parse(iso)+8*3600000).toISOString().slice(0,10).replace(/-/g,''):'unknown-date';
  }
  function metadataTime(scope) {
    const dates=[...scope.querySelectorAll('time[datetime]')].map(t=>postDate(t.getAttribute('datetime'))).filter(Boolean);
    const distinct=[...new Set(dates)];
    return distinct.length===1?distinct[0]:null;
  }
  function mediaName(file,meta,extension) {
    const clean=s=>safeFilenameSegment(s,'unknown').replace(/[. ]+$/,'')||'unknown';
    const ordinal=Number.isInteger(meta.ordinal)&&meta.ordinal>0?String(meta.ordinal).padStart(2,'0'):'NA';
    // Unknown ordinal must not be fabricated. A short stable path hash
    // prevents different unknown attachments from sharing a filename.
    let suffix=ordinal;
    if(ordinal==='NA'){
      let h=2166136261;for(const c of threadsMediaPath(file.url)||'')h=Math.imul(h^c.charCodeAt(0),16777619);
      suffix+='-'+(h>>>0).toString(16).padStart(8,'0');
    }
    return [twDate(meta.published),meta.platform,clean(meta.account),suffix].join('_')+extension;
  }
  function xmlText(v) {
    return String(v??'').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g,'')
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&apos;');
  }
  function xmpPacket(meta) {
    const fields={Platform:meta.platform,Account:meta.account,PostID:meta.code,PostURL:meta.source,
      PublishedAt:meta.published,MediaOrdinal:meta.ordinal,MediaTotal:meta.total,
      DownloadedAt:meta.downloadedAt,DownloaderVersion:'6.6.0',MediaKind:meta.kind};
    const custom=Object.entries(fields).filter(([,v])=>v!==null&&v!==undefined&&v!=='')
      .map(([k,v])=>'<mmd:'+k+'>'+xmlText(v)+'</mmd:'+k+'>').join('');
    const description=meta.caption?'<dc:description><rdf:Alt><rdf:li xml:lang="x-default">'+xmlText(meta.caption)+'</rdf:li></rdf:Alt></dc:description>':'';
    const creator=meta.account&&meta.account!=='unknown'?'<dc:creator><rdf:Seq><rdf:li>'+xmlText(meta.account)+'</rdf:li></rdf:Seq></dc:creator>':'';
    const source=meta.source?'<dc:source>'+xmlText(meta.source)+'</dc:source>':'';
    return '<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>\n'+
      '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">'+
      '<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:mmd="https://github.com/kevinsmemo/tampermonkey-scripts/ns/1.0/">'+
      creator+description+source+custom+'</rdf:Description></rdf:RDF></x:xmpmeta>\n<?xpacket end="w"?>';
  }
  function ascii(bytes,offset,n){
    return String.fromCharCode(...bytes.subarray(offset,offset+n));
  }
  function joinBytes(...parts){
    const out=new Uint8Array(parts.reduce((n,b)=>n+b.length,0));
    let p=0;for(const b of parts){out.set(b,p);p+=b.length;}return out;
  }
  function crc32(bytes){
    let c=0xffffffff;
    for(const b of bytes){c^=b;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}
    return (c^0xffffffff)>>>0;
  }
  function xmpEmbed(bytes,packet){
    const encoder=new TextEncoder(),payload=encoder.encode(packet),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
    if(payload.length>60000||bytes.length<12)return null;
    if(bytes[0]===255&&bytes[1]===216){
      let p=2,insert=2,scan=false;
      while(p+4<=bytes.length){
        if(bytes[p]!==255)return null;
        const marker=bytes[p+1];
        if(marker===0xda){scan=true;break;}
        if(marker===0xd9)break;
        const len=view.getUint16(p+2);
        if(len<2||p+2+len>bytes.length)return null;
        if(marker===0xe1&&ascii(bytes,p+4,Math.min(len-2,35)).startsWith('http://ns.adobe.com/xap/1.0/'))return null;
        if(marker===0xe1&&ascii(bytes,p+4,Math.min(len-2,35)).startsWith('http://ns.adobe.com/xmp/extension/'))return null;
        if(marker===0xe0||marker===0xe1)insert=p+2+len;
        p+=2+len;
      }
      if(!scan||bytes[bytes.length-2]!==255||bytes[bytes.length-1]!==217)return null;
      const data=joinBytes(encoder.encode('http://ns.adobe.com/xap/1.0/\0'),payload);
      const header=new Uint8Array(4);header.set([255,225]);new DataView(header.buffer).setUint16(2,data.length+2);
      return {bytes:joinBytes(bytes.subarray(0,insert),header,data,bytes.subarray(insert)),ext:'.jpg',mime:'image/jpeg'};
    }
    if(bytes[0]===137&&ascii(bytes,1,3)==='PNG'&&bytes[4]===13&&bytes[5]===10&&bytes[6]===26&&bytes[7]===10){
      let p=8,insert=-1,hasHeader=false;
      while(p+12<=bytes.length){
        const len=view.getUint32(p),type=ascii(bytes,p+4,4);
        if(len>bytes.length-p-12)return null;
        if(type==='IHDR'&&p===8&&len===13)hasHeader=true;
        if(['iTXt','tEXt','zTXt'].includes(type)&&ascii(bytes,p+8,Math.min(len,17))==='XML:com.adobe.xmp')return null;
        if(type==='IEND'){if(len!==0||p+12!==bytes.length)return null;insert=p;break;}
        p+=12+len;
      }
      if(!hasHeader||insert<0)return null;
      const data=joinBytes(encoder.encode('XML:com.adobe.xmp\0\0\0\0\0'),payload);
      const chunk=new Uint8Array(data.length+12),dv=new DataView(chunk.buffer);
      dv.setUint32(0,data.length);chunk.set(encoder.encode('iTXt'),4);chunk.set(data,8);
      dv.setUint32(8+data.length,crc32(chunk.subarray(4,8+data.length)));
      return {bytes:joinBytes(bytes.subarray(0,insert),chunk,bytes.subarray(insert)),ext:'.png',mime:'image/png'};
    }
    // ISO BMFF MP4: append top-level Adobe XMP UUID, never move mdat/moov.
    // Reject zero-size, extended-size, or malformed boxes and existing UUID
    // XMP to avoid changing the meaning of any original byte offsets.
    if(ascii(bytes,4,4)==='ftyp'){
      const uuid=new Uint8Array([0xbe,0x7a,0xcf,0xcb,0x97,0xa9,0x42,0xe8,0x9c,0x71,0x99,0x94,0x91,0xe3,0xaf,0xac]);
      // Some producers put an XMP UUID inside moov/udta rather than at
      // the top level. Conservatively preserve those files as-is.
      for(let at=bytes.indexOf(uuid[0]);at>=0;at=bytes.indexOf(uuid[0],at+1)){
        if(at+uuid.length<=bytes.length&&uuid.every((v,i)=>v===bytes[at+i]))return null;
      }
      let p=0,moov=false,mdat=false;
      while(p+8<=bytes.length){
        const size=view.getUint32(p),type=ascii(bytes,p+4,4);
        if(size<8||size>bytes.length-p)return null;
        if(type==='uuid'&&size>=24&&uuid.every((v,i)=>v===bytes[p+8+i]))return null;
        if(type==='moov')moov=true;if(type==='mdat')mdat=true;
        p+=size;
      }
      if(p!==bytes.length||!moov||!mdat)return null;
      const box=new Uint8Array(24+payload.length);new DataView(box.buffer).setUint32(0,box.length);
      box.set(encoder.encode('uuid'),4);box.set(uuid,8);box.set(payload,24);
      return {bytes:joinBytes(bytes,box),ext:'.mp4',mime:'video/mp4'};
    }
    return null;
  }
  function metadataHost(raw){
    try{const u=new URL(raw);return u.protocol==='https:'&&/(?:^|\.)(?:fbcdn\.net|cdninstagram\.com)$/i.test(u.hostname);}catch(_){return false;}
  }
  function readMediaForMetadata(url){
    return new Promise(resolve=>{
      if(typeof GM_xmlhttpRequest!=='function'||!metadataHost(url)){resolve(null);return;}
      let request,finished=false;
      const done=v=>{if(!finished){finished=true;resolve(v);}};
      try{
        request=GM_xmlhttpRequest({method:'GET',url,responseType:'arraybuffer',anonymous:true,timeout:25000,
          onprogress:e=>{if(e.loaded>metadataLimit||(e.lengthComputable&&e.total>metadataLimit)){done(null);try{request?.abort();}catch(_){}}},
          onload:r=>done(r.status===200&&metadataHost(r.finalUrl||url)&&r.response instanceof ArrayBuffer&&r.response.byteLength<=metadataLimit?new Uint8Array(r.response):null),
          onerror:()=>done(null),ontimeout:()=>done(null),onabort:()=>done(null)});
      }catch(_){done(null);}
    });
  }
  async function saveMedia(file,meta,valid=()=>true){
    const ext=mediaExtension(file.url,file.type);
    // No extra read for formats this version cannot safely rewrite.
    if(['.jpg','.jpeg','.png','.mp4'].includes(ext)&&metadataHost(file.url)){
      let blob=null,finalExt=ext;
      try{
        const raw=await readMediaForMetadata(file.url);
        if(!valid())return 'cancelled';
        if(raw){
          const result=xmpEmbed(raw,xmpPacket(meta));
          if(result&&((file.type==='video')===(result.mime==='video/mp4'))){
            blob=new Blob([result.bytes],{type:result.mime});finalExt=result.ext;
          }
        }
      }catch(_){}
      if(blob&&valid()){
        // A failed Blob save may be an older Tampermonkey build. Retry once
        // via the original proven download path; do not alter original bytes.
        try{await downloadOne(blob,mediaName(file,meta,finalExt));return 'metadata';}catch(_){}
      }
    }
    if(!valid())return 'cancelled';
    await downloadOne(file.url,mediaName(file,meta,ext));
    return 'original';
  }

  async function downloadPost(event,card,identity,group,button,mode,viewer=null,thumb=null) {
    event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();
    const buttons=[...group.querySelectorAll('button')];
    if(buttons.some(b=>b.disabled)||captureMode||(!viewer&&viewerEntry))return;
    const valid=()=>!captureMode&&group.isConnected&&(viewer?viewerValid(viewer):
      validCard(card,identity)&&(!thumb||thumb.isConnected&&belongsToPost(thumb,identity,card)));
    if(!valid())return;
    // Freeze the visible attachment at click time, not after fetching data.
    const snapshot=mode==='current'?(viewer?viewerSnapshot(viewer.root):
      thumb?threadThumbSnapshot(thumb):captureThreadMedia(card,identity)):null;
    if(mode==='current'&&!snapshot){
      button.title='無法辨識當前媒體：請將輪播停在一張圖片或影片後重試';
      downloadIcon(button,'error');
      setTimeout(()=>downloadIcon(button,mode),2200);
      return;
    }
    buttons.forEach(b=>b.disabled=true);
    let failures=0;
    try{
      downloadIcon(button,'busy');button.title='解析中…';
      const data=viewer?await viewerData(viewer,snapshot):await mediaInPost(card,identity);
      if(!valid()||data.ambiguous)return;
      let selected=mode==='current'?selectThreadCurrent(snapshot,data.result):null;
      if(thumb&&mode==='current'&&snapshot.type==='image'){
        const videoMatches=data.result.filter(file=>file.type==='video'&&snapshot.path&&
          (file.posters||[]).includes(snapshot.path));
        if(videoMatches.length===1)selected=videoMatches[0];
        else if(videoMatches.length>1||snapshot.videoCover||data.embedded){
          const vids=data.result.filter(file=>file.type==='video');
          selected=data.embedded&&vids.length===1&&data.result.length===1?vids[0]:null;
        }
      }
      const files=mode==='current'?(selected?[selected]:[]):data.result;
      if(!files.length){
        downloadIcon(button,'error');
        button.title=data.embedded?'轉貼影片沒有可辨識的直連':
          mode==='current'?'無法安全辨識目前媒體，請播放影片或切換輪播後重試':
          '找不到可下載的媒體直連，請開啟原始貼文再試';
        return;
      }
      const published=data.postMeta?.published||(validCard(card,identity)?metadataTime(card):null);
      const common={platform:'Threads',account:identity.user,code:identity.code,
        source:'https://www.threads.com/@'+encodeURIComponent(identity.user)+'/post/'+encodeURIComponent(identity.code),
        published,caption:data.postMeta?.caption||null,total:data.total,kind:'post',downloadedAt:new Date().toISOString()};
      let originalOnly=0;
      for(let i=0;i<files.length;i++){
        if(!valid())return;
        const file=files[i];
        button.title='下載 '+(i+1)+'/'+files.length;
        try{
          const status=await saveMedia(file,{...common,ordinal:file.position||file.ordinal||
            (data.total===1?1:null)},valid);
          if(status==='original')originalOnly++;
        }catch(_){failures++;}
      }
      const partial=mode==='all'&&(data.unavailableVideos||data.partial);
      downloadIcon(button,failures||partial?'error':'done');
      button.title=failures?'下載失敗 '+failures+'/'+files.length:
        partial?'部分完成：未能確認全部媒體':'已下載 '+files.length+' 個媒體'+(originalOnly?'（'+originalOnly+' 個保留原檔，未寫入新中繼資料）':'');
    }catch(_){
      downloadIcon(button,'error');button.title='下載失敗';
    }finally{
      setTimeout(()=>{
        if(!group.isConnected)return;
        buttons.forEach(b=>{b.disabled=false;downloadIcon(b,b.dataset.action);});
      },2600);
    }
  }

  function isTimeLink(anchor) {
    const identity = identityFrom(anchor.href);
    if (!identity || /\/media\/?$/i.test(new URL(anchor.href).pathname)) return false;
    const label = (anchor.textContent || '').trim();
    return !!anchor.querySelector('time') || /^\d+\s*(s|m|h|d|w|mo|y|秒|分鐘|小時|天|週|月|年)$/i.test(label) ||
      !!anchor.querySelector('[datetime]');
  }

  function hasActions(node) {
    return !!node.querySelector(
      '[aria-label="Like"],[aria-label="讚"],[aria-label="Reply"],' +
      '[aria-label="回覆"],[aria-label="Repost"],[aria-label="轉發"],' +
      '[aria-label="Share"],[aria-label="分享"]'
    );
  }

  function postTimeCodes(container) {
    const codes = new Set();
    for (const link of container.querySelectorAll(POST_LINK)) {
      if (!isTimeLink(link)) continue;
      const code = identityFrom(link.href)?.code;
      if (code) codes.add(code);
      if (codes.size > 1) break;
    }
    return codes;
  }

  function findCard(anchor, identity) {
    // Do not blindly return anchor.closest('article'): Threads may use one
    // semantic article for the parent post AND the whole reply thread.
    // The selected node must contain exactly one *timestamp* post identity.
    // Ordinary links and media URLs pointing to a parent post are not headers.
    let node = anchor.parentElement;
    let bestWithActions = null;
    let bestWithMedia = null;
    for (let depth = 0; depth < 18 && node &&
         node !== document.body && node !== document.documentElement;
         depth++, node = node.parentElement) {
      const codes = postTimeCodes(node);
      if (codes.size > 1 || (codes.size && !codes.has(identity.code))) break;
      const bounds = node.getBoundingClientRect();
      if (bounds.width < 190 || bounds.height < 80) continue;
      const hasMedia = !!node.querySelector(MEDIA_SELECTOR);
      const actions = hasActions(node);
      // Prefer the first sufficiently complete post component. Never expand
      // into an ancestor that includes another reply's timestamp.
      if (actions && (hasMedia || depth >= 3) && !bestWithActions) {
        bestWithActions = node;
      }
      if (hasMedia && !bestWithMedia) bestWithMedia = node;
    }
    return bestWithActions || bestWithMedia;
  }

  function findMoreControl(card,anchor) {
    const pattern=/^(?:more(?: options| actions)?|post options|更多(?:選項|操作)?|其他選項|options|⋯|…|•••|\.{3})$/i;
    const time=anchor.getBoundingClientRect(),c=card.getBoundingClientRect();
    const candidates=new Set();
    for(const el of card.querySelectorAll('button,[role="button"],[aria-label],svg title')){
      const labels=[el.getAttribute('aria-label'),el.getAttribute('title'),
        el.tagName.toLowerCase()==='title'||el.matches('button,[role="button"]')?el.textContent:null];
      if(!labels.some(x=>pattern.test(String(x||'').trim())))continue;
      const control=el.closest('button,[role="button"]');
      if(!control||!card.contains(control)||control.closest('.'+BTN))continue;
      const r=control.getBoundingClientRect();
      if(r.width<10||r.height<10||r.width>80||r.height>80||
         Math.abs(r.top-time.top)>70||r.right<c.left+c.width*.5)continue;
      candidates.add(control);
    }
    return [...candidates].sort((a,b)=>{
      const ar=a.getBoundingClientRect(),br=b.getBoundingClientRect();
      return Math.abs(ar.top-time.top)-Math.abs(br.top-time.top)||br.right-ar.right;
    })[0]||null;
  }

  function threadActionPosition(cardRect,menuRect,width,height,scrollTop=0) {
    if(!menuRect)return {right:12,top:8};
    return {right:Math.max(8,Math.round(cardRect.right-menuRect.left+MORE_GAP)),
      top:Math.max(0,Math.round(menuRect.top-cardRect.top+scrollTop+(menuRect.height-height)/2))};
  }

  // Keep the native menu in its original location. No translations to undo
  // during Copy as image. Place the two compact icons immediately to its left.
  function layoutHeaderActions(card,group,more) {
    if(!card.isConnected||!group.isConnected)return;
    if(getComputedStyle(card).position==='static')card.style.position='relative';
    const c=card.getBoundingClientRect(),r=group.getBoundingClientRect();
    const m=more?.isConnected?more.getBoundingClientRect():null;
    const pos=threadActionPosition(c,m,r.width||64,r.height||28,card.scrollTop);
    group.style.right=pos.right+'px';group.style.top=pos.top+'px';
  }

  // Threads "Copy as image" can capture a DOM clone containing custom
  // userscript buttons. Remove ours BEFORE Threads handles that user action.
  // In addition, never inject Download into a preview modal.
  function isCopyAsImageAction(target) {
    if (!(target instanceof Element)) return false;
    const pattern = /^(copy as image|copy image|複製為圖片|複製成圖片|以圖片形式複製|複製圖片|复制为图片|复制成图片)$/i;
    // Threads sometimes uses custom DIV controls instead of native buttons.
    // Check only the nearest few ancestors so a whole menu isn't mistaken
    // for the "Copy as image" action.
    let node = target;
    for (let i = 0; node && i < 5; i++, node = node.parentElement) {
      const labels = [node.getAttribute('aria-label'), node.getAttribute('title'), node.textContent];
      if (labels.some(value => {
        const label = String(value || '').trim().replace(/\s+/g, ' ');
        return label.length <= 80 && pattern.test(label);
      })) return true;
      if (node.matches('body,[role="menu"],[role="dialog"]')) break;
    }
    return false;
  }

  function isCopyPreviewVisible() {
    const controls = document.querySelectorAll('button,label,[role="checkbox"],[role="switch"]');
    for (const control of controls) {
      const name = (control.textContent || '').trim();
      if (/^(show metrics|顯示數據|顯示統計|顯示指標|显示数据)$/i.test(name)) {
        const box = control.getBoundingClientRect();
        if (box.width && box.height) return true;
      }
    }
    // Ignore the original share menu; it can also have role="dialog".
    // Only the preview itself (metrics / Auto / Copy controls) counts.
    const modals = document.querySelectorAll('[role="dialog"],[aria-modal="true"]');
    for (const modal of modals) {
      const content = (modal.textContent || '').toLowerCase();
      if (modal.getBoundingClientRect().width &&
          (content.includes('show metrics') ||
           (content.includes('auto') && content.includes('copy')))) return true;
    }
    return false;
  }

  function finishCopyCapture() {
    if (!captureMode) return;
    captureMode = false;
    capturePreviewSeen = false;
    if (captureCheckTimer) clearTimeout(captureCheckTimer);
    captureCheckTimer = null;
    schedule();
  }

  function checkCopyCapture() {
    if (!captureMode) return;
    const previewVisible = isCopyPreviewVisible();
    if (previewVisible) capturePreviewSeen = true;
    // The preview may be created asynchronously. Keep buttons removed until
    // it closes; recover after 15 seconds if a preview never appears.
    if ((capturePreviewSeen && !previewVisible) ||
        (!capturePreviewSeen && Date.now() - captureStartedAt > 15000)) {
      finishCopyCapture();
      return;
    }
    captureCheckTimer = setTimeout(checkCopyCapture, 450);
  }

  function beginCopyCapture() {
    if (captureMode) return;
    captureMode = true;
    captureStartedAt = Date.now();
    capturePreviewSeen = false;
    if (scanTimer !== null) {
      clearTimeout(scanTimer);
      scanTimer = null;
    }
    // Physical removal, rather than just CSS hiding, prevents inclusion in
    // screenshots even if the renderer ignores external stylesheets.
    document.querySelectorAll('.' + BTN).forEach(button => button.remove());
    stopViewerObservation();thumbnailEntries.clear();viewerEntry=null;viewerOrigin=null;
    checkCopyCapture();
  }

  // Capture listeners run ahead of React's click handlers and screenshot
  // generation. Keyboard activation is supported too.
  document.addEventListener('pointerdown', event => {
    if (isCopyAsImageAction(event.target)) beginCopyCapture();
  }, true);
  document.addEventListener('click', event => {
    if (isCopyAsImageAction(event.target)) beginCopyCapture();
  }, true);
  document.addEventListener('keydown', event => {
    if ((event.key === 'Enter' || event.key === ' ') &&
        isCopyAsImageAction(event.target)) beginCopyCapture();
  }, true);

  function threadThumbSnapshot(node){
    const type=node.tagName==='VIDEO'?'video':'image',url=directURL(node);
    const tile=node.closest('a[href*="/media"]')||node.parentElement;
    const videoCover=type==='image'&&!!tile?.querySelector('svg[aria-label*="Play" i], [aria-label*="Play video" i], [aria-label*="播放影片"], [aria-label*="播放視頻"]');
    return {node,type,url,path:threadsMediaPath(url),poster:threadsMediaPath(node.poster),videoCover};
  }
  function threadThumbRect(node,card){
    const full=node.getBoundingClientRect(),st=getComputedStyle(node);
    if(full.width<100||full.height<90||st.display==='none'||st.visibility==='hidden')return null;
    let rect=threadsIntersection(full,card.getBoundingClientRect());
    for(let p=node.parentElement;p&&p!==card;p=p.parentElement){
      const css=getComputedStyle(p),r=p.getBoundingClientRect();
      const x=/hidden|clip|auto|scroll/.test(css.overflowX),y=/hidden|clip|auto|scroll/.test(css.overflowY);
      if(x||y)rect=threadsIntersection(rect,{left:x?r.left:rect.left,right:x?r.right:rect.right,top:y?r.top:rect.top,bottom:y?r.bottom:rect.bottom});
    }
    const video=node.tagName==='VIDEO';
    const painted=paintedMediaRect(full,video?node.videoWidth:node.naturalWidth,video?node.videoHeight:node.naturalHeight,st.objectFit,st.objectPosition);
    rect=threadsIntersection(rect,painted);
    return rect.width>=84&&rect.height>=48?rect:null;
  }
  function threadThumbNodes(card,identity){
    const nodes=[...card.querySelectorAll('img,video')].filter(node=>
      belongsToPost(node,identity,card)&&!node.closest('.'+BTN)&&
      !/profile picture|avatar|頭像|大頭貼/i.test(node.alt||'')&&
      threadThumbRect(node,card));
    const videos=nodes.filter(node=>node.tagName==='VIDEO');
    return nodes.filter(node=>node.tagName==='VIDEO'||!videos.some(v=>{
      const a=threadThumbRect(node,card),b=threadThumbRect(v,card);
      if(!a||!b)return false;
      const r=threadsIntersection(a,b);
      return r.width*r.height>=Math.min(a.width*a.height,b.width*b.height)*.75;
    }));
  }
  function positionThreadThumb(entry){
    const {node,card,identity,group}=entry;
    if(!node.isConnected||!group.isConnected||!validCard(card,identity)||!belongsToPost(node,identity,card)){
      group.remove();thumbnailEntries.delete(node);return;
    }
    const r=threadThumbRect(node,card);
    if(!r){group.hidden=true;return;}
    group.hidden=false;
    const w=group.offsetWidth||76,h=group.offsetHeight||36;
    if(r.width<w||r.height<h){group.hidden=true;return;}
    const pos=viewerToolbarPosition(r,r,w,h);
    const parent=group.offsetParent||card,base=parent.getBoundingClientRect();
    group.style.right='auto';
    group.style.left=Math.round(pos.left-base.left-(parent.clientLeft||0)+(parent.scrollLeft||0))+'px';
    group.style.top=Math.round(pos.top-base.top-(parent.clientTop||0)+(parent.scrollTop||0))+'px';
  }
  function attach(anchor) {
    if(captureMode||anchor.closest('[role="dialog"],[aria-modal="true"]')||!isTimeLink(anchor))return;
    const identity=identityFrom(anchor.href),card=findCard(anchor,identity);
    if(!validCard(card,identity))return;
    const nodes=threadThumbNodes(card,identity);
    if(getComputedStyle(card).position==='static')card.style.position='relative';
    for(const entry of thumbnailEntries.values()){
      if(entry.card===card&&!nodes.includes(entry.node)){
        entry.group.remove();thumbnailEntries.delete(entry.node);
      }
    }
    for(const node of nodes){
      const old=thumbnailEntries.get(node);
      if(old&&old.group.isConnected&&old.card===card&&samePost(old.identity,identity)){
        positionThreadThumb(old);continue;
      }
      if(old){old.group.remove();thumbnailEntries.delete(node);}
      const group=document.createElement('div');group.className=BTN+' '+THUMB;
      group.addEventListener('pointerdown',e=>e.stopPropagation());
      for(const mode of ['current']){
        const button=document.createElement('button');button.type='button';button.dataset.action=mode;
        const label='下載此圖片／影片';
        button.title=label;button.setAttribute('aria-label',label);downloadIcon(button,mode);
        button.addEventListener('click',e=>downloadPost(e,card,identity,group,button,mode,null,node),true);
        group.appendChild(button);
      }
      card.appendChild(group);
      const entry={node,card,identity,group};thumbnailEntries.set(node,entry);
      positionThreadThumb(entry);
    }
  }

  // Separate viewer controls from feed controls. Resolve identity only from
  // a canonical media route, exact viewer links, or an explicit media click.
  function validCard(card,id){
    if(!card?.isConnected||!id)return false;
    const codes=postTimeCodes(card);
    return codes.size===1&&codes.has(id.code);
  }
  function samePost(a,b){return !!a&&!!b&&a.code===b.code&&a.user.toLowerCase()===b.user.toLowerCase();}
  function viewerRoute(raw){
    try{const u=new URL(raw,location.href);
      return /\/post\/[A-Za-z0-9_-]+\/media(?:\/|$)/.test(u.pathname)?identityFrom(u.href):null;
    }catch(_){return null;}
  }
  function viewerRect(node){
    const r=node.getBoundingClientRect(),st=getComputedStyle(node);
    if(st.display==='none'||st.visibility==='hidden'||Number(st.opacity)===0)return null;
    const q=threadsIntersection(r,{left:0,top:0,right:innerWidth,bottom:innerHeight});
    return q.width>=100&&q.height>=100?q:null;
  }
  function viewerClose(root){
    const pat=/^(?:close(?: media viewer| media| viewer| image| photo| video| dialog)?|dismiss|exit(?: full screen| fullscreen)?|back|關閉(?:媒體檢視器|媒體|圖片|影片|檢視器|對話框)?|返回|关闭)$/i;
    for(const n of root.querySelectorAll('button,[role="button"],[aria-label],svg title')){
      if(![n.getAttribute('aria-label'),n.getAttribute('title'),n.tagName.toLowerCase()==='title'?n.textContent:null].some(x=>pat.test(String(x||'').trim())))continue;
      const b=n.closest('button,[role="button"]')||n,r=b.getBoundingClientRect();
      if(r.width>=12&&r.height>=12&&r.width<=100&&r.height<=100)return b;
    }
    return null;
  }
  function viewerSnapshot(root){
    const entries=[];
    for(const node of root.querySelectorAll('img,video')){
      if(node.closest('nav,aside,header,.'+BTN)||/profile picture|avatar|頭像|大頭貼/i.test(node.alt||''))continue;
      const full=node.getBoundingClientRect();let rect=viewerRect(node);
      if(!rect||full.width<150||full.height<110)continue;
      for(let p=node.parentElement;p&&p!==root;p=p.parentElement){
        const st=getComputedStyle(p),r=p.getBoundingClientRect();
        const x=/hidden|clip|auto|scroll/.test(st.overflowX),y=/hidden|clip|auto|scroll/.test(st.overflowY);
        if(x||y)rect=threadsIntersection(rect,{left:x?r.left:rect.left,right:x?r.right:rect.right,top:y?r.top:rect.top,bottom:y?r.bottom:rect.bottom});
      }
      const area=rect.width*rect.height,ratio=area/(full.width*full.height);
      if(area<16000||ratio<.4)continue;
      const hit=[[.5,.5],[.25,.5],[.75,.5]].some(([x,y])=>{
        const stack=document.elementsFromPoint(rect.left+x*rect.width,rect.top+y*rect.height);
        const top=stack.find(e=>!e.closest('.'+BTN));
        if(!top||!root.contains(top)||!stack.includes(node))return false;
        return !stack.slice(0,stack.indexOf(node)).some(e=>/^(IMG|VIDEO)$/.test(e.tagName));
      });
      if(!hit)continue;
      const type=node.tagName==='VIDEO'?'video':'image',url=directURL(node);
      if(type==='image'&&!url)continue;
      entries.push({node,type,url,path:threadsMediaPath(url),poster:threadsMediaPath(node.poster),rect,area,ratio});
    }
    return chooseThreadMedia(entries);
  }
  function viewerLink(root){
    const ids=new Map();
    for(const a of root.querySelectorAll(POST_LINK)){
      const id=identityFrom(a.href);
      if(id&&(isTimeLink(a)||viewerRoute(a.href)))ids.set(id.code,id);
    }
    return ids.size===1?[...ids.values()][0]:null;
  }
  function findViewer(){
    if(captureMode||isCopyPreviewVisible())return null;
    const route=viewerRoute(location.href),options=[];
    const add=(root,explicit)=>{
      if(options.some(x=>x.root===root)||root.closest('[role="menu"]'))return;
      const r=viewerRect(root),close=viewerClose(root);
      if(!r||r.width<Math.min(300,innerWidth*.65)||r.height<Math.min(240,innerHeight*.5)||
         (!close&&!route)||root.querySelector('[contenteditable="true"],textarea,input[type="text"]'))return;
      const snapshot=viewerSnapshot(root);
      if(snapshot)options.push({root,close,snapshot,explicit});
    };
    for(const root of document.querySelectorAll('[role="dialog"],[aria-modal="true"]'))add(root,true);
    if(route||viewerEntry||viewerOrigin&&Date.now()-viewerOrigin.at<8000){
      for(const node of document.querySelectorAll('img,video')){
        if(!viewerRect(node))continue;
        for(let p=node.parentElement,d=0;p&&p!==document.body&&d<15;p=p.parentElement,d++){
          const r=p.getBoundingClientRect();
          if(getComputedStyle(p).position==='fixed'&&r.width>=innerWidth*.5&&r.height>=innerHeight*.5){add(p,false);break;}
        }
      }
    }
    if(route&&!options.length)for(const main of document.querySelectorAll('main,[role="main"]'))if(viewerClose(main))add(main,false);
    options.sort((a,b)=>Number(b.explicit)-Number(a.explicit)||b.snapshot.area-a.snapshot.area);
    const first=options[0];if(!first)return null;
    if(options.some(x=>x!==first&&!x.root.contains(first.root)&&!first.root.contains(x.root)&&x.snapshot.area>=first.snapshot.area*.85))return null;
    return first;
  }
  function rememberMediaClick(event){
    if(captureMode||viewerEntry||!(event.target instanceof Element)||event.target.closest('.'+BTN+',[role="dialog"],[role="menu"]'))return;
    const target=event.target,link=target.closest('a[href*="/media"]');
    let media=target.closest('img,video')||link?.querySelector('img,video')||target.closest('picture')?.querySelector('img');
    if(!media){
      for(let n=target,d=0;n&&d<5;n=n.parentElement,d++){
        const list=[...n.querySelectorAll('img,video')].filter(m=>{
          const r=m.getBoundingClientRect();return r.width>=150&&r.height>=110&&event.clientX>=r.left&&event.clientX<=r.right&&event.clientY>=r.top&&event.clientY<=r.bottom;
        });
        if(list.length===1){media=list[0];break;}if(list.length>1)break;
      }
    }
    if(!media||/profile picture|avatar|頭像|大頭貼/i.test(media.alt||''))return;
    if(media.getBoundingClientRect().width<100||media.getBoundingClientRect().height<100)return;
    let id=viewerRoute(link?.href||media.closest('a[href*="/media"]')?.href||''),card=null;
    for(let p=media.parentElement,d=0;p&&p!==document.body&&d<18;p=p.parentElement,d++){
      const codes=postTimeCodes(p);if(codes.size>1)break;if(codes.size!==1)continue;
      const time=[...p.querySelectorAll(POST_LINK)].find(isTimeLink),found=time&&identityFrom(time.href);
      if(!found||(id&&!samePost(id,found)))break;
      if(!belongsToPost(media,found,p))continue;
      id=found;card=findCard(time,found)||p;if(!card.contains(media)||!validCard(card,id))card=p;break;
    }
    if(id){viewerOrigin={id,card:validCard(card,id)?card:null,at:Date.now()};schedule();}
  }
  function resolveViewerIdentity(root){
    const route=viewerRoute(location.href),local=viewerLink(root);
    if(route&&local&&!samePost(route,local))return null;
    if(route||local)return route||local;
    if(viewerEntry?.root===root)return viewerEntry.id;
    return viewerOrigin&&Date.now()-viewerOrigin.at<8000?viewerOrigin.id:null;
  }
  function viewerValid(entry){
    if(captureMode||viewerEntry!==entry||!entry.root.isConnected||!entry.group.isConnected||isCopyPreviewVisible())return false;
    const route=viewerRoute(location.href),local=viewerLink(entry.root);
    if((route&&!samePost(route,entry.id))||(local&&!samePost(local,entry.id))||(entry.routeBound&&!route))return false;
    return !!viewerRect(entry.root)&&!!viewerSnapshot(entry.root);
  }
  async function viewerData(entry,snapshot){
    const id=entry.id,card=entry.card;
    let data=null;
    if(validCard(card,id)){
      data=await mediaInPost(card,id);
      if(!data.ambiguous&&data.total===data.result.length&&data.total>0&&!data.unavailableVideos&&
        (!snapshot||selectThreadCurrent(snapshot,data.result)?.ordinal))return data;
    }
    let exact=collectStructuredPost(document,id.code);
    if(!exact.files.length||!exact.carousel||exact.unavailableVideos||exact.total>exact.files.length){
      const remote=await permalinkPostMedia(id);
      if(remote?.files.length&&(remote.carousel||remote.files.length>=exact.files.length))exact=remote;
    }
    if(exact.files.length)return {result:exact.files,total:exact.total,postMeta:exact.postMeta,embedded:exact.linked,
      unavailableVideos:exact.unavailableVideos,partial:exact.total>exact.files.length};
    if(data?.result?.length)return {...data,partial:true};
    const current=snapshot||viewerSnapshot(entry.root);
    return {result:current?.url?[{type:current.type,url:current.url,position:null}]:[],total:null,
      unavailableVideos:current?.type==='video'&&!current.url?1:0,partial:true};
  }
  function stopViewerObservation(){
    viewerResizeObserver?.disconnect();observedViewerMedia=null;
  }
  function removeViewer(){
    stopViewerObservation();
    if(viewerEntry){viewerEntry.group.remove();viewerEntry=null;}
  }
  // A replaced element can span the viewport while object-fit:contain
  // displays a much smaller image/video inside it. Measure the painted
  // content, not the full element's letterboxed bounds.
  function paintedMediaRect(box,iw,ih,fit='fill',position='50% 50%'){
    if(!(iw>0&&ih>0&&box.width>0&&box.height>0)||!['contain','scale-down','none'].includes(fit))return box;
    const scale=fit==='none'?1:Math.min(box.width/iw,box.height/ih,fit==='scale-down'?1:Infinity);
    const w=iw*scale,h=ih*scale;
    const offset=(token,free,axis)=>{
      if(token==='center')return free/2;
      if(token===(axis==='x'?'left':'top'))return 0;
      if(token===(axis==='x'?'right':'bottom'))return free;
      if(/^-?[\d.]+%$/.test(token))return free*parseFloat(token)/100;
      if(/^-?[\d.]+px$/.test(token))return parseFloat(token);
      return free/2;
    };
    let parts=String(position).trim().split(/\s+/);
    if(parts.length===1)parts=/^(top|bottom)$/.test(parts[0])?['50%',parts[0]]:[parts[0],'50%'];
    if(parts.length!==2)parts=['50%','50%'];
    if(/^(top|bottom)$/.test(parts[0])||/^(left|right)$/.test(parts[1]))parts.reverse();
    const left=box.left+offset(parts[0],box.width-w,'x'),top=box.top+offset(parts[1],box.height-h,'y');
    return threadsIntersection(box,{left,top,right:left+w,bottom:top+h});
  }
  function actualViewerBounds(snapshot){
    const n=snapshot.node,box=n.getBoundingClientRect(),st=getComputedStyle(n);
    const isVideo=n.tagName==='VIDEO';
    const iw=isVideo?n.videoWidth:n.naturalWidth,ih=isVideo?n.videoHeight:n.naturalHeight;
    // Keep positioning within the visible clipped media bounds.
    const painted=paintedMediaRect(box,iw,ih,st.objectFit,st.objectPosition);
    const visible=threadsIntersection(painted,snapshot.rect);
    return visible.width>0&&visible.height>0?visible:snapshot.rect;
  }
  function viewerToolbarPosition(media,viewport,w,h,close=null){
    // Always keep the entire toolbar within the painted visible media.
    // Adapt the inset for small images without moving into the black margin.
    const r=threadsIntersection(media,viewport);
    const gx=Math.min(12,Math.max(0,(r.width-w)/2));
    const gy=Math.min(12,Math.max(0,(r.height-h)/2));
    const right=r.right-w-gx,left=r.left+gx,top=r.top+gy;
    const candidates=[
      {left:right,top},
      {left:left,top},
      {left:right,top:Math.min(r.bottom-h-gy,top+h+12)},
      {left:left,top:Math.min(r.bottom-h-gy,top+h+12)}
    ];
    const fits=p=>p.left>=r.left&&p.top>=r.top&&p.left+w<=r.right&&p.top+h<=r.bottom;
    const avoids=p=>{
      if(!close)return true;
      const overlap=threadsIntersection({left:p.left-4,top:p.top-4,right:p.left+w+4,bottom:p.top+h+4},close);
      return !overlap.width||!overlap.height;
    };
    return candidates.find(p=>fits(p)&&avoids(p))||
      candidates.find(fits)||{left:r.left,top:r.top};
  }
  function positionViewer(entry,candidate){
    const node=candidate.snapshot.node;
    if(observedViewerMedia!==node&&typeof ResizeObserver==='function'){
      stopViewerObservation();
      viewerResizeObserver=new ResizeObserver(scheduleViewer);
      viewerResizeObserver.observe(node);
      if(candidate.root!==node)viewerResizeObserver.observe(candidate.root);
      observedViewerMedia=node;
    }
    const close=candidate.close?.getBoundingClientRect(),w=entry.group.offsetWidth||76,h=entry.group.offsetHeight||36;
    const media=actualViewerBounds(candidate.snapshot);
    const viewport={left:0,top:0,right:innerWidth,bottom:innerHeight};
    const pos=viewerToolbarPosition(media,viewport,w,h,close);
    entry.group.style.right='auto';entry.group.style.left=Math.round(pos.left)+'px';
    entry.group.style.top=Math.round(pos.top)+'px';
  }
  function syncViewer(){
    if(captureMode||isCopyPreviewVisible()){removeViewer();return;}
    const candidate=findViewer();
    if(!candidate){
      if(viewerEntry&&viewerRect(viewerEntry.root)&&(viewerEntry.routeBound?viewerRoute(location.href):viewerClose(viewerEntry.root))){
        viewerEntry.group.hidden=true;return;
      }
      if(viewerEntry)viewerOrigin=null;
      removeViewer();return;
    }
    const id=resolveViewerIdentity(candidate.root);
    if(!id){removeViewer();return;}
    if(viewerEntry?.root===candidate.root&&samePost(viewerEntry.id,id)&&viewerEntry.group.isConnected){
      viewerEntry.group.hidden=false;positionViewer(viewerEntry,candidate);return;
    }
    removeViewer();
    const group=document.createElement('div');group.className=BTN+' '+VIEWER;
    const card=samePost(viewerOrigin?.id,id)&&validCard(viewerOrigin.card,id)?viewerOrigin.card:null;
    const entry={root:candidate.root,id,card,group,routeBound:!!viewerRoute(location.href)};
    for(const mode of ['current','all']){
      const button=document.createElement('button');button.type='button';button.dataset.action=mode;
      const label=mode==='current'?'下載當前圖片／影片':'下載此貼文全部圖片／影片';
      button.title=label;button.setAttribute('aria-label',label);downloadIcon(button,mode);
      button.addEventListener('click',e=>downloadPost(e,card,id,group,button,mode,entry),true);group.appendChild(button);
    }
    document.body.appendChild(group);viewerEntry=entry;positionViewer(entry,candidate);
  }
  function scheduleViewer(){
    if(viewerTimer!==null)return;
    viewerTimer=setTimeout(()=>{viewerTimer=null;if(!captureMode)for(const entry of thumbnailEntries.values())positionThreadThumb(entry);syncViewer();},90);
  }

  function scan() {
    scanTimer = null;
    if (captureMode) return;
    for(const entry of thumbnailEntries.values())positionThreadThumb(entry);
    for (const anchor of document.querySelectorAll(POST_LINK)) {
      attach(anchor);
    }
    syncViewer();
  }

  function schedule() {
    if (scanTimer !== null) return;
    scanTimer = window.setTimeout(scan, CONFIG.scanDelayMs);
  }

  if (document.body) {
    document.addEventListener('click',e=>{
      if(viewerEntry&&e.target instanceof Element){
        const close=viewerClose(viewerEntry.root);
        if(close&&(close===e.target||close.contains(e.target))){
          removeViewer();viewerOrigin=null;schedule();return;
        }
      }
      rememberMediaClick(e);
    },true);
    document.addEventListener('scroll',scheduleViewer,{passive:true,capture:true});
    document.addEventListener('transitionend',schedule,true);
    document.addEventListener('loadedmetadata',scheduleViewer,true);
    document.addEventListener('resize',e=>{if(e.target?.tagName==='VIDEO')scheduleViewer();},true);
    document.addEventListener('keydown',e=>{if(e.key==='Escape'&&viewerEntry){removeViewer();viewerOrigin=null;}if(['ArrowLeft','ArrowRight','Escape'].includes(e.key))scheduleViewer();},true);
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
    document.addEventListener('load', event => {
      if (event.target?.tagName === 'IMG' || event.target?.tagName === 'VIDEO') schedule();
    }, true);
    window.addEventListener('popstate', schedule);
    window.addEventListener('resize', schedule, { passive: true });
    schedule();
  }

  // Instagram adapter. Separate from the Threads UI and post detection.
  // Implements the download workflow independently; no imported IG Helper
  // or Instagram Download Button implementation, resources or runtime libraries.
  function initInstagram() {
    const CLASS='meta-media-ig-tools',bound=new WeakMap(),groupActions=new WeakMap();
    const videoFallbacks=new Map(),mediaToolbars=new Map();
    let fallbackLayoutPending=false;
    const css=document.createElement('style');
    css.textContent=[
      '.meta-media-ig-anchor{position:relative!important}',
      '.'+CLASS+'{position:absolute;top:15px;right:15px;display:flex;flex-direction:row;align-items:center;gap:8px;z-index:5;line-height:0;background:rgba(0,0,0,.35);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);padding:6px 8px;border-radius:12px;box-shadow:0 4px 12px rgba(0,0,0,.2);border:1px solid rgba(255,255,255,.1);box-sizing:border-box}',
      '.'+CLASS+' button{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;min-width:26px;box-sizing:border-box;padding:4px;border:0;border-radius:6px;background:transparent;color:white;cursor:pointer;line-height:0}',
      '.'+CLASS+' button:hover{background:rgba(255,255,255,.25)}',
      '.'+CLASS+' button:disabled{opacity:.6;cursor:wait}',
      '.'+CLASS+' button:focus-visible{outline:2px solid white;outline-offset:2px}',
      '.'+CLASS+' svg{display:block;width:18px;height:18px;flex:none}',
      '.'+CLASS+'-floating{position:fixed;top:72px;right:18px;z-index:9999}',
      '.'+CLASS+'-story-inset{position:fixed!important;right:auto;left:0;top:0;z-index:2147483000;background:rgba(0,0,0,.45);padding:4px 6px;border:0;border-radius:9px;box-shadow:none}',
      '.'+CLASS+'-story-inset button{width:28px;height:28px;min-width:28px;padding:3px}',
      '.'+CLASS+'-story-inset svg{width:22px;height:22px}',
      '.'+CLASS+'-story-inset[hidden]{display:none!important}',
      '.'+CLASS+'-header{position:static;display:inline-flex;flex-direction:row;align-items:center;justify-content:center;flex:0 0 auto;gap:8px;margin:0 8px 0 0;padding:0;border:0;border-radius:0;box-shadow:none;background:transparent;backdrop-filter:none;-webkit-backdrop-filter:none;z-index:auto}',
      '.'+CLASS+'-header button{color:inherit;width:28px;height:28px;min-width:28px;padding:3px}',
      '.'+CLASS+'-header button:hover{background:rgba(128,128,128,.15)}',
      '.'+CLASS+'-header svg{width:22px;height:22px}',
      '.'+CLASS+'-header button:focus-visible{outline-color:currentColor}',
      '.'+CLASS+'-video-portal{position:fixed!important;top:0;left:0;right:auto;margin:0;z-index:2147483000;pointer-events:auto;flex-direction:row;gap:6px;padding:3px 5px;border-radius:8px}',
      '.'+CLASS+'-media-overlay{position:absolute!important;top:12px;right:12px;z-index:10;background:rgba(0,0,0,.45);padding:4px 6px;border:0;border-radius:9px;box-shadow:none;gap:8px}',
      '.'+CLASS+'-media-overlay button,.'+CLASS+'-video-portal button{width:28px;height:28px;min-width:28px;padding:3px}',
      '.'+CLASS+'-media-overlay svg,.'+CLASS+'-video-portal svg{width:22px;height:22px}',
      '.'+CLASS+'-video-portal{background:rgba(0,0,0,.45);padding:4px 6px;border:0;border-radius:9px;box-shadow:none;gap:8px}',
      '.'+CLASS+'-media-overlay[hidden],.'+CLASS+'-video-portal[hidden]{display:none!important}',
      '.meta-media-ig-more-row{display:flex!important;flex-direction:row!important;align-items:center!important;flex:0 0 auto!important;width:auto!important;min-width:0!important;white-space:nowrap!important}'

    ].join('');
    (document.head||document.documentElement).append(css);
    function icon(button,name){downloadIcon(button,name);}
    const profileNames=/^[A-Za-z0-9._]{1,30}$/;
    const reserved=new Set(['accounts','direct','explore','reels','reel','p','tv','stories','about','developer','privacy','terms','challenge','web','api']);
    let scanPending=false, previousPath=location.pathname;
    const visible=e=>{
      const r=e.getBoundingClientRect();
      return r.width>0&&r.height>0&&r.bottom>0&&r.right>0&&r.top<innerHeight&&r.left<innerWidth&&
        getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none';
    };

    function igIdentity(raw) {
      try {
        const u=new URL(raw,location.href);
        if(u.protocol!=='https:'||!(/^(?:www\.)?instagram\.com$/i.test(u.hostname)))return null;
        const m=/^\/(?:(?:[A-Za-z0-9._]+)\/)?(p|reel|reels|tv)\/([A-Za-z0-9_-]{3,24})\/?$/.exec(u.pathname);
        if(!m)return null;
        return {code:m[2],kind:m[1]==='p'?'p':'reel',path:'/'+(m[1]==='p'?'p':'reel')+'/'+m[2]+'/'};
      }catch(_){return null;}
    }

    function igMediaId(code) {
      if(!/^[A-Za-z0-9_-]{3,24}$/.test(code))return null;
      let result=0n;
      const symbols='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
      for(const c of code)result=result*64n+BigInt(symbols.indexOf(c));
      return result.toString();
    }

    function igURLs(root) {
      return new Set([...root.querySelectorAll('a[href]')].map(a=>igIdentity(a.href)?.code).filter(Boolean));
    }

    function postIdentity(card) {
      // Timestamp links are preferred over links appearing inside captions.
      const timeLinks=[...card.querySelectorAll('time')].map(t=>igIdentity(t.closest('a[href]')?.href)).filter(Boolean);
      const ids=timeLinks.length?timeLinks:[...card.querySelectorAll('a[href]')].map(a=>igIdentity(a.href)).filter(Boolean);
      const codes=new Set(ids.map(x=>x.code));
      if(codes.size===1)return ids[0];
      return null;
    }

    function igAsset(raw,type) {
      const url=mediaURL(raw);
      if(!url)return null;
      const u=new URL(url);
      // Only actual media CDN hosts; never save a web page as MP4.
      if(!/(?:^|\.)(?:cdninstagram\.com|fbcdn\.net)$/i.test(u.hostname))return null;
      if(type==='video'&&!/\.mp4$/i.test(u.pathname))return null;
      return url;
    }

    function igParse(record) {
      if(!record||typeof record!=='object')return {files:[],total:0,missing:0};
      const root=record.media||record;
      const sidecar=root.edge_sidecar_to_children?.edges;
      const attachments=Array.isArray(root.carousel_media)&&root.carousel_media.length
        ?root.carousel_media:Array.isArray(sidecar)&&sidecar.length?sidecar.map(x=>x.node):[root];
      const files=[],seen=new Set();
      let missing=0;
      for(const [position,raw] of attachments.slice(0,30).entries()){
        const item=raw?.node||raw;
        if(!item){missing++;continue;}
        const video=item.is_video===true||Number(item.media_type)===2||
          /Video/i.test(item.__typename||'')||!!item.video_url||!!item.video_versions?.length;
        const type=video?'video':'image';
        const variants=video?item.video_versions:(item.image_versions2?.candidates||item.display_resources);
        const candidates=(Array.isArray(variants)?variants:[]).map(v=>({
          url:igAsset(v?.url||v?.src,type),
          area:(Number(v?.width||v?.config_width)||0)*(Number(v?.height||v?.config_height)||0)
        })).filter(x=>x.url).sort((a,b)=>b.area-a.area);
        const url=candidates[0]?.url||igAsset(video?item.video_url:item.display_url,type);
        if(!url){missing++;continue;}
        const key=new URL(url).pathname;
        if(seen.has(key))continue;
        seen.add(key);
        const aliases=[...new Set([url,...candidates.map(v=>v.url)].map(u=>new URL(u).pathname))];
        const posterVariants=item.image_versions2?.candidates||item.display_resources||[];
        const posters=video?[item.display_url,item.thumbnail_src,
          ...(Array.isArray(posterVariants)?posterVariants.map(v=>v?.url||v?.src):[])]
          .map(u=>igAsset(u,'image')).filter(Boolean).map(u=>new URL(u).pathname):[];
        files.push({type,url,position:position+1,aliases,posters});
      }
      return {files,total:attachments.length,missing,
        owner:root.user?.username||root.owner?.username||null,
        taken:root.taken_at||root.taken_at_timestamp||null,
        code:root.code||root.shortcode||null,
        postKind:root.product_type==='clips'?'reel':null,
        caption:typeof root.caption?.text==='string'?root.caption.text:
          typeof root.edge_media_to_caption?.edges?.[0]?.node?.text==='string'?root.edge_media_to_caption.edges[0].node.text:null};
    }

    function igRecordMatches(record,code,id) {
      if(!record||typeof record!=='object')return false;
      const found=record.code||record.shortcode;
      if(found&&code)return found===code;
      const pk=record.pk||record.id;
      return !!id&&typeof pk!=='number'&&String(pk||'').split('_')[0]===id;
    }

    function igCollect(doc,identity) {
      let best={files:[],total:0,missing:0};
      const id=identity.id||igMediaId(identity.code||'');
      for(const el of doc.querySelectorAll('script[type="application/json"],script[type="application/ld+json"]')){
        const str=el.textContent||'';
        if(str.length>4000000||!(identity.code&&str.includes(identity.code)||id&&str.includes(id)))continue;
        let obj;try{obj=JSON.parse(str)}catch(_){continue;}
        let count=0;
        function visit(x,depth){
          if(!x||typeof x!=='object'||depth>32||++count>25000)return;
          if(Array.isArray(x)){for(const y of x)visit(y,depth+1);return;}
          if(igRecordMatches(x,identity.code,id)){
            const p=igParse(x);
            if(p.files.length>best.files.length||
               p.files.length===best.files.length&&p.total>best.total&&p.files.length)best=p;
          }
          for(const [k,v] of Object.entries(x))if(k!=='video_versions'&&k!=='image_versions2')visit(v,depth+1);
        }
        visit(obj,0);
      }
      return best;
    }

    function igAppId(){
      for(const script of document.querySelectorAll('script:not([src])')){
        const m=/"(?:X-IG-App-ID|appId|app_id)"\s*:\s*"?(\d{8,20})"?/.exec(script.textContent||'');
        if(m)return m[1];
      }
      return null;
    }

    async function igFetch(path,headers={}){
      const url=new URL(path,location.origin);
      if(url.origin!==location.origin)return null;
      const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),10000);
      try{
        const response=await fetch(url,{method:'GET',credentials:'same-origin',redirect:'error',cache:'no-store',headers,signal:ctrl.signal});
        if(!response.ok)return null;
        const content=await response.text();
        return content.length<=8000000?content:null;
      }catch(_){return null;}finally{clearTimeout(timer);}
    }

    async function igInfo(identity){
      const id=identity.id||igMediaId(identity.code||'');
      const appId=igAppId();
      if(!id||!/^\d{1,30}$/.test(id)||!appId)return null;
      const raw=await igFetch('/api/v1/media/'+id+'/info/',{'X-IG-App-ID':appId,Accept:'application/json'});
      if(!raw)return null;
      try{
        const response=JSON.parse(raw);
        const item=(response.items||[]).find(x=>igRecordMatches(x,identity.code,id));
        return item?igParse(item):null;
      }catch(_){return null;}
    }

    function igDom(scope,onlyVisible=false){
      const result=[],seen=new Set();
      const videos=[...scope.querySelectorAll('video')].filter(v=>!onlyVisible||visible(v));
      const posters=new Set(videos.map(v=>v.poster).filter(Boolean).map(u=>{try{return new URL(u).pathname}catch(_){return ''}}));
      let missing=0;
      for(const node of scope.querySelectorAll('img,video')){
        if(onlyVisible&&!visible(node))continue;
        const video=node.tagName==='VIDEO',r=node.getBoundingClientRect();
        if(!video){
          if(node.closest('header,nav,aside')||/profile picture|avatar|頭像|大頭貼/i.test(node.alt||''))continue;
          if(r.width<150||r.height<110)continue;
          // An image inside the same player may be its poster.
          if(node.parentElement?.querySelector('video'))continue;
        }
        const url=igAsset(directURL(node),video?'video':'image');
        if(!url){if(video)missing++;continue;}
        const key=new URL(url).pathname;
        if(!video&&posters.has(key))continue;
        if(seen.has(key))continue;
        seen.add(key);result.push({type:video?'video':'image',url});
      }
      return {files:result,total:result.length+missing,missing,domOnly:true};
    }

    function better(a,b){
      if(!b?.files?.length)return a;
      if(!a?.files?.length)return b;
      const av=a.files.filter(f=>f.type==='video').length,bv=b.files.filter(f=>f.type==='video').length;
      // A verified native video must not be replaced by a poster.
      if(bv<av)return a;
      if(bv>av||b.files.length>a.files.length)return b;
      if(b.files.length===a.files.length&&a.domOnly&&!b.domOnly)return b;
      return a;
    }

    // Anchor the controls to the stable media viewport, not an individual slide.
    function mediaNodes(scope){
      return [...scope.querySelectorAll('img,video')].filter(n=>{
        if(n.closest('header,nav,aside')||/profile picture|avatar|頭像|大頭貼/i.test(n.alt||''))return false;
        const a=n.closest('article'),owner=scope.closest('article');
        if(a&&owner&&a!==owner)return false;
        const r=n.getBoundingClientRect(),style=getComputedStyle(n);
        return r.width>=150&&r.height>=110&&style.display!=='none'&&style.visibility!=='hidden';
      });
    }
    function mediaHost(scope){
      const nodes=mediaNodes(scope).sort((a,b)=>{
        const x=a.getBoundingClientRect(),y=b.getBoundingClientRect();
        return y.width*y.height-x.width*x.height;
      });
      const media=nodes[0];
      if(!media)return null;
      const r=media.getBoundingClientRect(),ul=media.closest('li')?.parentElement;
      const origin=ul?.tagName==='UL'&&scope.contains(ul)?ul:media;
      let host=null;
      for(let n=origin.parentElement;n&&scope.contains(n);n=n.parentElement){
        if(n.matches('li,ul,picture,img,video,header,nav,aside'))continue;
        const q=n.getBoundingClientRect();
        if(q.width>=r.width*.75&&q.width<=r.width*1.35&&
           q.height>=r.height*.75&&q.height<=r.height*1.35)host=n;
        if(host&&(q.width>r.width*1.35||q.height>r.height*1.35))break;
        if(n===scope)break;
      }
      return host;
    }
    function intersection(a,b){
      const left=Math.max(a.left,b.left),right=Math.min(a.right,b.right);
      const top=Math.max(a.top,b.top),bottom=Math.min(a.bottom,b.bottom);
      return {left,right,top,bottom,width:Math.max(0,right-left),height:Math.max(0,bottom-top)};
    }
    function clippedRect(node,frame){
      let r=intersection(node.getBoundingClientRect(),frame.getBoundingClientRect());
      for(let p=node.parentElement;p&&p!==frame;p=p.parentElement){
        const css=getComputedStyle(p),q=p.getBoundingClientRect();
        const x=/hidden|clip|auto|scroll/.test(css.overflowX),y=/hidden|clip|auto|scroll/.test(css.overflowY);
        if(x||y)r=intersection(r,{left:x?q.left:r.left,right:x?q.right:r.right,top:y?q.top:r.top,bottom:y?q.bottom:r.bottom});
      }
      return r;
    }
    function mediaPath(raw){
      if(!raw)return null;
      try{return new URL(raw).pathname;}catch(_){return null;}
    }
    function chooseVisible(entries){
      const videos=entries.filter(x=>x.type==='video');
      const candidates=entries.filter(x=>x.type==='video'||!videos.some(v=>{
        const overlap=intersection(x.rect,v.rect);
        return overlap.width*overlap.height>=Math.min(x.area,v.area)*.75;
      }));
      candidates.sort((a,b)=>b.area-a.area||b.ratio-a.ratio);
      const best=candidates[0],second=candidates[1];
      if(!best)return null;
      if(second&&second.area>=best.area*.85){
        const overlap=intersection(best.rect,second.rect);
        const path=mediaPath(best.url),other=mediaPath(second.url);
        const sameSource=!!path&&path===other;
        if(!sameSource&&overlap.width*overlap.height<Math.min(best.area,second.area)*.75)return null;
        if(!sameSource&&best.type===second.type)return null;
      }
      return best;
    }
    function captureCurrent(frame){
      if(!frame?.isConnected)return null;
      const entries=[];
      for(const node of mediaNodes(frame)){
        const full=node.getBoundingClientRect(),rect=clippedRect(node,frame);
        const area=rect.width*rect.height,ratio=area/(full.width*full.height);
        if(ratio<.45||area<15000)continue;
        const type=node.tagName==='VIDEO'?'video':'image',url=igAsset(directURL(node),type);
        entries.push({node,type,url,rect,area,ratio,poster:mediaPath(node.poster),path:mediaPath(url)});
      }
      const selected=chooseVisible(entries);
      if(!selected)return null;
      const slide=selected.node.closest('li'),list=slide?.parentElement;
      if(list?.tagName==='UL'&&frame.contains(list)){
        const slides=[...list.children].filter(x=>x.tagName==='LI'&&x.getBoundingClientRect().width>64&&x.querySelector('img,video'));
        selected.index=slides.indexOf(slide);selected.slideCount=slides.length;
      }
      return selected;
    }
    function matchCurrent(snapshot,data){
      if(!snapshot||!data?.files?.length||data.domOnly)return null;
      const candidates=data.files.filter(f=>f.type===snapshot.type);
      const matched=candidates.filter(f=>
        (snapshot.path&&(f.aliases||[mediaPath(f.url)]).includes(snapshot.path))||
        (snapshot.poster&&(f.posters||[]).includes(snapshot.poster)));
      if(matched.length===1)return matched[0];
      if(matched.length>1)return null;
      // Match by ordinal only if all real slides are mounted and metadata is complete.
      if(snapshot.slideCount>1&&data.total===snapshot.slideCount&&
         data.files.length===data.total&&!data.missing&&snapshot.index>=0){
        const indexed=data.files.find(f=>f.position===snapshot.index+1);
        if(indexed?.type===snapshot.type)return indexed;
      }
      if(data.total===1&&data.files.length===1&&!data.missing&&
         candidates.length===1&&!snapshot.slideCount)return candidates[0];
      return null;
    }
    async function resolveCurrent(scope,identity,frame){
      const snapshot=captureCurrent(frame);
      if(!snapshot)return {files:[],missing:1};
      const embedded=igCollect(document,identity);
      let file=matchCurrent(snapshot,embedded);
      if(!file&&snapshot.url)file={type:snapshot.type,url:snapshot.url,
        position:null};
      if(file)return {...embedded,files:[file],missing:0,code:identity.code};
      const resolved=await resolvePost(scope,identity);
      file=matchCurrent(snapshot,resolved);
      return {...resolved,files:file?[file]:[],missing:file?0:1,code:identity.code};
    }

    async function resolvePost(scope,identity){
      let best=igDom(scope);
      if(best.missing&&best.files.every(f=>f.type==='image'))best={...best,files:[]};
      const embedded=igCollect(document,identity);
      // Prefer the verified complete exact-post record to DOM heuristics.
      // Avoid API requests entirely when the page already exposes all items.
      if(embedded.files.length&&embedded.total===embedded.files.length&&!embedded.missing&&
         embedded.files.filter(f=>f.type==='video').length>=best.files.filter(f=>f.type==='video').length)
        return embedded;
      best=better(best,embedded);
      const info=await igInfo(identity);
      if(info?.files?.length&&info.total===info.files.length&&!info.missing&&
         info.files.filter(f=>f.type==='video').length>=best.files.filter(f=>f.type==='video').length)
        return info;
      best=better(best,info);
      // A response can be missing carousel data or no longer accessible.
      // Fetch only the exact clicked post, never another account or service.
      if(!info?.files?.length||info.missing){
        const html=await igFetch(identity.path,{Accept:'text/html'});
        if(html){
          const doc=new DOMParser().parseFromString(html,'text/html');
          best=better(best,igCollect(doc,identity));
          const meta=videoFromCanonicalMeta(doc);
          const canonical=doc.querySelector('link[rel="canonical"]')?.getAttribute('href')||
            doc.querySelector('meta[property="og:url"]')?.getAttribute('content');
          if(meta&&igIdentity(canonical)?.code===identity.code&&
              !best.files.some(f=>f.type==='video')){
            const url=igAsset(meta,'video');
            if(url)best={files:[{type:'video',url}],total:1,missing:0};
          }
        }
      }
      // DOM cannot prove that hidden carousel slides were captured.
      if(best.domOnly&&scope.querySelector('button[aria-label="Next"],[aria-label="Next"],[aria-label="下一步"],[aria-label="下一張"]'))
        best={...best,missing:Math.max(1,best.missing)};
      return best;
    }

    function storyScope(){
      const options=[...document.querySelectorAll('section')].filter(s=>visible(s)&&s.querySelector('video,img'));
      const candidates=options.filter(s=>[...s.querySelectorAll('video,img')].some(n=>visible(n)&&n.getBoundingClientRect().height>180));
      return candidates.length===1?candidates[0]:null;
    }

    function storyIdentity(){
      const m=/^\/stories\/([^/]+)(?:\/(\d+))?\/?$/.exec(location.pathname);
      if(!m)return null;
      return {owner:m[1],id:m[1]==='highlights'?null:m[2]||null,highlight:m[1]==='highlights',groupId:m[1]==='highlights'?m[2]||null:null,key:location.pathname};
    }

    async function resolveStory(scope,identity){
      if(identity.id){
        let p=better(igCollect(document,identity),await igInfo(identity));
        if(p.files.length===1)return p;
      }
      // Highlight ID is not the current story ID; never guess from unrelated items.
      if(!scope)return {files:[],missing:1};
      const d=igDom(scope,true);
      const vids=d.files.filter(f=>f.type==='video');
      if(vids.length===1)return {files:vids,missing:0,domOnly:true};
      if(d.missing||d.files.length!==1)return {files:[],missing:1};
      return d;
    }

    // Resolve one explicit story group only. Do not combine neighbouring
    // reels, expired stories or other highlight collections.
    function storyNumericId(value){
      const id=typeof value==='string'?value:typeof value==='number'&&Number.isSafeInteger(value)?String(value):'';
      return /^\d{1,30}$/.test(id)?id:null;
    }
    function storyItemId(item){
      return storyNumericId(String(item?.pk||item?.id||'').split('_')[0]);
    }
    function storyGroupData(group,identity){
      if(!group||typeof group!=='object')return null;
      const raw=group.items||group.edges;
      if(!Array.isArray(raw)||!raw.length)return null;
      const items=raw.map(x=>x?.node||x);
      const owner=group.user?.username||group.owner?.username||null;
      const userId=storyNumericId(group.user?.pk||group.user?.id||group.owner?.id);
      const key=String(group.id||group.reel_id||group.pk||'');
      const isHighlight=key.startsWith('highlight:')||group.reel_type==='highlight_reel'||group.reel_type==='highlight'||group.is_highlight===true;
      if(identity.highlight){
        if(!identity.groupId||!(key==='highlight:'+identity.groupId||(isHighlight&&key===identity.groupId)))return null;
      }else{
        if(isHighlight||!owner||owner.toLowerCase()!==identity.owner.toLowerCase())return null;
        if(identity.id&&!items.some(item=>storyItemId(item)===identity.id))return null;
        if(key&&userId&&key!==userId)return null;
      }
      // Reject conflicting item ownership; never trust just the containing key.
      if(items.some(item=>{
        const name=item?.user?.username||item?.owner?.username;
        const uid=storyNumericId(item?.user?.pk||item?.user?.id||item?.owner?.id);
        return (name&&owner&&name.toLowerCase()!==owner.toLowerCase())||(uid&&userId&&uid!==userId);
      }))return null;
      const files=[],seen=new Set();let missing=0;
      for(const [i,item] of items.slice(0,200).entries()){
        const id=storyItemId(item);
        if(!id||seen.has(id)){missing++;continue;}seen.add(id);
        const p=igParse(item);
        if(p.files.length!==1||p.missing){missing++;continue;}
        const account=owner||p.owner||(!identity.highlight?identity.owner:null);
        files.push({...p.files[0],position:i+1,storyMeta:{
          account,published:postDate(p.taken),caption:p.caption||null,code:id,
          source:identity.highlight?'https://www.instagram.com/stories/highlights/'+identity.groupId+'/':
            'https://www.instagram.com/stories/'+encodeURIComponent(identity.owner)+'/'+id+'/'
        }});
      }
      return {files,total:items.length,missing:missing+Math.max(0,items.length-200),
        owner,userId,groupKey:key};
    }
    function storyGroupsFromJSON(root,identity){
      let best=null,count=0;
      function walk(x,depth){
        if(!x||typeof x!=='object'||depth>34||++count>50000)return;
        if(Array.isArray(x)){for(const y of x)walk(y,depth+1);return;}
        if(Array.isArray(x.items)||Array.isArray(x.edges)){
          const p=storyGroupData(x,identity);
          if(p&&(!best||p.files.length>best.files.length))best=p;
        }
        // Some REST responses put the reel ID in the map key only.
        if(x.reels&&typeof x.reels==='object'&&!Array.isArray(x.reels)){
          for(const [key,value] of Object.entries(x.reels)){
            if(!value||typeof value!=='object')continue;
            const p=storyGroupData({...value,id:value.id||key},identity);
            if(p&&(!best||p.files.length>best.files.length))best=p;
          }
        }
        for(const [k,v] of Object.entries(x))if(!['video_versions','image_versions2','display_resources'].includes(k))walk(v,depth+1);
      }
      walk(root,0);return best;
    }
    function storyGroupsFromDocument(doc,identity){
      let best=null;
      for(const el of doc.querySelectorAll('script[type="application/json"],script[type="application/ld+json"]')){
        const raw=el.textContent||'';
        if(raw.length>8000000||!(identity.highlight?raw.includes(identity.groupId||'__missing__'):raw.toLowerCase().includes(identity.owner.toLowerCase())))continue;
        let parsed;try{parsed=JSON.parse(raw);}catch(_){continue;}
        const p=storyGroupsFromJSON(parsed,identity);
        if(p&&(!best||p.files.length>best.files.length))best=p;
      }
      return best;
    }
    async function resolveAllStories(identity){
      let best=storyGroupsFromDocument(document,identity);
      if(best?.files.length===best?.total&&!best?.missing&&best?.total>0)return best;
      // Exact same-origin page data may contain a complete group not present
      // in the hydrated document. Only requested on an explicit button click.
      const html=await igFetch(identity.key,{Accept:'text/html'});
      if(html){
        const doc=new DOMParser().parseFromString(html,'text/html');
        const p=storyGroupsFromDocument(doc,identity);
        if(p&&(!best||p.files.length>best.files.length))best=p;
      }
      if(best?.files.length===best?.total&&!best?.missing&&best?.total>0)return best;
      const appId=igAppId()||'936619743392459';
      const headers={'X-IG-App-ID':appId,Accept:'application/json'};
      let reel=identity.highlight&&identity.groupId?'highlight:'+identity.groupId:best?.userId;
      if(!reel&&!identity.highlight&&/^[A-Za-z0-9._]{1,30}$/.test(identity.owner)){
        const raw=await igFetch('/api/v1/users/web_profile_info/?username='+encodeURIComponent(identity.owner),headers);
        try{
          const u=JSON.parse(raw||'null')?.data?.user;
          if(u?.username?.toLowerCase()===identity.owner.toLowerCase())reel=storyNumericId(u.id||u.pk);
        }catch(_){}
      }
      if(reel){
        const raw=await igFetch('/api/v1/feed/reels_media/?reel_ids='+encodeURIComponent(reel),headers);
        try{
          const p=storyGroupsFromJSON(JSON.parse(raw||'null'),identity);
          if(p&&(!best||p.files.length>best.files.length))best=p;
        }catch(_){}
      }
      // Do not pretend that a single displayed item is a complete group.
      return best||{files:[],total:0,missing:1};
    }

    function profileScope(){
      const m=/^\/([A-Za-z0-9._]{1,30})\/?$/.exec(location.pathname);
      if(!m||reserved.has(m[1]))return null;
      const headers=[...document.querySelectorAll('main header')].filter(visible);
      if(headers.length!==1)return null;
      const h=headers[0];
      const pics=[...h.querySelectorAll('img')].filter(i=>/profile picture|avatar|頭像|大頭貼/i.test(i.alt||'')&&visible(i));
      if(pics.length!==1)return null;
      return {scope:h,img:pics[0],owner:m[1]};
    }

    function username(scope,record){
      if(record?.owner&&profileNames.test(record.owner))return record.owner;
      const a=scope?.querySelector('header a[href^="/"]');
      const n=a?.getAttribute('href')?.replace(/^\/|\/$/g,'');
      return n&&profileNames.test(n)&&!reserved.has(n)?n:'Instagram';
    }
    function timestamp(scope,record){
      const taken=Number(record?.taken);
      if(Number.isFinite(taken)&&taken>0){
        const d=new Date(taken*1000),pad=n=>String(n).padStart(2,'0');
        return [d.getFullYear(),pad(d.getMonth()+1),pad(d.getDate())].join('')+'_'+[pad(d.getHours()),pad(d.getMinutes()),pad(d.getSeconds())].join('');
      }
      return getTimestamp(scope||document);
    }

    // Find the actual native post menu, including a label on its inner SVG.
    // The media frame is retained for current-slide detection, independently
    // of where the two controls are mounted.
    function postMoreControl(scope,frame){
      const owner=scope.closest('article');
      const box=scope.getBoundingClientRect();
      const mediaTop=Math.min(...mediaNodes(frame).map(n=>n.getBoundingClientRect().top));
      const mediaY=Number.isFinite(mediaTop)?mediaTop:frame.getBoundingClientRect().top;
      const headerBand=Math.min(110,Math.max(64,frame.getBoundingClientRect().height*.16));
      const seen=new Set(),candidates=[];
      for(const el of scope.querySelectorAll('button,[role="button"],[aria-label],svg[aria-label],svg title')){
        const label=[el.getAttribute('aria-label'),el.getAttribute('title'),
          el.tagName.toLowerCase()==='title'?el.textContent:null].filter(Boolean);
        if(!label.some(x=>/^(?:more(?: options| actions)?|post options|options|更多(?:選項|操作)?|其他選項|更多選擇|⋯|…|\.{3})$/i.test(x.trim())))continue;
        const control=el.closest('button,[role="button"]');
        if(!control||seen.has(control)||!scope.contains(control)||control.closest('.'+CLASS))continue;
        if(owner&&control.closest('article')!==owner)continue;
        const r=control.getBoundingClientRect();
        if(r.width<12||r.height<12||r.width>80||r.height>80)continue;
        // Only header menus above (or immediately alongside the top of)
        // this media, not comment menus and player controls farther below.
        const cy=r.top+r.height/2;
        const inHeader=!!control.closest('header');
        // Video-first cards place the header over the player. Permit its
        // bounded upper band, but reject lower player and comment menus.
        if(cy<box.top-4||cy>mediaY+headerBand||r.right<box.left+box.width*.55)continue;
        seen.add(control);
        candidates.push({control,header:inHeader,cy,right:r.right});
      }
      candidates.sort((a,b)=>Number(b.header)-Number(a.header)||a.cy-b.cy||b.right-a.right);
      return candidates[0]?.control||null;
    }
    function menuInsertion(more,scope){
      // Prefer an existing dedicated menu wrapper. Keep the native React
      // control in place and insert siblings without moving it.
      const parent=more.parentElement;
      if(!parent||!scope.contains(parent))return null;
      return {anchor:more,parent};
    }

    function controls(scope,key,resolver,owner,options={}){
      const {host=scope,floating=false,validate=()=>true,allResolver=null,more=null,portal=false}=options;
      const mediaOverlay=!floating&&!portal&&!key.startsWith('avatar:');
      // Post buttons belong to the media, never the native header menu.
      const slot=!mediaOverlay&&more?menuInsertion(more,scope):null;
      const existing=scope?bound.get(scope):null;
      if(existing?.key===key&&existing.group.isConnected&&existing.host===host&&(mediaOverlay||existing.more===more)&&
         (!slot||existing.group.parentElement===slot.parent))return;
      if(existing){mediaToolbars.delete(existing.group);existing.group.remove();existing.row?.classList.remove('meta-media-ig-more-row');}
      if(!floating&&(!host||!host.isConnected))return;
      // If the native menu wrapper is unavailable, retain the media overlay.
      const group=document.createElement('div');
      group.className=CLASS+(portal?' '+CLASS+'-video-portal':floating?' '+CLASS+'-floating':mediaOverlay?' '+CLASS+'-media-overlay':slot?' '+CLASS+'-header':'');
      group.dataset.metaMediaKey=key;
      const current=document.createElement('button');
      current.type='button';current.dataset.action='current';
      const all=allResolver?document.createElement('button'):null;
      const titles={current:key.startsWith('story:')?'下載目前限時動態':'下載當前圖片／影片',all:key.startsWith('story:')?'下載目前帳號的全部限時動態／目前精選組合':'下載此貼文全部圖片／影片'};
      current.title=titles.current;current.setAttribute('aria-label',titles.current);
      icon(current,'current');group.append(current);
      if(all){
        all.type='button';all.dataset.action='all';all.title=titles.all;
        all.setAttribute('aria-label',titles.all);icon(all,'all');group.append(all);
      }
      let busy=false;
      async function act(event,mode){
        event.preventDefault();event.stopPropagation();
        if(busy)return;
        if(!validate()){
          current.title='頁面已切換，請重新選取目前貼文';scheduleIG();return;
        }
        const button=mode==='all'?all:current;
        if(!button)return;
        const tab=mode==='open'?window.open('about:blank','_blank'):null;
        if(tab)try{tab.opener=null}catch(_){}
        if(mode==='open'&&!tab){current.title='瀏覽器封鎖新視窗';return;}
        busy=true;current.disabled=true;if(all)all.disabled=true;
        const currentPath=location.pathname;
        icon(button,'busy');button.title='解析中…';
        try{
          const data=await (mode==='all'?allResolver():resolver());
          if(currentPath!==location.pathname||!group.isConnected||!validate()){if(tab)tab.close();return;}
          const files=data?.files||[];
          if(!files.length){
            if(tab)tab.close();icon(button,'error');
            button.title='無法安全辨識目前媒體；請切換至完整畫面或播放影片再試。';return;
          }
          if(mode==='open'){tab.location.replace(files[0].url);icon(button,'done');button.title='已開啟原始媒體';return;}
          const known=key.startsWith('post:')?key.slice(5):null;
          const code=known||data.code||null;
          const story=key.startsWith('story:'),avatar=key.startsWith('avatar:');
          const account=owner||data.owner||(scope.closest('article')?username(scope,data):null);
          const source=story?'https://www.instagram.com'+currentPath:
            avatar?'https://www.instagram.com/'+encodeURIComponent(owner)+'/':
            code&&/^[A-Za-z0-9_-]{3,24}$/.test(code)?
              'https://www.instagram.com/'+(igIdentity(location.href)?.code===code?
                igIdentity(location.href).kind:data.postKind==='reel'?'reel':'p')+'/'+code+'/':null;
          const common={platform:'IG',account:account==='Instagram'?null:account,code:story||avatar?null:code,
            source,published:postDate(data.taken)||(scope.closest('article')?metadataTime(scope):null),
            caption:data.caption||null,total:data.domOnly?null:data.total,
            kind:story?(currentPath.startsWith('/stories/highlights/')?'highlight':'story'):avatar?'avatar':'post',
            downloadedAt:new Date().toISOString()};
          const stillValid=()=>currentPath===location.pathname&&group.isConnected&&validate();
          let failed=0,originalOnly=0;
          for(let i=0;i<files.length;i++){
            button.title='下載 '+(i+1)+'/'+files.length;
            if(!stillValid())return;
            const ordinal=files[i].position||(common.total===1||avatar?1:null);
            try{const status=await saveMedia(files[i],{...common,...(files[i].storyMeta||{}),ordinal},stillValid);if(status==='original')originalOnly++;}
            catch(_){failed++;}
          }
          icon(button,failed||data.missing?'error':'done');
          button.title=failed?'失敗 '+failed+'/'+files.length:
            data.missing?'部分完成：部分媒體未能辨識':'已下載 '+files.length+' 個媒體'+(originalOnly?'（'+originalOnly+' 個保留原檔，未寫入新中繼資料）':'');
        }catch(_){if(tab)tab.close();icon(button,'error');button.title='下載失敗';}
        finally{setTimeout(()=>{
          busy=false;current.disabled=false;if(all)all.disabled=false;
          icon(current,'current');if(all)icon(all,'all');
        },2200);}
      }
      group.addEventListener('pointerdown',e=>e.stopPropagation());
      current.addEventListener('click',e=>{e.stopImmediatePropagation();act(e,'current');});
      if(all)all.addEventListener('click',e=>{e.stopImmediatePropagation();act(e,'all');});
      groupActions.set(group,{act,all:!!all});
      let row=null;
      if(floating||portal)document.body.append(group);
      else if(slot){
        const {parent,anchor}=slot;
        const style=getComputedStyle(parent);
        // If this is a dedicated menu wrapper, make room for the buttons;
        // otherwise preserve the site's existing header layout.
        if(parent.children.length===1||parent.classList.contains('meta-media-ig-more-row')){
          parent.classList.add('meta-media-ig-more-row');row=parent;
        }
        const reversed=getComputedStyle(parent).flexDirection==='row-reverse';
        if(reversed)anchor.after(group);else anchor.before(group);
      }
      else{
        if(getComputedStyle(host).position==='static')host.classList.add('meta-media-ig-anchor');
        host.append(group);
      }
      if(scope)bound.set(scope,{key,group,host,more,row});
      if(mediaOverlay){
        const entry={group,scope,host,validate};mediaToolbars.set(group,entry);
        positionMediaOverlay(entry);
      }
      return group;
    }

    // Without a permalink, resolve only the exact current video's CDN
    // path or poster against a uniquely identified embedded record.
    function uniqueVideoIdentity(snapshot,doc=document){
      if(snapshot?.type!=='video')return null;
      const paths=new Set([snapshot.path,snapshot.poster].filter(Boolean));
      if(!paths.size)return null;
      const matches=new Map();
      for(const script of doc.querySelectorAll('script[type="application/json"],script[type="application/ld+json"]')){
        const raw=script.textContent||'';
        if(raw.length>4000000||![...paths].some(p=>raw.includes(p)||raw.includes(p.replace(/\//g,'\\/'))))continue;
        let obj;try{obj=JSON.parse(raw)}catch(_){continue;}
        let visited=0;
        function walk(x,depth){
          if(!x||typeof x!=='object'||depth>32||++visited>25000)return;
          if(Array.isArray(x)){for(const child of x)walk(child,depth+1);return;}
          const code=x.code||x.shortcode;
          if(typeof code==='string'&&/^[A-Za-z0-9_-]{3,24}$/.test(code)&&
             (x.video_versions||x.video_url||x.carousel_media||x.edge_sidecar_to_children)){
            const data=igParse(x);
            const files=data.files.filter(file=>file.type==='video'&&
              ((snapshot.path&&(file.aliases||[]).includes(snapshot.path))||
               (snapshot.poster&&(file.posters||[]).includes(snapshot.poster))));
            if(files.length===1)matches.set(code,{code,data,file:files[0]});
          }
          for(const [k,v] of Object.entries(x))if(k!=='video_versions'&&k!=='image_versions2')walk(v,depth+1);
        }
        walk(obj,0);
      }
      return matches.size===1?[...matches.values()][0]:null;
    }
    async function resolveUnidentifiedVideo(frame,all=false){
      const snapshot=captureCurrent(frame);
      if(!snapshot||snapshot.type!=='video')return {files:[],missing:1};
      const exact=uniqueVideoIdentity(snapshot);
      if(exact){
        if(all)return {...exact.data,missing:Math.max(exact.data.missing||0,exact.data.total-exact.data.files.length)};
        return {...exact.data,files:[exact.file],missing:0,code:exact.code};
      }
      // A direct URL establishes only the current media, not completeness.
      if(snapshot.url)return {files:[{type:'video',url:snapshot.url,position:null}],missing:all?1:0};
      return {files:[],missing:1};
    }
    function bindUnidentifiedVideo(scope,frame){
      const videos=mediaNodes(frame).filter(n=>n.tagName==='VIDEO');
      if(videos.length!==1)return;
      const video=videos[0];
      const more=postMoreControl(scope,frame);
      controls(scope,'unidentified-video',()=>resolveUnidentifiedVideo(frame),null,{
        host:frame,more,allResolver:()=>resolveUnidentifiedVideo(frame,true),
        validate:()=>scope.isConnected&&frame.isConnected&&scope.contains(frame)&&video.isConnected&&
          frame.contains(video)&&mediaNodes(frame).filter(n=>n.tagName==='VIDEO').length===1
      });
    }
    function standaloneVideoScope(video){
      const vr=video.getBoundingClientRect();
      let fallback=null;
      for(let n=video.parentElement,depth=0;n&&depth<12&&!n.matches('body,html,main,article,[role="main"]');n=n.parentElement,depth++){
        const r=n.getBoundingClientRect();
        if(n.querySelectorAll('video').length!==1||igURLs(n).size>1)break;
        if(r.width>vr.width*1.6||r.height>vr.height*1.65)break;
        if(r.width<vr.width*.8||r.height<vr.height*.8)continue;
        if(!fallback)fallback=n;
        if(postMoreControl(n,n))return n;
      }
      return fallback;
    }

    function playableRect(video){
      if(!video?.isConnected||video.closest('nav,aside'))return null;
      const r=video.getBoundingClientRect(),css=getComputedStyle(video);
      if(r.width<120||r.height<100||css.display==='none'||css.visibility==='hidden')return null;
      const clip=intersection(r,{left:0,top:0,right:innerWidth,bottom:innerHeight});
      if(clip.width<100||clip.height<80)return null;
      // Skip players hidden by a carousel's clipping container.
      for(let p=video.parentElement;p&&p!==document.body;p=p.parentElement){
        const style=getComputedStyle(p),q=p.getBoundingClientRect();
        const x=/hidden|clip|auto|scroll/.test(style.overflowX),y=/hidden|clip|auto|scroll/.test(style.overflowY);
        if((x&&(r.right<=q.left||r.left>=q.right))||(y&&(r.bottom<=q.top||r.top>=q.bottom)))return null;
      }
      return r;
    }
    function videoSnapshot(video){
      const url=igAsset(directURL(video),'video');
      return {type:'video',url,path:mediaPath(url),poster:mediaPath(video.poster)};
    }
    function localVideoTarget(video){
      // Discover a nearby native menu and exact post link when available;
      // neither is required for rendering the fallback toolbar.
      const article=video.closest('article,[role="article"]');
      const vr=video.getBoundingClientRect();
      let scope=video.parentElement,menu=null;
      for(let n=video.parentElement,depth=0;n&&depth<16&&n!==document.body&&n!==document.documentElement;depth++,n=n.parentElement){
        if(n.matches('main,[role="main"]'))break;
        if(n.querySelectorAll('video').length!==1)break;
        const q=n.getBoundingClientRect();
        if(q.width>vr.width*1.8||q.height>vr.height*2.1)break;
        if(q.width>=vr.width*.75&&q.height>=vr.height*.75){
          scope=n;
          const candidate=postMoreControl(n,n);
          if(candidate){menu=candidate;break;}
        }
        if(n===article)break;
      }
      if(article&&article.querySelectorAll('video').length===1){
        const id=postIdentity(article);
        if(id||!menu)scope=article;
      }
      const id=scope?postIdentity(scope):null;
      return {scope,menu:menu||(scope?postMoreControl(scope,scope):null),id};
    }
    async function resolveVideoElement(video,all=false){
      if(!playableRect(video))return {files:[],missing:1};
      const snap=videoSnapshot(video),target=localVideoTarget(video);
      if(target.id){
        const embedded=igCollect(document,target.id);
        const match=matchCurrent(snap,embedded);
        if(all&&match&&embedded.files.length===embedded.total&&!embedded.missing)return embedded;
        if(!all&&match)return {...embedded,files:[match],missing:0,code:target.id.code};
        if(all||!snap.url){
          const frame=mediaHost(target.scope)||video.parentElement;
          const data=await resolvePost(target.scope,target.id);
          const exact=matchCurrent(snap,data);
          if(all&&exact&&!data.domOnly)return {...data,missing:Math.max(data.missing||0,data.total-data.files.length)};
          if(!all&&exact)return {...data,files:[exact],missing:0,code:target.id.code};
        }
      }
      const exact=uniqueVideoIdentity(snap);
      if(exact){
        if(all)return {...exact.data,missing:Math.max(exact.data.missing||0,exact.data.total-exact.data.files.length)};
        return {...exact.data,files:[exact.file],missing:0,code:exact.code};
      }
      if(snap.url)return {files:[{type:'video',url:snap.url,position:null}],missing:all?1:0};
      return {files:[],missing:1};
    }
    function normalVideoToolbar(video){
      // Do not exclude videos merely because they are inside <article>.
      // Only a connected, visible toolbar for this actual player counts.
      for(let p=video.parentElement;p&&p!==document.body;p=p.parentElement){
        const entry=bound.get(p);
        if(entry?.group.isConnected&&!entry.group.classList.contains(CLASS+'-video-portal')&&
           entry.host?.contains(video)&&visible(entry.group)){
          const r=entry.group.getBoundingClientRect();
          const x=r.left+r.width/2,y=r.top+r.height/2;
          const top=document.elementFromPoint(x,y);
          if(top&&entry.group.contains(top))return true;
        }
      }
      return false;
    }
    function igPaintedBounds(node,clip){
      const box=node.getBoundingClientRect(),st=getComputedStyle(node);
      const video=node.tagName==='VIDEO';
      const painted=paintedMediaRect(box,video?node.videoWidth:node.naturalWidth,
        video?node.videoHeight:node.naturalHeight,st.objectFit,st.objectPosition);
      return intersection(painted,clip);
    }
    function igInsetPosition(media,w,h,menu=null){
      // The right corner remains the preferred location, even for video
      // overlays. If the native menu occupies it, move below that menu.
      const gx=Math.min(12,Math.max(0,(media.width-w)/2)),gy=Math.min(12,Math.max(0,(media.height-h)/2));
      const left=media.right-w-gx;
      let top=media.top+gy;
      if(menu){
        const hit=intersection({left:left-4,right:left+w+4,top:top-4,bottom:top+h+4},menu);
        if(hit.width&&hit.height&&menu.bottom+8+h<=media.bottom)top=menu.bottom+8;
      }
      return {left,top};
    }
    function positionMediaOverlay(entry){
      const {scope,host,group}=entry;
      if(!group.isConnected||!host.isConnected||!scope.isConnected){mediaToolbars.delete(group);group.remove();return;}
      if(!entry.validate()){group.hidden=true;return;}
      let selected=captureCurrent(host);
      // During slide transitions keep the all-media control attached to the
      // largest painted slide. This is layout only, never download selection.
      if(!selected){
        selected=(host.matches('a[href]')?[...host.querySelectorAll('img,video')]:mediaNodes(host)).map(node=>({node,rect:clippedRect(node,host)}))
          .sort((a,b)=>b.rect.width*b.rect.height-a.rect.width*a.rect.height)[0];
      }
      if(!selected){group.hidden=true;return;}
      const viewport={left:0,top:0,right:innerWidth,bottom:innerHeight};
      const media=intersection(igPaintedBounds(selected.node,selected.rect),viewport);
      if(media.width<80||media.height<45){group.hidden=true;return;}
      group.hidden=false;
      const w=group.offsetWidth||76,h=group.offsetHeight||36;
      if(media.width<w||media.height<h){group.hidden=true;return;}
      const menu=postMoreControl(scope,host)?.getBoundingClientRect();
      const pos=igInsetPosition(media,w,h,menu);
      const parent=group.offsetParent||host,box=parent.getBoundingClientRect();
      // Absolute coordinates are relative to the actual containing block,
      // not the article header or the full media wrapper.
      group.style.right='auto';
      group.style.left=Math.round(pos.left-box.left-(parent.clientLeft||0)+(parent.scrollLeft||0))+'px';
      group.style.top=Math.round(pos.top-box.top-(parent.clientTop||0)+(parent.scrollTop||0))+'px';
    }
    function positionVideoFallback(video,entry){
      const r=playableRect(video);
      if(!r||normalVideoToolbar(video)){entry.group.hidden=true;return;}
      const viewport={left:0,top:0,right:innerWidth,bottom:innerHeight};
      const media=igPaintedBounds(video,intersection(r,viewport));
      if(media.width<80||media.height<45){entry.group.hidden=true;return;}
      entry.group.hidden=false;
      const w=entry.group.offsetWidth||76,h=entry.group.offsetHeight||36;
      if(media.width<w||media.height<h){entry.group.hidden=true;return;}
      const menu=localVideoTarget(video).menu?.getBoundingClientRect();
      const pos=igInsetPosition(media,w,h,menu);
      const hit=document.elementFromPoint(media.left+media.width/2,media.top+media.height/2);
      const dialog=hit?.closest('[role="dialog"],[aria-modal="true"]');
      if(dialog&&!dialog.contains(video)){entry.group.hidden=true;return;}
      entry.group.style.right='auto';
      entry.group.style.left=Math.round(pos.left)+'px';
      entry.group.style.top=Math.round(pos.top)+'px';
    }
    // Layout only: do not change the story download resolver. Prefer the
    // central active media, not smaller neighbouring story preview tiles.
    function chooseStoryLayout(entries,viewport){
      const mid=(viewport.left+viewport.right)/2;
      const minHeight=Math.max(180,(viewport.bottom-viewport.top)*.35);
      const candidates=entries.filter(e=>e.rect.width>=120&&e.rect.height>=minHeight&&
        e.rect.left<=mid&&e.rect.right>=mid);
      candidates.sort((a,b)=>b.rect.width*b.rect.height-a.rect.width*a.rect.height||
        Math.abs((a.rect.left+a.rect.right)/2-mid)-Math.abs((b.rect.left+b.rect.right)/2-mid));
      const best=candidates[0];
      if(!best)return null;
      return candidates.find(e=>e.type==='video'&&(()=>{
        const overlap=intersection(e.rect,best.rect);
        return overlap.width*overlap.height>=.8*best.rect.width*best.rect.height;
      })())||best;
    }
    function storyInsetPosition(rect,w,h){
      if(rect.width<w||rect.height<h)return null;
      const gx=Math.min(12,(rect.width-w)/2);
      // Reserve the native header, progress bar, playback/menu controls
      // and duration label above the button.
      const gy=Math.min(108,Math.max(12,Math.round(rect.height*.14)),rect.height-h);
      return {left:rect.right-w-gx,top:rect.top+gy};
    }
    function positionStoryToolbar(group){
      if(!group?.isConnected)return;
      const viewport={left:0,top:0,right:innerWidth,bottom:innerHeight};
      const entries=[];
      for(const node of document.querySelectorAll('img,video')){
        if(node.closest('nav,aside,header,.'+CLASS)||/profile picture|avatar|頭像|大頭貼/i.test(node.alt||''))continue;
        const st=getComputedStyle(node);
        if(st.display==='none'||st.visibility==='hidden'||Number(st.opacity)===0)continue;
        const box=node.getBoundingClientRect(),clip=intersection(box,viewport);
        if(clip.width<120||clip.height<180)continue;
        const rect=igPaintedBounds(node,clip);
        if(rect.width<120||rect.height<180)continue;
        const stack=document.elementsFromPoint((rect.left+rect.right)/2,(rect.top+rect.bottom)/2);
        // Some players use pointer-events:none. Their geometry remains
        // valid even if the video element is absent from the hit-test stack.
        if(stack.includes(node)&&stack.slice(0,stack.indexOf(node)).some(el=>/^(IMG|VIDEO)$/.test(el.tagName)&&el.parentElement!==node.parentElement))continue;
        entries.push({node,rect,type:node.tagName==='VIDEO'?'video':'image'});
      }
      const target=chooseStoryLayout(entries,viewport);
      if(!target){group.hidden=true;return;}
      group.hidden=false;
      const pos=storyInsetPosition(target.rect,group.offsetWidth||40,group.offsetHeight||36);
      if(!pos){group.hidden=true;return;}
      group.style.right='auto';
      group.style.left=Math.round(pos.left)+'px';
      group.style.top=Math.round(pos.top)+'px';
    }
    function reconcileVideoFallbacks(){
      fallbackLayoutPending=false;
      for(const entry of mediaToolbars.values())positionMediaOverlay(entry);
      if(storyIdentity()){
        for(const entry of videoFallbacks.values())entry.group.remove();
        videoFallbacks.clear();
        positionStoryToolbar(document.querySelector('.'+CLASS+'-story-inset'));
        return;
      }
      for(const [video,entry] of videoFallbacks){
        if(!video.isConnected||!entry.group.isConnected){
          entry.group.remove();videoFallbacks.delete(video);
        }
      }
      // Scan all actual video elements, including recommendations and dialogs
      // outside <main>. Never fetch anything simply to show a button.
      for(const video of document.querySelectorAll('video')){
        if(!playableRect(video))continue;
        let entry=videoFallbacks.get(video);
        if(!entry&&normalVideoToolbar(video))continue;
        if(!entry){
          const group=controls(video,'video-fallback',()=>resolveVideoElement(video),null,{
            host:video,portal:true,allResolver:()=>resolveVideoElement(video,true),
            validate:()=>!!playableRect(video)&&video.isConnected
          });
          if(!group)continue;
          entry={group};videoFallbacks.set(video,entry);
        }
        positionVideoFallback(video,entry);
      }
      // Previously visible players can leave the viewport without a DOM change.
      for(const [video,entry] of videoFallbacks)if(!playableRect(video))entry.group.hidden=true;
    }
    function scheduleVideoFallbacks(){
      if(fallbackLayoutPending)return;
      fallbackLayoutPending=true;
      requestAnimationFrame(reconcileVideoFallbacks);
    }

    async function gridPostData(identity){
      // A grid image can be a video cover or low-resolution preview.
      // Resolve the actual post rather than download that cover.
      let best=igCollect(document,identity);
      if(best.files.length&&best.total===best.files.length&&!best.missing)return {...best,code:identity.code};
      const api=await igInfo(identity);
      best=better(best,api);
      if(best.files.length&&best.total===best.files.length&&!best.missing)return {...best,code:identity.code};
      const html=await igFetch(identity.path,{Accept:'text/html'});
      if(html){
        const doc=new DOMParser().parseFromString(html,'text/html');
        best=better(best,igCollect(doc,identity));
        const canonical=doc.querySelector('link[rel="canonical"]')?.getAttribute('href')||
          doc.querySelector('meta[property="og:url"]')?.getAttribute('content');
        const mp4=videoFromCanonicalMeta(doc);
        if(!best.files.length&&igIdentity(canonical)?.code===identity.code&&mp4){
          const url=igAsset(mp4,'video');
          if(url)best={files:[{type:'video',url,position:1}],total:1,missing:0,postKind:'reel'};
        }
      }
      return {...best,code:identity.code,missing:Math.max(best.missing||0,best.total-best.files.length)};
    }
    function gridCurrent(data,identity,cover){
      const matches=data.files.filter(file=>cover&&
        ((file.aliases||[mediaPath(file.url)]).includes(cover)||(file.posters||[]).includes(cover)));
      let file=matches.length===1?matches[0]:null;
      if(identity.kind==='reel'&&file?.type!=='video')file=null;
      if(!file&&data.total===1&&data.files.length===1&&!data.missing&&
         (identity.kind!=='reel'||data.files[0].type==='video'))file=data.files[0];
      if(!file&&matches.length===0&&identity.kind==='p'&&data.total===data.files.length&&!data.missing)
        file=data.files.find(f=>f.position===1)||null;
      return {...data,files:file?[file]:[],missing:file?0:1};
    }
    function scanGridThumbnails(){
      for(const link of document.querySelectorAll('a[href*="/p/"],a[href*="/reel/"],a[href*="/reels/"]')){
        if(link.closest('article,header,nav,aside,[role="dialog"],[aria-modal="true"]'))continue;
        const id=igIdentity(link.href);
        if(!id)continue;
        const images=[...link.querySelectorAll('img,video')].filter(n=>{
          const r=n.getBoundingClientRect();
          return r.width>=110&&r.height>=100&&!/profile picture|avatar|頭像|大頭貼/i.test(n.alt||'');
        });
        if(images.length!==1)continue;
        const node=images[0],r=node.getBoundingClientRect();
        if(r.width>innerWidth*.95||r.height>innerHeight*1.5)continue;
        const valid=()=>link.isConnected&&node.isConnected&&link.contains(node)&&igIdentity(link.href)?.code===id.code;
        controls(link,'post:'+id.code,async()=>{
          const cover=mediaPath(node.tagName==='VIDEO'?node.poster:directURL(node));
          const data=await gridPostData(id);
          return gridCurrent(data,id,cover);
        },null,{host:link,validate:valid});
      }
    }

    function scan(){
      scanPending=false;
      if(previousPath!==location.pathname){
        for(const entry of videoFallbacks.values())entry.group.remove();
        videoFallbacks.clear();mediaToolbars.clear();
        document.querySelectorAll('.'+CLASS).forEach(e=>e.remove());
        document.querySelectorAll('.meta-media-ig-more-row').forEach(e=>e.classList.remove('meta-media-ig-more-row'));
        previousPath=location.pathname;
      }
      const story=storyIdentity();
      if(story){
        scheduleVideoFallbacks();
        const s=storyScope();
        const key='story:'+story.key;
        let group=document.querySelector('.'+CLASS+'[data-meta-media-key="'+CSS.escape(key)+'"]');
        if(!group)group=controls(s||document.body,key,()=>resolveStory(storyScope(),story),story.highlight?null:story.owner,{floating:true,allResolver:()=>resolveAllStories(story),validate:()=>storyIdentity()?.key===story.key});
        if(group){
          group.classList.add(CLASS+'-story-inset');
          positionStoryToolbar(group);
        }
        return;
      }
      const profile=profileScope();
      if(profile){
        const {scope,img,owner}=profile;
        controls(scope,'avatar:'+owner,async()=>{
          const url=igAsset(directURL(img),'image');
          return {files:url?[{type:'image',url}]:[],missing:url?0:1};
        },owner);
      }
      const articles=[...document.querySelectorAll('article')];
      const route=igIdentity(location.href);
      if(!route)scanGridThumbnails();
      for(const article of articles){
        const id=postIdentity(article);
        const frame=mediaHost(article);
        if(!frame)continue;
        if(!id){bindUnidentifiedVideo(article,frame);continue;}
        const more=postMoreControl(article,frame);
        // Missing menu labels must not suppress the download controls.
        controls(article,'post:'+id.code,()=>resolveCurrent(article,id,frame),null,{
          host:frame,more,allResolver:()=>resolvePost(article,id),
          validate:()=>article.isConnected&&frame.isConnected&&article.contains(frame)&&postIdentity(article)?.code===id.code
        });
      }
      // Direct reel/post route without an article: accept only an unambiguous
      // main scope. Do not guess which video on an endless Reels feed is active.
      if(route&&!articles.some(a=>postIdentity(a)?.code===route.code)){
        const main=document.querySelector('main');
        if(main&&!articles.length&&igURLs(main).size<=1&&
           (!igURLs(main).size||igURLs(main).has(route.code))&&
           [...main.querySelectorAll('video')].filter(visible).length<=1){
          const frame=mediaHost(main);
          if(frame)controls(main,'post:'+route.code,()=>resolveCurrent(main,route,frame),null,{
            host:frame,more:postMoreControl(main,frame),allResolver:()=>resolvePost(main,route),
            validate:()=>main.isConnected&&frame.isConnected&&main.contains(frame)&&igIdentity(location.href)?.code===route.code&&igURLs(main).size<=1&&(!igURLs(main).size||igURLs(main).has(route.code))
          });
        }
      }
      // Continuous and suggested Reels can lack article and timestamp links.
      // Resolve a small, unique player scope, never the whole feed.
      for(const video of document.querySelectorAll('main video,[role="main"] video')){
        if(video.closest('article')||!visible(video))continue;
        if(route&&bound.get(document.querySelector('main'))?.group.isConnected)continue;
        let alreadyBound=false;
        for(let p=video.parentElement;p&&p!==document.body;p=p.parentElement){
          if(bound.get(p)?.group.isConnected){alreadyBound=true;break;}
        }
        if(alreadyBound)continue;
        const scope=standaloneVideoScope(video);
        if(!scope||scope.querySelector('.'+CLASS))continue;
        const id=postIdentity(scope);
        const frame=mediaHost(scope)||scope;
        if(!id){bindUnidentifiedVideo(scope,frame);continue;}
        controls(scope,'post:'+id.code,()=>resolveCurrent(scope,id,frame),null,{
          host:frame,more:postMoreControl(scope,frame),allResolver:()=>resolvePost(scope,id),
          validate:()=>scope.isConnected&&frame.isConnected&&scope.contains(frame)&&postIdentity(scope)?.code===id.code
        });
      }
    }
    function scheduleIG(){
      scheduleVideoFallbacks();
      if(scanPending)return;
      scanPending=true;setTimeout(()=>{try{scan();}finally{scheduleVideoFallbacks();}},250);
    }
    document.addEventListener('keydown',e=>{
      if(!e.altKey||e.ctrlKey||e.metaKey||e.repeat||e.target?.closest?.('input,textarea,[contenteditable="true"]'))return;
      if(!['KeyK','KeyI'].includes(e.code))return;
      const groups=[...document.querySelectorAll('.'+CLASS)].filter(visible);
      const focused=e.target?.closest?.('article')?.querySelector('.'+CLASS);
      const group=focused||(groups.length===1?groups[0]:null);
      if(!group)return;
      const actions=groupActions.get(group);
      if(!actions)return;
      actions.act(e,e.code==='KeyI'?'open':e.shiftKey||!actions.all?'current':'all');
    });
    new MutationObserver(scheduleIG).observe(document.body,{childList:true,subtree:true});
    window.addEventListener('popstate',scheduleIG);
    window.addEventListener('resize',scheduleIG,{passive:true});
    window.addEventListener('scroll',scheduleVideoFallbacks,{passive:true,capture:true});
    document.addEventListener('transitionend',scheduleVideoFallbacks,true);
    document.addEventListener('load',e=>{if(e.target?.tagName==='IMG')scheduleIG();},true);
    for(const event of ['loadedmetadata','loadeddata','play','playing','resize'])document.addEventListener(event,e=>{if(e.target?.tagName==='VIDEO')scheduleIG();},true);
    scheduleIG();
    console.info('[Meta Media Downloader] 6.6.0 Instagram loaded');
  }

  console.info('[Meta Media Downloader] 6.6.0 Threads loaded');
})();
