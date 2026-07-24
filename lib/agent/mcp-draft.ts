import { getWorkspaceMcpTools, invokeMcpTool } from "@/lib/agent/mcp";
import { downloadDriveFileAsBase64 } from "@/lib/drive/download";
import type { DraftAttachment, DraftPreview } from "@/lib/drafts/preview";

export type McpDraftCreateResult = {
  draftId: string;
  raw: string;
};

export function parseMcpDraftId(raw: string): string | null {
  const patterns = [
    /(?:draft[_ ]?id|id)\s*[:=]\s*["']?([a-zA-Z0-9_-]+)/i,
    /draft\s+(?:id\s+)?([a-zA-Z0-9_-]{6,})/i,
    /\b([rR]?[0-9a-fA-F-]{10,})\b/,
  ];

  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (match?.[1] && !/^(error|null|undefined)$/i.test(match[1])) {
      return match[1];
    }
  }

  return null;
}

/** Extract an HTTP(S) attachment URL from get_drive_file_download_url output. */
export function parseDriveDownloadUrl(raw: string): string | null {
  const urlMatch = raw.match(/https?:\/\/[^\s"'<>]+/i);
  if (urlMatch?.[0]) {
    return urlMatch[0].replace(/[),.;]+$/, "");
  }
  return null;
}

/**
 * Stateless MCP may return truncated base64 in text — only use if it looks complete
 * and is not the "first 100 characters shown" preview.
 */
export function parseDriveDownloadBase64(raw: string): string | null {
  if (/first\s+\d+\s+characters\s+shown/i.test(raw)) {
    return null;
  }
  const labeled = raw.match(
    /Base64-encoded content[^:]*:\s*([A-Za-z0-9+/=\s]+)/i
  );
  if (labeled?.[1]) {
    const cleaned = labeled[1].replace(/\s+/g, "");
    if (cleaned.length > 200) return cleaned;
  }
  return null;
}

function defaultExportFormat(attachment: DraftAttachment): string | undefined {
  if (attachment.exportFormat?.trim()) return attachment.exportFormat.trim();
  const mime = (attachment.mimeType ?? "").toLowerCase();
  if (mime.includes("document")) return "pdf";
  if (mime.includes("spreadsheet")) return "xlsx";
  if (mime.includes("presentation")) return "pdf";
  return undefined;
}

type McpAttachmentArg =
  | { url: string; filename: string; mime_type?: string }
  | { content: string; filename: string; mime_type?: string };

async function resolveAttachmentsForMcp(
  accessToken: string,
  tools: Awaited<ReturnType<typeof getWorkspaceMcpTools>>,
  attachments: DraftAttachment[]
): Promise<McpAttachmentArg[]> {
  const resolved: McpAttachmentArg[] = [];

  for (const attachment of attachments) {
    // Prefer direct Drive download — works with WORKSPACE_MCP_STATELESS_MODE
    // where get_drive_file_download_url only returns a truncated base64 preview.
    try {
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
      continue;
    } catch (driveError) {
      // Fall through to MCP download tool (URL mode when not stateless).
      console.warn(
        `[mcp-draft] Direct Drive download failed for ${attachment.name}, trying MCP:`,
        driveError instanceof Error ? driveError.message : driveError
      );
    }

    const args: Record<string, unknown> = {
      file_id: attachment.driveFileId,
    };
    const exportFormat = defaultExportFormat(attachment);
    if (exportFormat) {
      args.export_format = exportFormat;
    }

    const raw = await invokeMcpTool(tools, "get_drive_file_download_url", args);
    if (/error/i.test(raw) && !/url|base64|downloaded/i.test(raw)) {
      throw new Error(
        `Failed to download Drive file "${attachment.name}": ${raw.slice(0, 300)}`
      );
    }

    const url = parseDriveDownloadUrl(raw);
    if (url) {
      resolved.push({
        url,
        filename: attachment.name,
        ...(attachment.mimeType ? { mime_type: attachment.mimeType } : {}),
      });
      continue;
    }

    const content = parseDriveDownloadBase64(raw);
    if (content) {
      resolved.push({
        content,
        filename: attachment.name,
        ...(attachment.mimeType ? { mime_type: attachment.mimeType } : {}),
      });
      continue;
    }

    throw new Error(
      `Could not resolve Drive file "${attachment.name}" (${attachment.driveFileId}) for attach. Stateless MCP returned no URL and only a truncated preview — direct Drive download also failed.`
    );
  }

  return resolved;
}

/**
 * Create a Gmail draft via MCP `draft_gmail_message` (no direct Gmail REST).
 * Resolves Drive attachments via Drive API (base64) or MCP download URL.
 */
export async function createGmailDraftViaMcp(input: {
  accessToken: string;
  /** Connected Gmail — used for auth via Bearer token only (not an MCP arg). */
  gmailEmail: string;
  draft: DraftPreview;
}): Promise<McpDraftCreateResult> {
  if (!input.gmailEmail.trim()) {
    throw new Error("Connected Gmail address is required to create a draft");
  }

  const tools = await getWorkspaceMcpTools(input.accessToken, "inbox");

  // OAuth 2.1: identity comes from the Bearer token — do not pass
  // user_google_email (not in schema; causes "did not match expected schema").
  const args: Record<string, unknown> = {
    to: input.draft.to,
    subject: input.draft.subject,
    body: input.draft.body,
    body_format: "plain",
  };

  if (input.draft.gmailThreadId) {
    args.thread_id = input.draft.gmailThreadId;
  }
  if (input.draft.inReplyTo) {
    args.in_reply_to = input.draft.inReplyTo;
  }
  if (input.draft.references) {
    args.references = input.draft.references;
  }

  if (input.draft.attachments?.length) {
    args.attachments = await resolveAttachmentsForMcp(
      input.accessToken,
      tools,
      input.draft.attachments
    );
  }

  const raw = await invokeMcpTool(tools, "draft_gmail_message", args);

  if (/error/i.test(raw) && !/draft/i.test(raw)) {
    throw new Error(`MCP draft_gmail_message failed: ${raw.slice(0, 400)}`);
  }

  const draftId = parseMcpDraftId(raw);
  if (!draftId) {
    throw new Error(
      `MCP draft_gmail_message did not return a draft id. Response: ${raw.slice(0, 400)}`
    );
  }

  return { draftId, raw };
}
