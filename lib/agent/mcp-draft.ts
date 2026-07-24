import { getWorkspaceMcpTools, invokeMcpTool } from "@/lib/agent/mcp";
import type { DraftPreview } from "@/lib/drafts/preview";

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

/**
 * Create a Gmail draft via MCP `draft_gmail_message` (no direct Gmail REST).
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
