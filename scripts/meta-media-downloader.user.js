// ==UserScript==
// @name         Meta Media Downloader
// @namespace    https://github.com/kevinsmemo/tampermonkey-scripts
// @version      6.1.1
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
  const moreOriginalTranslate = new WeakMap();
  const MORE_GAP = 12;
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
    '.' + BTN + '{display:inline-flex!important;align-items:center;justify-content:center;',
    'box-sizing:border-box;flex-shrink:0;vertical-align:middle;',
    'margin-left:8px;padding:5px 10px;min-width:0;height:auto;min-height:28px;',
    'font:500 13px/1.25 Arial,system-ui,sans-serif;letter-spacing:normal;',
    'color:#fff!important;background:#666!important;border:0;border-radius:5px;',
    'cursor:pointer;white-space:nowrap;box-shadow:none!important;}',
    '.' + BTN + ':hover{background:#777!important;}',
    '.' + BTN + ':disabled{opacity:.72;cursor:progress;}',
    '.' + BTN + '.tm-threads-v5-header{position:absolute!important;',
    'right:12px;top:8px;z-index:100;margin:0!important;}',
    '[role="dialog"] .' + BTN + ',[aria-modal="true"] .' + BTN + '{display:none!important;}',
  ].join('');
  (document.head || document.documentElement).appendChild(style);

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
    for (const raw of attachments.slice(0, 30)) {
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
      files.push({ type: isVideo ? 'video' : 'image', url });
    }
    return { files, total: attachments.length, unavailableVideos, carousel };
  }

  // Threads stores an explicitly attached Instagram post/reel in
  // text_post_app_info.linked_inline_media. Never follow share_info,
  // containing_thread or direct_replies: those are different posts.
  function parsePostRecord(record) {
    const native = parseNativeMedia(record);
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
    const unavailableVideos = results.reduce((sum,r) => sum + r.unavailableVideos,0);
    if (videoFiles.length) return {
      files, total:results.reduce((sum,r) => sum+r.total,0),
      unavailableVideos, carousel:results.some(r=>r.carousel)||items.length>1,
      linked:true
    };
    // A linked video without a usable URL is not a downloadable still image.
    if (unavailableVideos) return {files:[],total:0,unavailableVideos,carousel:false,linked:true};
    if (!native.files.length && files.length)
      return {files,total:files.length,unavailableVideos:0,carousel:files.length>1,linked:true};
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
        total: 1, unavailableVideos: 0, carousel: false, linked: structured.linked
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
    return {result,embedded,
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

  async function downloadPost(event, card, identity, button) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    if (button.disabled) return;
    button.disabled = true;
    let failures = 0;
    try {
      button.textContent = '解析中…';
      const { result: files, unavailableVideos, embedded, ambiguous } = await mediaInPost(card, identity);
      if (!files.length) {
        if (ambiguous) {
          button.textContent='無法辨識貼文';
          button.title='貼文範圍已變動，請重新整理後重試，避免下載其他貼文。';
          return;
        }
        if (embedded) {
          button.textContent='轉貼影片無直連';
          button.title='尚未找到這則 Instagram 轉貼影片的 HTTPS 直連。可先播放影片再試，或開啟 Instagram 原始貼文。';
          console.warn('[Threads v5 Maintained] Embedded video unavailable',{postCode:identity.code});
          return;
        }
        const videos = [...card.querySelectorAll('video')];
        const hasBlob = videos.some(v => [v.currentSrc, v.src].some(
          url => typeof url === 'string' && url.startsWith('blob:')
        ));
        const hasStreaming = videos.some(v => [v.currentSrc, v.src].some(
          url => /\.(?:m3u8|mpd)(?:$|[?#])/i.test(url || '')
        ));
        button.textContent = unavailableVideos ? '影片無法下載' : '無可下載媒體';
        button.title = unavailableVideos
          ? (hasBlob ? '這則影片目前只有 blob: 播放來源，尚未找到可直接下載的 HTTPS 影片網址。' :
             hasStreaming ? '目前取得的是串流播放清單，而非可直接下載的 MP4。' :
             'Threads 未提供這則貼文可辨識的影片直連網址。')
          : '目前找不到這則貼文可下載的媒體，請先確認已開啟原始貼文。';
        console.warn('[Threads v5 Maintained] No direct download URL', {
          postCode: identity.code, unavailableVideos,
          blobPlayer: hasBlob, streamPlaylist: hasStreaming
        });
        return;
      }
      const stamp = getTimestamp(card);
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        button.textContent = (i + 1) + '/' + files.length;
        const name = 'Threads-' + safeFilenameSegment(identity.user) + '-' + stamp +
          '-' + (i + 1) + mediaExtension(file.url, file.type);
        try { await downloadOne(file.url, name); }
        catch (error) {
          failures++;
          const reason = String(error?.error || error?.message || error || 'unknown');
          button.title = '下載請求失敗：' + reason.slice(0, 120) +
            '。請確認 Tampermonkey 下載權限，或來源 CDN 是否拒絕請求。';
          console.warn('[Threads v5 Maintained] Download failed', {
            postCode: identity.code, mediaIndex: i + 1,
            reason, host: new URL(file.url).hostname
          });
        }
      }
      button.textContent = failures ? ('失敗 ' + failures + '/' + files.length) :
        unavailableVideos ? '部分完成' : '已下載';
      // Deliberately do not click Like or Spoiler as a side effect.
    } catch (error) {
      button.textContent = '下載失敗';
      console.warn('[Threads v5 Maintained]', error);
    } finally {
      setTimeout(() => {
        if (!button.isConnected) return;
        button.textContent = 'Download';
        button.disabled = false;
      }, 2600);
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

  function findMoreControl(card, anchor) {
    // Look close to the post's own timestamp, not in nested quoted posts.
    const candidates = [...card.querySelectorAll('button,[role="button"]')]
      .filter(el => {
        const label = [el.getAttribute('aria-label'), el.getAttribute('title'), el.textContent]
          .filter(Boolean).join(' ').trim();
        return /^(more|更多|更多選項|其他選項|options|⋯|•••)$/i.test(label) ||
          /^(more options|post options)$/i.test(label);
      });
    if (!candidates.length) return null;
    const time = anchor.getBoundingClientRect();
    candidates.sort((a, b) => {
      const ar = a.getBoundingClientRect(), br = b.getBoundingClientRect();
      return (Math.abs(ar.top - time.top) + Math.abs(ar.left - time.right) / 10) -
        (Math.abs(br.top - time.top) + Math.abs(br.left - time.right) / 10);
    });
    return candidates[0];
  }

  // Preserve the original v5 header layout: More, then Download. The React
  // header already puts More at the far right; inserting a button after it in
  // normal flow clips the new control. Position Download INSIDE the post's
  // header boundary, then translate More left to reserve the original order.
  function layoutHeaderActions(card, button, more) {
    if (!card.isConnected || !button.isConnected) return;
    if (getComputedStyle(card).position === 'static') card.style.position = 'relative';
    if (!more || !more.isConnected) {
      button.style.top = '8px';
      button.style.right = '12px';
      return;
    }

    // Measure the unshifted More position; otherwise repeated scans would
    // accumulate offsets and drift out of alignment.
    if (!moreOriginalTranslate.has(more)) {
      moreOriginalTranslate.set(more, more.style.translate || '');
    }
    more.style.translate = moreOriginalTranslate.get(more);
    const m = more.getBoundingClientRect();
    const c = card.getBoundingClientRect();
    const buttonWidth = Math.max(48, Math.ceil(button.getBoundingClientRect().width));
    const buttonHeight = Math.ceil(button.getBoundingClientRect().height) || 28;
    const reserved = buttonWidth + MORE_GAP;
    const originalRight = Math.min(c.right - 8, Math.max(c.left + buttonWidth + 8, m.right));
    button.style.right = Math.max(8, Math.round(c.right - originalRight)) + 'px';
    button.style.top = Math.max(0, Math.round(m.top - c.top +
      card.scrollTop + (m.height - buttonHeight) / 2)) + 'px';
    more.style.translate = 'calc(' +
      (moreOriginalTranslate.get(more) || '0px') + ' - ' + reserved + 'px) 0px';
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

  function attach(anchor) {
    if (captureMode || anchor.closest('[role="dialog"],[aria-modal="true"]')) return;
    if (!isTimeLink(anchor)) return;
    const identity = identityFrom(anchor.href);
    const card = findCard(anchor, identity);
    if (!card) return;
    const codes = postTimeCodes(card);
    if (codes.size !== 1 || !codes.has(identity.code)) return;
    const existing = installed.get(card);
    if (existing && existing.button.isConnected) {
      // A shared DOM container is not proof two timestamps refer to the same
      // post. Never silently reuse the parent's button for a reply.
      if (existing.code !== identity.code) {
        console.warn('[Threads v5 Maintained] Ambiguous post card; ' +
          'skipping cross-post Download binding', {
            requestedCode: identity.code, attachedCode: existing.code
          });
        return;
      }
      layoutHeaderActions(card, existing.button, existing.more);
      return;
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.className = BTN;
    button.textContent = 'Download';
    button.title = '下載這則 Threads 貼文的所有可用圖片與影片';
    button.setAttribute('aria-label', '下載此則 Threads 貼文的所有媒體');
    button.addEventListener('click', event => downloadPost(event, card, identity, button), true);
    const more = findMoreControl(card, anchor);
    button.classList.add('tm-threads-v5-header');
    card.appendChild(button);
    layoutHeaderActions(card, button, more);
    installed.set(card, { code: identity.code, button, more });
  }

  function scan() {
    scanTimer = null;
    if (captureMode) return;
    for (const anchor of document.querySelectorAll(POST_LINK)) {
      attach(anchor);
    }
  }

  function schedule() {
    if (scanTimer !== null) return;
    scanTimer = window.setTimeout(scan, CONFIG.scanDelayMs);
  }

  if (document.body) {
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
      '.'+CLASS+'-header{position:static;display:inline-flex;flex-direction:row;align-items:center;justify-content:center;flex:0 0 auto;gap:8px;margin:0 8px 0 0;padding:0;border:0;border-radius:0;box-shadow:none;background:transparent;backdrop-filter:none;-webkit-backdrop-filter:none;z-index:auto}',
      '.'+CLASS+'-header button{color:inherit;width:28px;height:28px;min-width:28px;padding:3px}',
      '.'+CLASS+'-header button:hover{background:rgba(128,128,128,.15)}',
      '.'+CLASS+'-header svg{width:22px;height:22px}',
      '.'+CLASS+'-header button:focus-visible{outline-color:currentColor}',
      '.meta-media-ig-more-row{display:flex!important;flex-direction:row!important;align-items:center!important;flex:0 0 auto!important;width:auto!important;min-width:0!important;white-space:nowrap!important}'

    ].join('');
    (document.head||document.documentElement).append(css);
    const icons={
      current:'<path d="M12 3v12m-5-5 5 5 5-5M4 16v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/>',
      all:'<path d="M7 17H6a5 5 0 0 1-1-9.9A7 7 0 0 1 18 8a4.5 4.5 0 0 1 1 8.9h-2M12 11v10m-4-4 4 4 4-4"/>',
      done:'<path d="m5 12 4 4L19 6"/>',
      error:'<path d="M12 4v10m0 4v1"/>',
      busy:'<path d="M12 3a9 9 0 1 1-9 9"/>'
    };
    function icon(button,name){
      button.innerHTML='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+icons[name]+'</svg>';
    }
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
        taken:root.taken_at||root.taken_at_timestamp||null};
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
        position:snapshot.index>=0?snapshot.index+1:1};
      if(file)return {files:[file],missing:0,owner:embedded.owner,taken:embedded.taken};
      const resolved=await resolvePost(scope,identity);
      file=matchCurrent(snapshot,resolved);
      return {files:file?[file]:[],missing:file?0:1,owner:resolved.owner,taken:resolved.taken};
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
      return {owner:m[1],id:m[1]==='highlights'?null:m[2]||null,highlight:m[1]==='highlights',key:location.pathname};
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
      const media=frame.getBoundingClientRect(),box=scope.getBoundingClientRect();
      const seen=new Set(),candidates=[];
      for(const el of scope.querySelectorAll('button,[role="button"],[aria-label],svg[aria-label],svg title')){
        const label=[el.getAttribute('aria-label'),el.getAttribute('title'),
          el.tagName.toLowerCase()==='title'?el.textContent:null].filter(Boolean);
        if(!label.some(x=>/^(?:more(?: options)?|post options|更多(?:選項|操作)?|其他選項|更多選擇|⋯|…|\.{3})$/i.test(x.trim())))continue;
        const control=el.closest('button,[role="button"]');
        if(!control||seen.has(control)||!scope.contains(control)||control.closest('.'+CLASS))continue;
        if(owner&&control.closest('article')!==owner)continue;
        const r=control.getBoundingClientRect();
        if(r.width<12||r.height<12||r.width>80||r.height>80)continue;
        // Only header menus above (or immediately alongside the top of)
        // this media, not comment menus and player controls farther below.
        const cy=r.top+r.height/2;
        if(cy<box.top-4||cy>media.top+24||r.right<box.left+box.width*.55)continue;
        if(frame.contains(control))continue;
        seen.add(control);
        candidates.push({control,header:!!control.closest('header'),cy,right:r.right});
      }
      candidates.sort((a,b)=>Number(b.header)-Number(a.header)||a.cy-b.cy||b.right-a.right);
      return candidates[0]?.control||null;
    }
    function menuInsertion(more,scope){
      // Climb only menu-only wrappers, never the entire header. Inserting
      // alongside the wrapper lets the existing header flex layout resize.
      let anchor=more;
      for(let i=0;i<5;i++){
        const p=anchor.parentElement;
        if(!p||p===scope||p.matches('header,article,main')||p.children.length!==1)break;
        const r=p.getBoundingClientRect();
        if(r.width>88||r.height>88)break;
        anchor=p;
      }
      const parent=anchor.parentElement;
      if(!parent||!scope.contains(parent))return null;
      return {anchor,parent};
    }

    function controls(scope,key,resolver,owner,options={}){
      const {host=scope,floating=false,validate=()=>true,allResolver=null,more=null}=options;
      const slot=more?menuInsertion(more,scope):null;
      const existing=scope?bound.get(scope):null;
      if(existing?.key===key&&existing.group.isConnected&&existing.host===host&&existing.more===more&&
         (!slot||existing.group.parentElement===slot.parent))return;
      if(existing){existing.group.remove();existing.row?.classList.remove('meta-media-ig-more-row');}
      if(!floating&&(!host||!host.isConnected))return;
      if(more&&!slot)return;
      const group=document.createElement('div');
      group.className=CLASS+(floating?' '+CLASS+'-floating':slot?' '+CLASS+'-header':'');
      group.dataset.metaMediaKey=key;
      const current=document.createElement('button');
      current.type='button';current.dataset.action='current';
      const all=allResolver?document.createElement('button'):null;
      const titles={current:'下載當前圖片／影片',all:'下載此貼文全部圖片／影片'};
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
          const user=safeFilenameSegment(owner||username(scope,data),'Instagram'),stamp=timestamp(scope,data);
          let failed=0;
          for(let i=0;i<files.length;i++){
            button.title='下載 '+(i+1)+'/'+files.length;
            const ordinal=files[i].position||i+1;
            try{await downloadOne(files[i].url,'Instagram-'+user+'-'+stamp+'-'+ordinal+mediaExtension(files[i].url,files[i].type));}
            catch(_){failed++;}
          }
          icon(button,failed||data.missing?'error':'done');
          button.title=failed?'失敗 '+failed+'/'+files.length:
            data.missing?'部分完成：部分媒體未能辨識':'已下載 '+files.length+' 個媒體';
        }catch(_){if(tab)tab.close();icon(button,'error');button.title='下載失敗';}
        finally{setTimeout(()=>{
          busy=false;current.disabled=false;if(all)all.disabled=false;
          icon(current,'current');if(all)icon(all,'all');
        },2200);}
      }
      current.addEventListener('click',e=>act(e,'current'));
      if(all)all.addEventListener('click',e=>act(e,'all'));
      groupActions.set(group,{act,all:!!all});
      let row=null;
      if(floating)document.body.append(group);
      else if(slot){
        const {parent,anchor}=slot;
        const style=getComputedStyle(parent);
        // If this is a dedicated menu wrapper, make room for the buttons;
        // otherwise preserve the site's existing header layout.
        if(parent.children.length===1){
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
    }

    function scan(){
      scanPending=false;
      if(previousPath!==location.pathname){
        document.querySelectorAll('.'+CLASS).forEach(e=>e.remove());
        document.querySelectorAll('.meta-media-ig-more-row').forEach(e=>e.classList.remove('meta-media-ig-more-row'));
        previousPath=location.pathname;
      }
      const story=storyIdentity();
      if(story){
        const s=storyScope();
        const key='story:'+story.key;
        if(!document.querySelector('.'+CLASS+'[data-meta-media-key="'+CSS.escape(key)+'"]'))
          controls(s||document.body,key,()=>resolveStory(storyScope(),story),story.highlight?null:story.owner,{floating:true,validate:()=>storyIdentity()?.key===story.key});
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
      for(const article of articles){
        const id=postIdentity(article);
        if(!id)continue;
        const frame=mediaHost(article);
        if(!frame)continue;
        const more=postMoreControl(article,frame);
        if(!more){
          const previous=bound.get(article);
          if(previous){previous.group.remove();previous.row?.classList.remove('meta-media-ig-more-row');bound.delete(article);}
          continue;
        }
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
    }
    function scheduleIG(){
      if(scanPending)return;
      scanPending=true;setTimeout(scan,250);
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
    scheduleIG();
    console.info('[Meta Media Downloader] 6.1.1 Instagram loaded');
  }

  console.info('[Meta Media Downloader] 6.1.1 Threads loaded');
})();
