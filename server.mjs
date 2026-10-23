#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";
import { open } from "node:fs/promises";
import { basename, extname } from "node:path";
const token = process.env.JUMPREADY_API_TOKEN;
let url;
try {
  url = new URL(
    process.env.JUMPREADY_API_URL || "https://jumpready.vercel.app",
  );
} catch {
  process.stderr.write("API URL 형식을 확인하세요.\n");
  process.exit(1);
}
if (
  !token ||
  !/^jrk_[A-Za-z0-9_-]{43}$/.test(token) ||
  url.username ||
  url.password ||
  url.search ||
  url.hash ||
  url.pathname !== "/" ||
  !(
    url.protocol === "https:" ||
    (url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
  )
) {
  process.stderr.write(
    "JUMPREADY_API_TOKEN과 HTTPS JUMPREADY_API_URL을 확인하세요.\n",
  );
  process.exit(1);
}
async function api(path, options = {}) {
  const target = new URL("/api/v1" + path, url);
  if (target.origin !== url.origin) throw new Error("invalid_path");
  const response = await fetch(target, {
    ...options,
    redirect: "error",
    headers: { Authorization: `Bearer ${token}`, ...options.headers },
  });
  if (response.status === 204) return { data: null };
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error?.code || "api_error");
  return data;
}
function result(data, isError = false) {
  return {
    content: [{ type: "text", text: JSON.stringify(data) }],
    structuredContent: data,
    ...(isError ? { isError: true } : {}),
  };
}
try {
  const manifest = await api("/tools");
  const tools = manifest.tools;
  const byName = new Map(tools.map((t) => [t.name, t]));
  const upload =
    byName.has("create_document_upload_url") &&
    byName.has("attach_document_file");
  const fileTool = {
    name: "upload_document_file_from_path",
    description:
      "허용한 로컬 파일을 10MiB까지 업로드하고 서류에 첨부합니다. 파일 전체 경로를 확인한 뒤 호출하세요.",
    inputSchema: {
      type: "object",
      properties: {
        cid: { type: "string", format: "uuid" },
        doc: { type: "string" },
        file_path: { type: "string", minLength: 1 },
      },
      required: ["cid", "doc", "file_path"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
    },
  };
  async function call(tool, input) {
    const parsed = z.fromJSONSchema(tool.inputSchema).parse(input);
    let path = tool.http.pathTemplate.replace(/\{(\w+)\}/g, (_, key) =>
      encodeURIComponent(String(parsed[key])),
    );
    if (!path.startsWith("/") || path.startsWith("//"))
      throw new Error("invalid_path");
    const query = new URLSearchParams();
    for (const key of tool.http.queryFields)
      if (parsed[key] !== undefined) query.set(key, String(parsed[key]));
    if (query.size) path += "?" + query;
    const options = { method: tool.http.method };
    if (tool.http.binary) {
      const encoded = parsed.content_base64;
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.length % 4 !== 0)
        throw new Error("invalid_request");
      const bytes = Buffer.from(encoded, "base64");
      if (bytes.length > 3_000_000) throw new Error("payload_too_large");
      options.headers = {
        "Content-Type": parsed.mime,
        "X-File-Name": `filename*=UTF-8''${encodeURIComponent(parsed.file_name)}`,
      };
      options.body = bytes;
    } else if (tool.http.method !== "GET" && tool.http.bodyFields.length) {
      options.headers = { "Content-Type": "application/json" };
      options.body = JSON.stringify(
        Object.fromEntries(
          tool.http.bodyFields
            .filter((k) => parsed[k] !== undefined)
            .map((k) => [k, parsed[k]]),
        ),
      );
    }
    return api(path, options);
  }
  async function fromPath(input) {
    const parsed = z.fromJSONSchema(fileTool.inputSchema).parse(input);
    const kinds = {
      ".pdf": "application/pdf",
      ".hwp": "application/x-hwp",
      ".hwpx": "application/hwp+zip",
      ".docx":
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ".xlsx":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ".webp": "image/webp",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
    };
    const mime = kinds[extname(parsed.file_path).toLowerCase()];
    if (!mime) throw new Error("unsupported_media_type");
    const handle = await open(parsed.file_path, "r");
    let bytes;
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > 10 * 1024 * 1024)
        throw new Error("payload_too_large");
      const chunks = [];
      let size = 0;
      while (true) {
        const chunk = Buffer.alloc(65536);
        const { bytesRead } = await handle.read(chunk);
        if (!bytesRead) break;
        size += bytesRead;
        if (size > 10 * 1024 * 1024) throw new Error("payload_too_large");
        chunks.push(chunk.subarray(0, bytesRead));
      }
      bytes = Buffer.concat(chunks);
    } finally {
      await handle.close();
    }
    const metadata = {
      cid: parsed.cid,
      doc: parsed.doc,
      file_name: basename(parsed.file_path),
      mime,
      size: bytes.length,
    };
    const signed = await call(
      byName.get("create_document_upload_url"),
      metadata,
    );
    // The signed storage request never receives the JumpReady API token.
    const response = await fetch(signed.data.upload_url, {
      method: "PUT",
      redirect: "error",
      headers: { "Content-Type": mime },
      body: bytes,
    });
    if (!response.ok) throw new Error("upload_failed");
    return call(byName.get("attach_document_file"), {
      ...metadata,
      path: signed.data.path,
    });
  }
  serveStdio(
    () => {
      const server = new Server(
        { name: "jumpready-local", version: "1.0.0" },
        { capabilities: { tools: {} } },
      );
      server.setRequestHandler("tools/list", async () => ({
        tools: [...tools, ...(upload ? [fileTool] : [])],
      }));
      server.setRequestHandler("tools/call", async (input) => {
        try {
          if (upload && input.params.name === fileTool.name)
            return result(await fromPath(input.params.arguments || {}));
          const tool = byName.get(input.params.name);
          if (!tool)
            return result(
              {
                error: {
                  code: "insufficient_scope",
                  message: "이 토큰으로 호출할 수 없는 도구예요.",
                },
              },
              true,
            );
          return result(await call(tool, input.params.arguments || {}));
        } catch (error) {
          const code =
            error instanceof z.ZodError
              ? "validation_failed"
              : [
                    "invalid_request",
                    "payload_too_large",
                    "unsupported_media_type",
                    "insufficient_scope",
                    "forbidden",
                    "not_found",
                    "token_revoked",
                    "token_expired",
                    "rate_limited",
                  ].includes(error?.message)
                ? error.message
                : "internal";
          return result(
            {
              error: {
                code,
                message:
                  "요청을 처리하지 못했어요. 입력과 토큰 권한을 확인하세요.",
              },
            },
            true,
          );
        }
      });
      return server;
    },
    { onerror: () => process.stderr.write("MCP 연결 오류가 발생했어요.\n") },
  );
} catch {
  process.stderr.write(
    "API 연결에 실패했어요. URL과 토큰 권한을 확인하세요.\n",
  );
  process.exit(1);
}
