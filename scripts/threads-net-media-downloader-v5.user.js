// ==UserScript==
// @name         Threads.net Media Downloader v5 (Maintained Beta)
// @namespace    https://github.com/kevinsmemo/tampermonkey-scripts
// @version      5.1.0-beta.6
// @description  One Download button per Threads post to save that post's photos and direct videos.
// @author       StevenJon0826 (original); kevinsmemo (maintenance)
// @homepageURL  https://github.com/kevinsmemo/tampermonkey-scripts
// @match        https://www.threads.com/*
// @match        https://threads.com/*
// @match        https://www.threads.net/*
// @match        https://threads.net/*
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
      if (/\.m3u8$/i.test(url.pathname)) return null;
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
      const child = element.querySelector('source[src]');
      return [element.currentSrc, element.src, child?.src].map(mediaURL).find(Boolean) || null;
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
  function parsePostRecord(record) {
    const root = record.media && typeof record.media === 'object' ? record.media : record;
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

  function collectStructuredPost(doc, postCode) {
    let best = { files: [], total: 0, unavailableVideos: 0, carousel: false };
    const scripts = doc.querySelectorAll(
      'script[type="application/json"],script[type="application/ld+json"]'
    );
    for (const script of scripts) {
      const content = script.textContent || '';
      if (content.length > 4000000 || !content.includes(postCode) ||
          !/(video_versions|carousel_media|image_versions2)/.test(content)) continue;
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
          if (candidate.files.length && score > current) best = candidate;
        }
        for (const [key, value] of Object.entries(node)) {
          if (key !== 'video_versions' && key !== 'image_versions2') walk(value, depth + 1);
        }
      }
      walk(root, 0);
    }
    return best;
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
      return collectStructuredPost(
        new DOMParser().parseFromString(html, 'text/html'), identity.code
      );
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

  function belongsToPost(element, identity) {
    const mediaLink = element.closest('a[href*="/media"]');
    if (mediaLink) {
      const mediaOwner = identityFrom(mediaLink.href);
      if (mediaOwner && mediaOwner.code !== identity.code) return false;
    }
    if (element.tagName === 'VIDEO') return true;
    if (/profile picture|avatar|頭像|大頭貼/i.test(element.alt || '')) return false;
    if (mediaLink) return true;
    const rect = element.getBoundingClientRect();
    return rect.width >= 150 && rect.height >= 110 && !element.closest('header,nav,aside');
  }

  async function mediaInPost(card, identity) {
    const nodes = [...card.querySelectorAll(MEDIA_SELECTOR)]
      .filter(node => belongsToPost(node, identity));
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
    if ((videoCount > 0 || carouselControls) && (!structured.carousel ||
        structured.unavailableVideos || structured.total < videoCount)) {
      const remote = await permalinkPostMedia(identity);
      if (remote) {
        const rank = p => (p.carousel ? 1000 : 0) + p.files.length * 20 + p.total;
        if (rank(remote) > rank(structured)) structured = remote;
      }
    }
    // Carousel record preserves order and off-screen attachments. With only a
    // single structured item, use DOM instead when it exposes more actual URLs.
    const useStructured = structured.files.length > 0 &&
      (structured.carousel || structured.files.length >= domFiles.length);
    return {
      result: useStructured ? structured.files : domFiles,
      unavailableVideos: useStructured ? structured.unavailableVideos : unresolvedDOMVideos,
    };
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
      const { result: files, unavailableVideos } = await mediaInPost(card, identity);
      if (!files.length) {
        button.textContent = unavailableVideos ? '影片無法下載' : '無可下載媒體';
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
          console.warn('[Threads v5 Maintained] Download failed', error);
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

  function findCard(anchor, identity) {
    const semanticCard = anchor.closest('article,[role="article"]');
    if (semanticCard) return semanticCard;
    let node = anchor.parentElement;
    let candidate = null;
    for (let depth = 0; depth < 14 && node && node !== document.body; depth++, node = node.parentElement) {
      const bounds = node.getBoundingClientRect();
      if (bounds.width < 240 || bounds.height < 95) continue;
      const links = [...node.querySelectorAll(POST_LINK)].map(a => identityFrom(a.href)?.code).filter(Boolean);
      const codes = new Set(links);
      if (!codes.has(identity.code)) continue;
      if (codes.size > 2) break;
      const hasMedia = !!node.querySelector(MEDIA_SELECTOR);
      if (hasMedia) candidate = node;
      if (hasActions(node) && (hasMedia || depth >= 3)) return node;
    }
    return candidate;
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
    const existing = installed.get(card);
    if (existing && existing.button.isConnected) {
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
  console.info('[Threads v5 Maintained] 5.1.0-beta.6 loaded');
})();
