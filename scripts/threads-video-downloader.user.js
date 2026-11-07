// ==UserScript==
// @name         Threads Video Downloader (Privacy-Focused Fork)
// @namespace    https://github.com/kevinsmemo/tampermonkey-scripts
// @version      0.1.0
// @description  TEST BUILD: Manual Threads media download; no analytics or external services. Auto updates disabled until release.
// @author       Manolo Zocco (original); kevinsmemo (fork maintenance)
// @homepageURL  https://github.com/kevinsmemo/tampermonkey-scripts
// @match        https://threads.net/*
// @match        https://*.threads.net/*
// @match        https://threads.com/*
// @match        https://*.threads.com/*
// @grant        GM_addStyle
// @grant        GM_download
// @noframes
// @run-at       document-idle
// @updateURL    none
// @downloadURL  none
// @license      MIT
// ==/UserScript==

// Original concept and download-button UX: Manolo Zocco / P0L1T3 (MIT).
// Privacy-focused adaptation: no GM_xmlhttpRequest, @connect *, telemetry,
// external libraries, automatic downloads, cookie or localStorage access.

(function () {
  'use strict';

  const ALLOWED_HOST_SUFFIXES = [
    'threads.net',
    'threads.com',
    'fbcdn.net',
    'cdninstagram.com'
  ];
  let downloadCounter = 0;
  let scanScheduled = false;

  GM_addStyle([
    '.tm-threads-media-target { position: relative; }',
    '.tm-threads-download-btn {',
    '  position: absolute; left: 8px; bottom: 8px; z-index: 1000;',
    '  display: inline-flex; align-items: center; gap: 6px;',
    '  color: #fff; background: rgba(0, 0, 0, .76);',
    '  border: 1px solid rgba(255, 255, 255, .25); border-radius: 8px;',
    '  padding: 7px 11px; font: 600 12px/1.3 system-ui, sans-serif;',
    '  cursor: pointer; opacity: 0; pointer-events: none;',
    '  transition: opacity .12s ease;',
    '}',
    '.tm-threads-media-target:hover > .tm-threads-download-btn,',
    '.tm-threads-download-btn:focus-visible { opacity: 1; pointer-events: auto; }',
    '.tm-threads-download-btn:hover { background: rgba(0, 0, 0, .9); }'
  ].join('\n'));

  function toAllowedMediaURL(raw) {
    if (!raw) return null;
    try {
      const parsed = new URL(raw, location.href);
      if (parsed.protocol !== 'https:') return null;
      const hostname = parsed.hostname.toLowerCase();
      const permitted = ALLOWED_HOST_SUFFIXES.some(function (suffix) {
        return hostname === suffix || hostname.endsWith('.' + suffix);
      });
      return permitted ? parsed.href : null;
    } catch (_) {
      return null;
    }
  }

  function getMediaURL(media) {
    let raw;
    if (media.tagName === 'VIDEO') {
      raw = media.currentSrc || media.src;
      if (!raw) {
        const source = media.querySelector('source[src]');
        raw = source && source.src;
      }
    } else {
      raw = media.currentSrc || media.src;
    }
    return toAllowedMediaURL(raw);
  }

  function filenameFor(url, kind) {
    const pathname = new URL(url).pathname.toLowerCase();
    const imageExtension = pathname.match(/\.(jpg|jpeg|png|gif|webp|avif)$/);
    const extension = kind === 'video' ? 'mp4' :
      (imageExtension ? imageExtension[1] : 'jpg');
    const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
    downloadCounter += 1;
    return 'threads-' + kind + '-' + stamp + '-' + downloadCounter + '.' + extension;
  }

  function downloadMedia(media) {
    const url = getMediaURL(media);
    if (!url) {
      console.warn('[Threads Downloader] Unsupported or unavailable HTTPS media URL.');
      return;
    }
    const kind = media.tagName === 'VIDEO' ? 'video' : 'image';
    try {
      GM_download({
        url: url,
        name: filenameFor(url, kind),
        saveAs: false,
        onerror: function (error) {
          console.warn('[Threads Downloader] Download failed:', error);
        }
      });
    } catch (error) {
      console.warn('[Threads Downloader] Download could not start:', error);
    }
  }

  function attachButton(media) {
    const kind = media.tagName === 'VIDEO' ? 'video' : 'image';
    if (kind === 'image') {
      if (media.naturalWidth < 280 || media.naturalHeight < 220) {
        if (!media.complete && !media.dataset.tmThreadsLoadHooked) {
          media.dataset.tmThreadsLoadHooked = '1';
          media.addEventListener('load', scheduleScan, { once: true });
        }
        return;
      }
    }

    if (!getMediaURL(media)) return;

    const container = media.parentElement;
    if (!container || container.querySelector(':scope > .tm-threads-download-btn')) {
      return;
    }

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tm-threads-download-btn';
    button.textContent = '↓ Download';
    button.setAttribute('aria-label', kind === 'video' ? 'Download Threads video' : 'Download Threads image');
    button.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      downloadMedia(media);
    });

    container.classList.add('tm-threads-media-target');
    container.appendChild(button);
  }

  function scanMedia() {
    scanScheduled = false;
    document.querySelectorAll('video, img').forEach(attachButton);
  }

  function scheduleScan() {
    if (scanScheduled) return;
    scanScheduled = true;
    requestAnimationFrame(scanMedia);
  }

  if (document.body) {
    new MutationObserver(scheduleScan).observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src', 'srcset']
    });
    scheduleScan();
  }
})();
