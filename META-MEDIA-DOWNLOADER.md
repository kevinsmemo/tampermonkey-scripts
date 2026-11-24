# Meta Media Downloader 6.1.0

Single userscript for Threads and Instagram. Built on the previously verified Threads 5.2.0 source (Git blob 99853fec54cef076c3a182958c848d5afc17d2f0). The original file and its branch are unchanged. The site dispatcher activates just one platform module.

## Installation
Install scripts/meta-media-downloader.user.js. Disable the older Threads downloader, IG Helper and Instagram Download Button before testing to avoid duplicate controls. Keep them installed for rollback. Auto-update remains disabled.

## Instagram features in this release
- Download all identifiable attachments of one post, including mixed carousels and Reels; select the highest-resolution exposed variant.
- Upper-right media overlay: download arrow saves the current visible attachment; cloud download saves the entire post. The overlay uses IG Helper-style dimensions (26px controls, 18px glyphs) and translucent dark background.
- Alt+I opens the currently identified original media; the standalone Open button was removed.
- Current story and highlight, and profile image, when a uniquely identifiable source is exposed. Not bulk story archiving.
- Alt+K downloads all post attachments; Alt+Shift+K downloads the current attachment; Alt+I opens current media. Shortcuts operate only on an unambiguous control group. Stories, highlights and profile images have only the current-media button.
- Sequential file saving with per-post filename, partial failure indications.
- Direct post/reel route, and feed articles with unambiguous identity. Unidentified items on the continuous Reels feed are deliberately skipped.
- No implementation of all IG Helper extras (video controls, settings, tagging, locale packages, caching, audio/video stream remux, etc.). Direct MP4 only.

## Security
Only GM_download is granted. Same-origin Instagram reads are triggered by explicit actions; no credential export, third-party downloader, remote libraries, analytics, or auto-like. Downloads are restricted to recognized Meta media CDN hosts. Existing Threads button CSS, post scope, Copy as image handlers, and download routines remain unchanged.

## Source and attribution
Threads implementation retains its original MIT attribution. Reviewed user-exported IG Helper 5.4.6 (GPL-3.0-only) and Instagram Download Button 1.17.18 (MIT) for feature coverage and data-format compatibility. The Instagram adapter is independently implemented; neither IG script nor its bundled dependencies is included.

## Verification
6.0.0: 14 synthetic parser/security/core-comparison checks and two-host startup smoke checks passed. 6.1.0: 13 current-slide, media matching, ambiguity, UI dimension and Threads core comparison tests passed. Source is valid JavaScript. These are not live browser end-to-end tests. Check native single/mixed posts, Reels, stories, highlights, avatars, and Threads Copy as image before treating the integration as a full replacement.
