# Publishing RedLark Receiver

## First Community Plugins submission

1. Sign in at [community.obsidian.md](https://community.obsidian.md) with an
   Obsidian account.
2. Connect the GitHub account that owns `larry-biu/redlark-receiver`.
3. Add the repository as a plugin. The directory reads `manifest.json` from the
   default branch, so commit it before submitting.
4. Confirm the manifest version exactly matches a public GitHub Release tag.
   The tag is `1.4.0`, not `v1.4.0`.
5. Confirm that the Release contains `main.js`, `manifest.json`, and
   `styles.css` as separate downloadable assets.
6. Submit and address the automated and human review feedback. If code changes,
   increment the version and create a new matching release.

## Review disclosure

RedLark Receiver listens only on `127.0.0.1:27124`, has no telemetry, reads no
clipboard content, and accepts one current-page payload from the paired Chrome
extension. It writes only to the current Vault. Images use Obsidian's default
attachment location; network access is used only to retry an image URL included
in the user-requested capture.

Some Vault path and attachment handling is adapted from `xhs-importer` 1.0.3 by
`lxl448080113` under MIT. Attribution is in the README, LICENSE, source header,
and `THIRD_PARTY_NOTICES.md`. The product purpose differs from the upstream
standalone importer. If Obsidian reviewers nevertheless classify it as a fork,
obtain publicly verifiable approval from the upstream author before proceeding.

## Future releases

Update `manifest.json` and `versions.json`, commit to `main`, then push a tag
that exactly matches the manifest version. The repository workflow validates
the files and creates the GitHub Release with the three required assets.
