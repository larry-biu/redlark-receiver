# RedLark Receiver

This folder contains the Obsidian-side companion for RedLark Clipper. The public
plugin identity is `redlark-receiver`, the display author is `larryssss`, and it
is an independent product rather than an official Obsidian extension.

- It listens on `127.0.0.1:27124` only while Obsidian is running and adds no
  ribbon icon or standalone background service.
- It accepts the expected Chrome extension identity, writes the note/assets, and
  returns `complete`, `partial`, or `failed` only after Vault readback.
- Note and comment images use Obsidian's own default attachment location through
  `FileManager.getAvailablePathForAttachment()`.
- Xiaohongshu and Feishu/Lark note folders are configured in RedLark Clipper,
  not in this Receiver.
- New Xiaohongshu captures use a responsive editorial reading layout with a
  source card, post body, image gallery, engagement summary, and comment thread.
- The browser collector attempts up to 150 main comments and preserves loaded
  replies and comment images.
- The Receiver has no ribbon icon, manual import command, clipboard watcher, or
  business settings page. The current workflow handles exactly one active page
  per click and does not perform batch import.

## Chrome dependency

Xiaohongshu and Feishu/Lark enhanced capture requires both components:

1. Install `RedLark Clipper` in Chrome.
2. Install and enable `RedLark Receiver` from Obsidian Community Plugins.
3. Keep Obsidian open while clipping so the local receiver on
   `127.0.0.1:27124` is available.

Ordinary Chrome clipping can continue without the Receiver, but enhanced local
image and comment saving cannot.

For release maintenance and Community Plugins submission, see
[`PUBLISHING.md`](./PUBLISHING.md).

## Attribution and license

RedLark Receiver is MIT-licensed. Portions of the Vault path and attachment
handling were adapted from `xhs-importer` 1.0.3 by `lxl448080113`, also under
the MIT License. See `THIRD_PARTY_NOTICES.md`. The product purpose and user flow
are different: this plugin is a local receiver for a paired Chrome extension and
does not provide the original plugin's standalone Xiaohongshu importer UI.
