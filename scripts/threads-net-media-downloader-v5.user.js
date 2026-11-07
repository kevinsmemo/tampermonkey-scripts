// ==UserScript==
// @name         Threads.net Media Downloader v5 (Maintained Beta)
// @namespace    https://github.com/kevinsmemo/tampermonkey-scripts
// @version      5.1.0-beta.3
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
  const DOWNLOAD_WIDTH = 132;
  const MORE_GAP = 20;
  let scanTimer = null;

  const style = document.createElement('style');
  style.textContent = [
    '.' + BTN + '{display:inline-flex!important;align-items:center;justify-content:center;',
    'box-sizing:border-box;flex-shrink:0;vertical-align:middle;',
    'margin-left:12px;padding:8px 16px;min-width:132px;height:40px;',
    'font:500 18px/1.2 system-ui,-apple-system,BlinkMacSystemFont,sans-serif;',
    'color:#fff!important;background:#666!important;border:0;border-radius:5px;',
    'cursor:pointer;white-space:nowrap;box-shadow:none!important;}',
    '.' + BTN + ':hover{background:#777!important;}',
    '.' + BTN + ':disabled{opacity:.72;cursor:progress;}',
    '.' + BTN + '.tm-threads-v5-header{position:absolute!important;',
    'right:12px;top:8px;width:132px;z-index:100;margin:0!important;}',
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

  function structuredVideoURL(postCode) {
    // Only use JSON demonstrably associated with the clicked post.
    // When the video cannot be disambiguated, fail rather than download the
    // wrong post's media. This is a limited fallback, not a guaranteed fix
    // for blob/adaptive streams.
    const found = new Set();
    const scripts = document.querySelectorAll(
      'script[type="application/json"],script[type="application/ld+json"]'
    );
    for (const script of scripts) {
      const content = script.textContent || '';
      if (content.length > 4000000 || !content.includes(postCode) ||
          !content.includes('video_versions')) continue;
      let root;
      try { root = JSON.parse(content); } catch (_) { continue; }
      let seen = 0;
      function walk(node, matched, depth) {
        if (!node || typeof node !== 'object' || depth > 30 || ++seen > 18000) return;
        if (Array.isArray(node)) {
          node.forEach(item => walk(item, matched, depth + 1));
          return;
        }
        const nodeCode = node.code || node.shortcode || node.post_code;
        const same = matched || nodeCode === postCode;
        if (same && Array.isArray(node.video_versions)) {
          const variants = node.video_versions.map(item => ({
            url: mediaURL(item?.url || item?.src),
            area: (Number(item?.width) || 0) * (Number(item?.height) || 0),
          })).filter(x => x.url).sort((a, b) => b.area - a.area);
          if (variants[0]) found.add(variants[0].url);
        }
        for (const [key, value] of Object.entries(node)) {
          if (key !== 'video_versions') walk(value, same, depth + 1);
        }
      }
      walk(root, false, 0);
    }
    return found.size === 1 ? [...found][0] : null;
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

  function mediaInPost(card, identity) {
    const nodes = [...card.querySelectorAll(MEDIA_SELECTOR)]
      .filter(node => belongsToPost(node, identity));
    const seen = new Set();
    const result = [];
    let unavailableVideos = 0;
    const videos = nodes.filter(n => n.tagName === 'VIDEO');
    const jsonFallback = videos.length === 1 ? structuredVideoURL(identity.code) : null;
    for (const node of nodes) {
      const type = node.tagName === 'VIDEO' ? 'video' : 'image';
      const url = directURL(node) || (type === 'video' ? jsonFallback : null);
      if (!url) {
        if (type === 'video') unavailableVideos++;
        continue;
      }
      if (seen.has(url)) continue;
      seen.add(url);
      result.push({ type, url });
    }
    return { result, unavailableVideos };
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
      const { result: files, unavailableVideos } = mediaInPost(card, identity);
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
    const buttonHeight = 40;
    const reserved = DOWNLOAD_WIDTH + MORE_GAP;
    const originalRight = Math.min(c.right - 8, Math.max(c.left + DOWNLOAD_WIDTH + 8, m.right));
    button.style.right = Math.max(8, Math.round(c.right - originalRight)) + 'px';
    button.style.top = Math.max(0, Math.round(m.top - c.top +
      card.scrollTop + (m.height - buttonHeight) / 2)) + 'px';
    more.style.translate = 'calc(' +
      (moreOriginalTranslate.get(more) || '0px') + ' - ' + reserved + 'px) 0px';
  }

  function attach(anchor) {
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
  console.info('[Threads v5 Maintained] 5.1.0-beta.3 loaded');
})();
