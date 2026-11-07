// ==UserScript==
// @name         Threads Video Downloader (Privacy-Focused Fork)
// @namespace    https://github.com/kevinsmemo/tampermonkey-scripts
// @version      2.0.0-beta.2
// @description  One-click local downloads for visible Threads media, with narrow permissions and the original-style hover button.
// @author       Manolo Zocco (original); kevinsmemo (fork maintenance)
// @homepageURL  https://github.com/kevinsmemo/tampermonkey-scripts
// @match        https://www.threads.com/*
// @match        https://threads.com/*
// @match        https://www.threads.net/*
// @match        https://threads.net/*
// @connect      fbcdn.net
// @connect      *.fbcdn.net
// @connect      cdninstagram.com
// @connect      *.cdninstagram.com
// @connect      www.threads.com
// @connect      threads.com
// @connect      www.threads.net
// @connect      threads.net
// @grant        GM_download
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @noframes
// @run-at       document-idle
// @updateURL    none
// @downloadURL  none
// @license      MIT
// ==/UserScript==

/*
 * Original Threads Video Downloader © 2025 Manolo Zocco (P0L1T3).
 * Adaptation © 2026. Distributed under the MIT License.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to
 * deal in the Software without restriction, including without limitation the
 * rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
 * sell copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL
 * THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
 * DEALINGS IN THE SOFTWARE.
 *
 * Beta limitations: Streams exposed only as blob: or adaptive playlists cannot
 * be downloaded unless Threads also exposes an unambiguous direct CDN URL.
 * No tracking, third-party download services, page-wide network interception,
 * or automatic remote updates are used.
 */

(() => {
  'use strict';

  const MARK = 'tvd-maintained';
  const processed = new WeakSet();
  const limitBytes = 4_000_000;
  const css = `
    .${MARK}-host { isolation: isolate; }
    .${MARK}-button {
      position: absolute !important; left: 8px !important; bottom: 8px !important;
      z-index: 2147483 !important; display: inline-flex !important;
      align-items: center; gap: 6px; box-sizing: border-box;
      height: 34px; padding: 0 12px; border: 0 !important;
      border-radius: 8px; background: rgba(0,0,0,.72) !important;
      color: #fff !important; font: 600 12px/1 sans-serif !important;
      cursor: pointer; opacity: 0; visibility: hidden;
      transform: translateY(2px); transition: opacity .13s, transform .13s;
      white-space: nowrap;
    }
    .${MARK}-host:hover > .${MARK}-button,
    .${MARK}-button:focus-visible,
    .${MARK}-button[data-busy='1'] {
      visibility: visible; opacity: 1; transform: none;
    }
    .${MARK}-button:hover { background: rgba(0,0,0,.92) !important; }
    .${MARK}-button:disabled { cursor: progress; }
    .${MARK}-button svg { width: 16px; height: 16px; flex: none; }
  `;
  GM_addStyle(css);

  function trustedUrl(raw) {
    if (!raw) return null;
    try {
      const u = new URL(raw, location.href);
      if (u.protocol !== 'https:') return null;
      const h = u.hostname.toLowerCase();
      const allowed = ['fbcdn.net', 'cdninstagram.com', 'threads.com', 'threads.net'];
      if (!allowed.some(x => h === x || h.endsWith('.' + x))) return null;
      if (/\.m3u8(?:$|\?)/i.test(u.href)) return null;
      return u.href;
    } catch { return null; }
  }

  function postCode(el) {
    const scope = el.closest('article') || el.closest('[data-visualcompletion]') || document;
    const links = [el.closest('a[href*="/post/"]'), ...scope.querySelectorAll('a[href*="/post/"]')].filter(Boolean);
    for (const link of links) {
      try {
        const url = new URL(link.href, location.href);
        if (!['threads.com','threads.net'].some(h => url.hostname === h || url.hostname.endsWith('.' + h))) continue;
        const match = url.pathname.match(/\/post\/([A-Za-z0-9_-]+)/);
        if (match) return match[1];
      } catch { /* malformed link */ }
    }
    return location.pathname.match(/\/post\/([A-Za-z0-9_-]+)/)?.[1] || 'media';
  }

  function currentMediaUrl(media) {
    const sources = media.tagName === 'VIDEO'
      ? [media.currentSrc, media.src, media.querySelector('source[src]')?.src]
      : [media.currentSrc, media.src];
    return sources.map(trustedUrl).find(Boolean) || null;
  }

  // Safe, on-demand fallback for pages embedding a structured video record.
  // Never choose from unrelated posts, and never guess among multiple videos.
  function embeddedVideoUrl(media) {
    const code = postCode(media);
    if (code === 'media') return null;
    const groups = new Map();
    const scripts = document.querySelectorAll('script[type="application/json"],script[type="application/ld+json"]');
    for (const script of scripts) {
      const s = script.textContent || '';
      if (s.length > limitBytes || !s.includes(code) || !s.includes('video_versions')) continue;
      let root;
      try { root = JSON.parse(s); } catch { continue; }
      let seen = 0;
      const visit = (node, matched = false, depth = 0) => {
        if (!node || typeof node !== 'object' || depth > 32 || ++seen > 20000) return;
        if (Array.isArray(node)) {
          for (const item of node) visit(item, matched, depth + 1);
          return;
        }
        // Media objects often have "code" or "shortcode"; match exactly.
        const ownCode = node.code || node.shortcode || node.post_code;
        const samePost = matched || (typeof ownCode === 'string' && ownCode === code);
        if (samePost && Array.isArray(node.video_versions)) {
          const variants = node.video_versions
            .map(record => ({
              url: trustedUrl(record?.url || record?.src),
              pixels: (Number(record?.width) || 0) * (Number(record?.height) || 0),
            }))
            .filter(x => x.url);
          if (variants.length) {
            // Treat multiple quality variants as a single video attachment.
            // Distinct video attachments remain ambiguous and are not guessed.
            const signature = variants.map(x => x.url).sort().join('|');
            variants.sort((a, b) => b.pixels - a.pixels);
            groups.set(signature, variants[0].url);
          }
        }
        for (const [key, val] of Object.entries(node)) {
          if (key !== 'video_versions') visit(val, samePost, depth + 1);
        }
      };
      visit(root);
    }
    return groups.size === 1 ? [...groups.values()][0] : null;
  }

  function extension(url, media) {
    if (media.tagName === 'VIDEO') return 'mp4';
    try {
      const path = new URL(url).pathname.toLowerCase();
      return /\.(png|webp|gif|jpe?g)$/.exec(path)?.[1]?.replace('jpeg','jpg') || 'jpg';
    } catch { return 'jpg'; }
  }

  function nameFor(media, url) {
    const kind = media.tagName === 'VIDEO' ? 'video' : 'photo';
    const code = postCode(media).replace(/[^\w-]/g, '').slice(0, 60);
    return `threads_${code}_${kind}_${Date.now()}.${extension(url, media)}`;
  }

  function download(url, name) {
    return new Promise((resolve, reject) => {
      try {
        GM_download({
          url, name, saveAs: false,
          onload: resolve,
          onerror: reject,
          ontimeout: () => reject(new Error('download timeout')),
        });
      } catch (error) { reject(error); }
    });
  }

  // Privileged fallback only to the verified Meta/Threads hosts.
  function fallbackDownload(url, name) {
    return new Promise((resolve, reject) => {
      try {
        GM_xmlhttpRequest({
          method: 'GET', url, responseType: 'blob', timeout: 40000,
          onload: r => {
            if (r.status < 200 || r.status >= 300 || !r.response || typeof r.response.size !== 'number') {
              reject(new Error('media request failed')); return;
            }
            const type = r.response.type.toLowerCase();
            if (type && !type.startsWith('video/') && !type.startsWith('image/') && type !== 'application/octet-stream') {
              reject(new Error('unexpected content type')); return;
            }
            const objectUrl = URL.createObjectURL(r.response);
            const anchor = document.createElement('a');
            anchor.href = objectUrl; anchor.download = name;
            document.body.append(anchor); anchor.click(); anchor.remove();
            setTimeout(() => URL.revokeObjectURL(objectUrl), 30000);
            resolve();
          },
          onerror: reject,
          ontimeout: () => reject(new Error('network timeout')),
        });
      } catch (error) { reject(error); }
    });
  }

  async function handleClick(event, media, button) {
    event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation();
    if (button.disabled) return;
    button.disabled = true;
    button.dataset.busy = '1'; button.lastChild.textContent = '下載中…';
    try {
      const direct = currentMediaUrl(media);
      const url = direct || (media.tagName === 'VIDEO' ? embeddedVideoUrl(media) : null);
      if (!url) throw new Error('no direct source');
      const name = nameFor(media, url);
      try { await download(url, name); }
      catch { await fallbackDownload(url, name); }
      button.lastChild.textContent = '已下載';
      button.title = '已送交瀏覽器下載。';
    } catch (error) {
      button.lastChild.textContent = '無法下載';
      button.title = '找不到可用的直接媒體網址，或下載被瀏覽器拒絕。可開啟原貼文再試。';
      console.warn('[Threads Downloader Maintained]', error);
    } finally {
      button.dataset.busy = '0';
      setTimeout(() => {
        if (!button.isConnected) return;
        button.disabled = false;
        button.lastChild.textContent = 'Download';
      }, 2500);
    }
  }

  // The previous version attached buttons only when an individual media parent
  // met strict size constraints. Threads uses varying wrappers, overlays and
  // lazy-loaded media, so a single floating hover button is more reliable.
  GM_addStyle([
    '.tvd-maintained-button.tvd-floating {',
    '  position: fixed !important; opacity: 1 !important;',
    '  visibility: visible !important; transform: none !important;',
    '  pointer-events: auto !important; z-index: 2147483646 !important;',
    '}'
  ].join('\n'));

  const button = document.createElement('button');
  button.type = 'button';
  button.className = MARK + '-button tvd-floating';
  button.setAttribute('aria-label', '下載 Threads 媒體');
  button.title = '下載游標所在的 Threads 圖片或影片';
  button.innerHTML = '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M10 3v10m0 0-4-4m4 4 4-4M4 16h12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg><span>Download</span>';
  button.style.display = 'none';
  document.body.appendChild(button);

  // Beta-only health indicator: distinguishes a non-running script from media
  // detection failure. This does not read user data or make network requests.
  const indicator = document.createElement('div');
  indicator.textContent = 'Threads DL · Beta 2';
  indicator.title = '下載腳本已執行。把滑鼠移至貼文圖片或影片上。';
  indicator.setAttribute('aria-label', 'Threads Downloader 腳本已啟動');
  indicator.style.cssText = [
    'position:fixed', 'right:10px', 'bottom:10px', 'z-index:2147483645',
    'font:11px/1.25 system-ui,sans-serif', 'padding:6px 8px',
    'color:white', 'background:rgba(0,0,0,.72)', 'border-radius:6px',
    'pointer-events:none', 'opacity:.75'
  ].join(';');
  document.body.appendChild(indicator);

  let selectedMedia = null;
  let lastPointer = null;
  let scheduled = false;

  function mediaAtPoint(x, y) {
    let best = null;
    let bestScore = -Infinity;
    for (const media of document.querySelectorAll('video, img')) {
      const rect = media.getBoundingClientRect();
      if (rect.width < 155 || rect.height < 110) continue;
      if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) continue;
      if (media.tagName === 'IMG' &&
          media.closest('a[href*="/avatar"],a[href*="/profile"]')) continue;
      if (media.tagName === 'IMG' && !media.complete && !media.currentSrc) continue;
      // Prefer video when media elements overlap; otherwise the most specific
      // box under the cursor, not the entire surrounding feed container.
      const score = (media.tagName === 'VIDEO' ? 1000000 : 0) -
        Math.min(999999, rect.width * rect.height);
      if (score > bestScore) {
        best = media;
        bestScore = score;
      }
    }
    return best;
  }

  function hideButton() {
    selectedMedia = null;
    button.style.display = 'none';
  }

  function positionButton() {
    if (!selectedMedia || !selectedMedia.isConnected) {
      hideButton();
      return;
    }
    const r = selectedMedia.getBoundingClientRect();
    if (r.width < 155 || r.height < 110 ||
        r.bottom < 0 || r.top > innerHeight ||
        r.right < 0 || r.left > innerWidth) {
      hideButton();
      return;
    }
    const left = Math.max(6, Math.min(innerWidth - 116, r.left + 8));
    const top = Math.max(6, Math.min(innerHeight - 40, r.bottom - 42));
    button.style.left = left + 'px';
    button.style.top = top + 'px';
    button.style.display = 'inline-flex';
  }

  function updateHover() {
    scheduled = false;
    if (!lastPointer || button.disabled) return;
    const media = mediaAtPoint(lastPointer.x, lastPointer.y);
    if (!media) {
      hideButton();
      return;
    }
    selectedMedia = media;
    positionButton();
  }

  function scheduleHover() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(updateHover);
  }

  document.addEventListener('pointermove', (event) => {
    if (event.pointerType === 'touch' || button.contains(event.target)) return;
    lastPointer = { x: event.clientX, y: event.clientY };
    scheduleHover();
  }, { capture: true, passive: true });

  button.addEventListener('pointerenter', () => {
    // Keep the hover button visible while the pointer is over it.
  });
  button.addEventListener('click', (event) => {
    if (!selectedMedia) return;
    handleClick(event, selectedMedia, button);
  }, true);

  window.addEventListener('scroll', () => {
    if (!button.disabled) scheduleHover();
    if (selectedMedia) positionButton();
  }, { passive: true, capture: true });
  window.addEventListener('resize', () => {
    if (selectedMedia) positionButton();
  }, { passive: true });

  // A DOM change is not required to display the button. On a Threads SPA the
  // next pointer movement discovers newly loaded images and videos.
  console.info('[Threads Downloader] v2.0.0-beta.2 active:', location.hostname);
})();
