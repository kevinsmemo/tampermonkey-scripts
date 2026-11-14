# Security and privacy policy

## Public repository safety

This repository is public. Never add personally identifiable information, browser exports, access tokens, cookies, session headers, passwords, private URLs or screenshots containing personal data. Removing a secret in a later commit does not remove it from Git history; revoke compromised credentials immediately.

The `.gitignore` is a convenience, not a security boundary. Review the diff and commit metadata before each publish.

## Userscript permissions

- Run only on specific Threads domains.
- The v5 rebuild uses only `GM_download` after an explicit click and a Threads/Meta HTTPS host allowlist. It does not use `GM_xmlhttpRequest` or `@connect *`; unrestricted `@match`, external `@require`, analytics and telemetry are forbidden.
- Download media only when a user clicks a button, and only from expected HTTPS media hosts.
- Do not explicitly access, collect, log, or transmit login cookies, localStorage, personal messages, or browser history. Browser-managed cookies may still accompany direct requests to expected media hosts.
- Do not create automatic remote requests beyond the browser's normal website activity and Tampermonkey's update checks.

## Release and incident policy

1. Changes are proposed in pull requests and inspected for new network destinations and permissions.
2. Check HTML/DOM compatibility and downloads in Chrome with a non-sensitive test post.
3. Bump `@version` for releases. Merge to `main` only after checking.
4. Keep automatic installation of new versions disabled while still testing.
5. If secrets are accidentally committed, remove access/revoke them first; assume public clones and history retain the leaked value.

## Git author privacy

Configure `https://github.com/settings/emails` → "Keep my email addresses private" and (when applicable) "Block command line pushes that expose my email". Use GitHub's `noreply` address for local Git commits.

## Limitations

Manual code review and scoped permissions reduce risk but cannot guarantee zero vulnerabilities or compatibility after Threads changes.
