/**
 * Resolve Drive attachments to MCP `{ content, filename, mime_type }` via
 * authenticated Drive download. Never forward docs.google.com / Drive export
 * URLs to MCP — those 401 without a Google Bearer.
 */

import { downloadDriveFileAsBase64 } from "@/lib/drive/download";
import {
  normalizeDraftAttachments,
  type DraftAttachment,
} from "@/lib/drafts/preview";

export type McpContentAttachment = {
  content: string;
  filename: string;
  mime_type: string;
};

const MAX_ATTACHMENTS = 3;

/** Google Docs/Sheets/Drive file id from a /d/{id}/ URL (edit, view, export). */
export function extractDriveFileIdFromUrl(url: string): string | null {
  const match = url.match(
    /(?:docs|drive)\.google\.com\/(?:file\/d\/|[^/]+\/d\/)([a-zA-Z0-9_-]+)/i
  );
  return match?.[1] ?? null;
}

function defaultExportFormat(attachment: DraftAttachment): string | undefined {
  if (attachment.exportFormat?.trim()) return attachment.exportFormat.trim();
  const mime = (attachment.mimeType ?? "").toLowerCase();
  if (mime.includes("document")) return "pdf";
  if (mime.includes("spreadsheet")) return "xlsx";
  if (mime.includes("presentation")) return "pdf";
  return undefined;
}

function inferExportFormatFromUrl(url: string): string | undefined {
  const lower = url.toLowerCase();
  if (lower.includes("spreadsheets")) return "xlsx";
  if (lower.includes("presentation")) return "pdf";
  if (lower.includes("/document")) return "pdf";
  return undefined;
}

/**
 * Coerce raw draft_gmail_message / propose_draft attachment args into
 * DraftAttachment[]. Accepts driveFileId/file_id, or a Drive URL in `url`.
 */
export function coerceAttachmentsFromToolArgs(
  value: unknown
): DraftAttachment[] {
  const fromIds = normalizeDraftAttachments(value) ?? [];
  if (!Array.isArray(value)) return fromIds;

  const seen = new Set(fromIds.map((a) => a.driveFileId));
  const out = [...fromIds];

  for (const item of value) {
    if (out.length >= MAX_ATTACHMENTS) break;
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;

    const existingId =
      typeof row.driveFileId === "string"
        ? row.driveFileId.trim()
        : typeof row.file_id === "string"
          ? row.file_id.trim()
          : typeof row.fileId === "string"
            ? row.fileId.trim()
            : "";
    if (existingId) continue;

    const url = typeof row.url === "string" ? row.url.trim() : "";
    if (!url) continue;

    const driveFileId = extractDriveFileIdFromUrl(url);
    if (!driveFileId || seen.has(driveFileId)) continue;

    const name =
      typeof row.filename === "string"
        ? row.filename.trim()
        : typeof row.name === "string"
          ? row.name.trim()
          : "attachment";
    if (!name) continue;

    const attachment: DraftAttachment = { driveFileId, name };
    if (typeof row.mimeType === "string" && row.mimeType.trim()) {
      attachment.mimeType = row.mimeType.trim();
    } else if (typeof row.mime_type === "string" && row.mime_type.trim()) {
      attachment.mimeType = row.mime_type.trim();
    }
    if (typeof row.exportFormat === "string" && row.exportFormat.trim()) {
      attachment.exportFormat = row.exportFormat.trim();
    } else if (
      typeof row.export_format === "string" &&
      row.export_format.trim()
    ) {
      attachment.exportFormat = row.export_format.trim();
    } else {
      const inferred = inferExportFormatFromUrl(url);
      if (inferred) attachment.exportFormat = inferred;
    }

    seen.add(driveFileId);
    out.push(attachment);
  }

  return out.slice(0, MAX_ATTACHMENTS);
}

/**
 * Download each Drive file with Bearer and return MCP content attachments.
 * Rejects non-Drive `{ url }` entries that have no extractable file id.
 */
export async function resolveAttachmentsToMcpContent(
  accessToken: string,
  attachments: DraftAttachment[]
): Promise<McpContentAttachment[]> {
  if (attachments.length === 0) return [];

  const resolved: McpContentAttachment[] = [];

  for (const attachment of attachments.slice(0, MAX_ATTACHMENTS)) {
    const downloaded = await downloadDriveFileAsBase64({
      accessToken,
      fileId: attachment.driveFileId,
      filename: attachment.name,
      mimeType: attachment.mimeType,
      exportFormat: defaultExportFormat(attachment),
    });
    resolved.push({
      content: downloaded.contentBase64,
      filename: downloaded.filename,
      mime_type: downloaded.mimeType,
    });
  }

  return resolved;
}

/**
 * Rewrite draft_gmail_message args so attachments are `{ content, ... }` only.
 * Passes through items that already have base64 `content`. Never forwards
 * Drive/docs.google.com URLs to MCP (those 401 without Google Bearer).
 */
export async function rewriteDraftAttachmentsArgs(
  accessToken: string,
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  if (!Array.isArray(args.attachments) || args.attachments.length === 0) {
    return args;
  }

  const rawItems = args.attachments as unknown[];
  const alreadyContent: McpContentAttachment[] = [];
  const needsResolve: unknown[] = [];

  for (const item of rawItems) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const content =
      typeof row.content === "string" ? row.content.trim() : "";
    const filename =
      typeof row.filename === "string"
        ? row.filename.trim()
        : typeof row.name === "string"
          ? row.name.trim()
          : "";
    if (content.length > 200 && filename) {
      const mime =
        typeof row.mime_type === "string" && row.mime_type.trim()
          ? row.mime_type.trim()
          : typeof row.mimeType === "string" && row.mimeType.trim()
            ? row.mimeType.trim()
            : "application/octet-stream";
      alreadyContent.push({ content, filename, mime_type: mime });
      continue;
    }
    needsResolve.push(item);
  }

  const coerced = coerceAttachmentsFromToolArgs(needsResolve);

  // Non-Drive URLs with no file id — fail clearly instead of MCP 401.
  if (needsResolve.length > 0 && coerced.length === 0 && alreadyContent.length === 0) {
    const urls = needsResolve
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const url = (item as Record<string, unknown>).url;
        return typeof url === "string" ? url : null;
      })
      .filter(Boolean);
    throw new Error(
      `Cannot attach: no Drive file id found. Do not pass Drive/docs.google.com URLs — use attachments: [{ driveFileId, name, exportFormat? }]. Got: ${urls.slice(0, 2).join(", ") || "invalid attachments"}`
    );
  }

  // Some items were URL-only without extractable ids while others resolved.
  if (needsResolve.length > coerced.length) {
    const unresolved = needsResolve.filter((item) => {
      if (!item || typeof item !== "object") return true;
      const row = item as Record<string, unknown>;
      const id =
        typeof row.driveFileId === "string"
          ? row.driveFileId
          : typeof row.file_id === "string"
            ? row.file_id
            : typeof row.fileId === "string"
              ? row.fileId
              : "";
      if (id.trim()) return false;
      const url = typeof row.url === "string" ? row.url.trim() : "";
      return !url || !extractDriveFileIdFromUrl(url);
    });
    if (unresolved.length > 0) {
      throw new Error(
        `Cannot attach non-Drive URL(s). Use driveFileId from search_drive_files, not a public HTTP URL.`
      );
    }
  }

  const downloaded = await resolveAttachmentsToMcpContent(
    accessToken,
    coerced
  );

  const attachments = [...alreadyContent, ...downloaded].slice(
    0,
    MAX_ATTACHMENTS
  );

  return { ...args, attachments };
}
