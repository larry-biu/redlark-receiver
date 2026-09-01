/*
 * RedLark Receiver
 * Copyright (c) 2026 larryssss
 * Portions adapted from xhs-importer, Copyright (c) 2026 lxl448080113.
 * Licensed under the MIT License. See LICENSE and THIRD_PARTY_NOTICES.md.
 */

const { Notice, Plugin, normalizePath, requestUrl } = require("obsidian");

const PROTOCOL = "obsidian-unified-clipper/v1";
const HOST = "127.0.0.1";
const PORT = 27124;
const MAX_REQUEST_BYTES = 128 * 1024 * 1024;
const MAX_MARKDOWN_CHARS = 8 * 1024 * 1024;
const MAX_ASSETS = 600;
const ALLOWED_EXTENSION_IDS = new Set([
  "mllonkpdipgiffaikeccjebakjojgiij",
  "cnjifjpddelmedmihgijeibhnjfabmlf",
]);

function splitVaultPath(vaultPath) {
  return String(vaultPath || "").split("/").filter(Boolean);
}

function vaultDirname(vaultPath) {
  const parts = splitVaultPath(vaultPath);
  return parts.length > 1 ? parts.slice(0, -1).join("/") : "";
}

function vaultBasename(vaultPath) {
  const parts = splitVaultPath(vaultPath);
  return parts.length ? parts[parts.length - 1] : "";
}

function relativeVaultPath(fromDirectory, toPath) {
  const fromParts = splitVaultPath(fromDirectory);
  const toParts = splitVaultPath(toPath);
  let shared = 0;
  while (shared < fromParts.length && shared < toParts.length && fromParts[shared] === toParts[shared]) {
    shared += 1;
  }
  const segments = [
    ...new Array(fromParts.length - shared).fill(".."),
    ...toParts.slice(shared),
  ];
  return segments.length ? segments.join("/") : vaultBasename(toPath);
}

function normalizeNoteFolder(value) {
  const raw = String(value || "").trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!raw) return "";
  const parts = raw.split("/").filter(Boolean);
  if (parts.some((part) => part === "." || part === "..")) {
    throw new Error("笔记目录不能包含 . 或 .. 路径段");
  }
  return normalizePath(parts.join("/"));
}

function sanitizeFilename(value) {
  const safe = String(value || "Untitled")
    .replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return safe || "Untitled";
}

function decodeDataUrl(dataUrl) {
  const match = String(dataUrl || "").match(
    /^data:([^;,]+)?(?:;charset=[^;,]+)?;base64,([a-zA-Z0-9+/=\s]+)$/,
  );
  if (!match) throw new Error("附件内嵌数据格式不受支持");
  const bytes = Buffer.from(match[2].replace(/\s/g, ""), "base64");
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function replaceAssetMarker(markdown, assetId, replacement) {
  const escapedId = String(assetId || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const marker = new RegExp(`asset://${escapedId}(?=[)\\s"'<>]|$)`, "g");
  return String(markdown || "").replace(marker, () => replacement);
}

function validateEnvelope(value) {
  if (!value || value.protocol !== PROTOCOL) throw new Error("不支持的 RedLark 数据协议");
  if (typeof value.nonce !== "string" || value.nonce.length < 8 || value.nonce.length > 200) {
    throw new Error("导入请求缺少有效标识");
  }
  if (!Array.isArray(value.payloads) || value.payloads.length !== 1) {
    throw new Error("RedLark Receiver 每次只接收当前页面的一篇内容");
  }
  return value;
}

class RedLarkReceiverPlugin extends Plugin {
  async onload() {
    this.resultCache = new Map();
    this.register(() => this.stopReceiver());
    this.registerMarkdownPostProcessor((element, context) => {
      const preview = element.closest(".markdown-preview-view");
      if (!preview) return;
      const frontmatter = this.app.metadataCache.getCache(context.sourcePath)?.frontmatter || {};
      const cssClasses = Array.isArray(frontmatter.cssclasses)
        ? frontmatter.cssclasses
        : String(frontmatter.cssclasses || "").split(/[,\s]+/).filter(Boolean);
      const isXhsNote = frontmatter.source_app === "xiaohongshu" || cssClasses.includes("xhs-note");
      preview.classList.toggle("xhs-note", isXhsNote);
      if (!isXhsNote) return;
      requestAnimationFrame(() => {
        preview.querySelectorAll("ol").forEach((list) => list.classList.add("xhs-comment-list"));
        preview.querySelectorAll('img[alt^="评论图片"], img[alt^="回复图片"]')
          .forEach((image) => image.classList.add("xhs-comment-image"));
      });
    });

    try {
      await this.startReceiver();
    } catch (error) {
      console.error("RedLark Receiver failed to start", error);
      new Notice(`RedLark Receiver 启动失败：${this.errorMessage(error)}`, 8000);
    }
  }

  onunload() {
    this.stopReceiver();
  }

  errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
  }

  allowedOrigins() {
    return new Set([...ALLOWED_EXTENSION_IDS].map((id) => `chrome-extension://${id}`));
  }

  isAllowedRequest(request) {
    const origin = String(request.headers.origin || "");
    if (origin) return this.allowedOrigins().has(origin);
    return ALLOWED_EXTENSION_IDS.has(String(request.headers["x-redlark-extension-id"] || "").trim());
  }

  setCorsHeaders(response, origin) {
    if (origin && this.allowedOrigins().has(origin)) response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type, X-RedLark-Extension-Id");
    response.setHeader("Access-Control-Allow-Private-Network", "true");
    response.setHeader("Vary", "Origin");
  }

  sendJson(response, statusCode, body, origin = "") {
    this.setCorsHeaders(response, origin);
    response.statusCode = statusCode;
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.end(JSON.stringify(body));
  }

  async readRequestBody(request) {
    const chunks = [];
    let totalBytes = 0;
    for await (const chunk of request) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += buffer.length;
      if (totalBytes > MAX_REQUEST_BYTES) throw new Error("导入内容超过 128 MB 限制");
      chunks.push(buffer);
    }
    return Buffer.concat(chunks).toString("utf8");
  }

  async handleRequest(request, response) {
    const origin = String(request.headers.origin || "");
    if (request.method === "OPTIONS") {
      if (!this.isAllowedRequest(request)) {
        this.sendJson(response, 403, { ok: false, error: "不允许的浏览器扩展来源" }, origin);
        return;
      }
      this.setCorsHeaders(response, origin);
      response.statusCode = 204;
      response.end();
      return;
    }
    if (!this.isAllowedRequest(request)) {
      this.sendJson(response, 403, { ok: false, error: "不允许的浏览器扩展来源" }, origin);
      return;
    }

    const requestUrl = new URL(request.url || "/", `http://${HOST}:${PORT}`);
    if (request.method === "GET" && requestUrl.pathname === "/health") {
      this.sendJson(response, 200, {
        ok: true,
        protocol: PROTOCOL,
        receiver: "redlark-receiver",
        version: this.manifest.version,
      }, origin);
      return;
    }
    if (request.method !== "POST" || requestUrl.pathname !== "/import") {
      this.sendJson(response, 404, { ok: false, error: "未找到本机接收接口" }, origin);
      return;
    }

    try {
      const envelope = validateEnvelope(JSON.parse(await this.readRequestBody(request)));
      const cached = this.resultCache.get(envelope.nonce);
      const results = cached || [await this.importPayload(envelope.payloads[0])];
      if (!cached) {
        this.resultCache.set(envelope.nonce, results);
        if (this.resultCache.size > 30) this.resultCache.delete(this.resultCache.keys().next().value);
      }
      this.sendJson(response, 200, { ok: true, results }, origin);
    } catch (error) {
      console.error("RedLark local import failed", error);
      this.sendJson(response, 400, { ok: false, error: this.errorMessage(error) }, origin);
    }
  }

  async startReceiver() {
    if (this.server) return;
    const http = require("http");
    const server = http.createServer((request, response) => {
      this.handleRequest(request, response).catch((error) => {
        console.error("RedLark request failed", error);
        if (!response.headersSent) {
          this.sendJson(response, 500, { ok: false, error: this.errorMessage(error) }, String(request.headers.origin || ""));
        } else {
          response.end();
        }
      });
    });
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(PORT, HOST, () => {
        server.off("error", reject);
        resolve();
      });
    });
    this.server = server;
    console.info(`RedLark Receiver listening on http://${HOST}:${PORT}`);
  }

  stopReceiver() {
    if (!this.server) return;
    this.server.close();
    this.server = null;
  }

  async ensureFolder(folderPath) {
    const normalized = normalizeNoteFolder(folderPath);
    if (!normalized || await this.app.vault.adapter.exists(normalized)) return;
    let current = "";
    for (const part of normalized.split("/")) {
      current = current ? `${current}/${part}` : part;
      if (!(await this.app.vault.adapter.exists(current))) await this.app.vault.createFolder(current);
    }
  }

  async uniqueNotePath(folderPath, noteName) {
    const folder = normalizeNoteFolder(folderPath);
    const base = sanitizeFilename(noteName);
    let counter = 0;
    while (true) {
      const suffix = counter ? `-${counter}` : "";
      const path = normalizePath(`${folder ? `${folder}/` : ""}${base}${suffix}.md`);
      if (!(await this.app.vault.adapter.exists(path))) return path;
      counter += 1;
    }
  }

  async attachmentPath(filename, notePath) {
    if (!this.app.fileManager?.getAvailablePathForAttachment) {
      throw new Error("当前 Obsidian 版本不支持默认附件位置接口");
    }
    const path = normalizePath(
      await this.app.fileManager.getAvailablePathForAttachment(sanitizeFilename(filename || "attachment.bin"), notePath),
    );
    await this.ensureFolder(vaultDirname(path));
    return path;
  }

  async readAsset(asset) {
    if (asset?.dataUrl) return decodeDataUrl(asset.dataUrl);
    if (asset?.base64) {
      const bytes = Buffer.from(String(asset.base64), "base64");
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    }
    if (asset?.url) {
      const response = await requestUrl({ url: asset.url, headers: asset.headers || {} });
      return response.arrayBuffer;
    }
    throw new Error("附件缺少内嵌数据或下载地址");
  }

  async readAssetWithRetry(asset) {
    let lastError;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        return await this.readAsset(asset);
      } catch (error) {
        lastError = error;
        if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 250));
      }
    }
    throw lastError || new Error("附件下载失败");
  }

  validatePayload(payload) {
    if (!payload || !["xiaohongshu", "feishu"].includes(payload.source)) throw new Error("不支持的采集来源");
    if (typeof payload.markdown !== "string" || !payload.noteName) throw new Error("采集结果缺少笔记正文或标题");
    if (payload.markdown.length > MAX_MARKDOWN_CHARS) throw new Error("Markdown 内容超过 8 MB 限制");
    const assets = Array.isArray(payload.assets) ? payload.assets : [];
    if (assets.length > MAX_ASSETS) throw new Error(`附件数量超过 ${MAX_ASSETS} 个限制`);
    const ids = new Set();
    for (const asset of assets) {
      const id = String(asset?.id || "");
      if (!id || ids.has(id)) throw new Error("附件标识缺失或重复");
      ids.add(id);
    }
    return assets;
  }

  async importPayload(payload) {
    const assets = this.validatePayload(payload);
    const noteFolder = normalizeNoteFolder(payload.noteFolder);
    await this.ensureFolder(noteFolder);
    const notePath = await this.uniqueNotePath(noteFolder, payload.noteName);
    let markdown = payload.markdown;
    const writtenAssets = [];
    const failedAssets = [];

    for (const asset of assets) {
      try {
        const bytes = await this.readAssetWithRetry(asset);
        const path = await this.attachmentPath(asset.filename, notePath);
        await this.app.vault.createBinary(path, bytes);
        const created = this.app.vault.getAbstractFileByPath(path);
        if (!created) throw new Error(`附件写入后不存在：${path}`);
        const readback = await this.app.vault.readBinary(created);
        if (readback.byteLength !== bytes.byteLength) throw new Error(`附件回读大小不一致：${path}`);
        const relativePath = relativeVaultPath(vaultDirname(notePath), path);
        markdown = replaceAssetMarker(markdown, asset.id, encodeURI(relativePath).replace(/#/g, "%23"));
        writtenAssets.push({ id: asset.id, path, bytes: readback.byteLength });
      } catch (error) {
        const fallback = asset.fallbackUrl || asset.url || "";
        markdown = replaceAssetMarker(markdown, asset.id, fallback);
        failedAssets.push({ id: asset.id, ...(fallback ? { url: fallback } : {}), error: this.errorMessage(error) });
      }
    }

    const createdFile = await this.app.vault.create(notePath, markdown);
    const readback = await this.app.vault.read(createdFile);
    if (readback !== markdown) throw new Error(`笔记写入后回读不一致：${notePath}`);
    if (/asset:\/\//.test(readback)) throw new Error(`笔记仍包含未解析附件标记：${notePath}`);

    const status = failedAssets.length ? "partial" : "complete";
    new Notice(
      status === "complete" ? `RedLark 已保存：${notePath}` : `RedLark 已保存正文，但有 ${failedAssets.length} 个附件未能本地化`,
      status === "complete" ? 5000 : 8000,
    );
    return { ok: status === "complete", status, notePath, writtenAssets, failedAssets };
  }
}

module.exports = RedLarkReceiverPlugin;
