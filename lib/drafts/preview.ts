export type DraftAttachment = {
  driveFileId: string;
  name: string;
  mimeType?: string;
  /** For Google Docs/Sheets/Slides export at download time (e.g. pdf, xlsx). */
  exportFormat?: string;
};

export type DraftPreview = {
  to: string;
  subject: string;
  body: string;
  attachments?: DraftAttachment[];
  gmailThreadId?: string;
  inReplyTo?: string;
  references?: string;
};

export type DraftStatus = "pending" | "accepted" | "revised";

export type ChatDraftMetadata = {
  draft: DraftPreview;
  draftStatus: DraftStatus;
  gmailDraftId?: string | null;
};

/** What to do with the next user message while a draft is pending review. */
export type PendingDraftIntent = "accept" | "revise" | "other";

const MAX_DRAFT_ATTACHMENTS = 3;

/**
 * Keep only real Drive file ids from tool results — drop empty/fake entries.
 */
export function normalizeDraftAttachments(
  value: unknown
): DraftAttachment[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const out: DraftAttachment[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const driveFileId =
      typeof row.driveFileId === "string"
        ? row.driveFileId.trim()
        : typeof row.file_id === "string"
          ? row.file_id.trim()
          : typeof row.fileId === "string"
            ? row.fileId.trim()
            : "";
    const name =
      typeof row.name === "string"
        ? row.name.trim()
        : typeof row.filename === "string"
          ? row.filename.trim()
          : "";
    if (!driveFileId || !name) continue;

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
    }
    out.push(attachment);
    if (out.length >= MAX_DRAFT_ATTACHMENTS) break;
  }

  return out.length > 0 ? out : undefined;
}

export function buildDraftReviewReply(options?: { afterFeedback?: boolean }) {
  if (options?.afterFeedback) {
    return "Got it — I'll keep this in mind. Here's the updated draft. Thumbs up to save to Gmail, thumbs down for more feedback, or just reply in chat.";
  }
  return "Here's your draft — thumbs up to save to Gmail, thumbs down to give feedback, or just reply in chat.";
}

export function formatDraftPreviewBlock(preview: DraftPreview) {
  const lines = [
    `To: ${preview.to}`,
    `Subject: ${preview.subject}`,
  ];
  if (preview.attachments?.length) {
    lines.push(
      `Attachments: ${preview.attachments.map((a) => a.name).join(", ")}`
    );
  }
  lines.push("", preview.body);
  return lines.join("\n");
}

const APPROVAL_WORDS =
  "ok|okay|yes|yep|yeah|yup|sure|perfect|great|good|fine|awesome|excellent|amazing|wonderful|cool|nice|alright|all\\s*right|lgtm|approve|approved|done";

/**
 * Approval / save-draft intent while a pending draft is awaiting review.
 * Catches short approvals ("ok perfect") and "save/create the draft" phrasing.
 */
export function isDraftAcceptMessage(message: string) {
  const text = message.trim().toLowerCase().replace(/\s+/g, " ");
  if (!text || text.length > 280) return false;

  // Clear change requests are never accept (unless only "make a draft").
  if (isClearReviseMessage(text) && !hasSaveDraftAsk(text)) {
    return false;
  }

  // One or more approval words only: "ok", "ok perfect", "yes great!"
  if (
    new RegExp(
      `^(${APPROVAL_WORDS})([\\s,.!]+(${APPROVAL_WORDS}))*[\\s!.]*$`,
      "i"
    ).test(text)
  ) {
    return true;
  }

  // Short positive + optional save/create ask
  const acceptSignals =
    /\b(looks?\s+good|looks?\s+great|looks?\s+perfect|sounds?\s+good|sounds?\s+great|that'?s\s+(fine|good|great|perfect)|thats\s+(fine|good|great|perfect)|this\s+(is\s+)?(fine|good|great|perfect)|mail\s+is\s+(good|great|fine|perfect)|email\s+is\s+(good|great|fine|perfect)|draft\s+is\s+(good|great|fine|perfect)|go\s+ahead|ship\s+it|thumbs?\s*up|lgtm|approve(d)?|create\s+(the\s+)?draft|save\s+(the\s+)?draft|make\s+(the\s+)?draft|create\s+it|save\s+it|send\s+it\s+to\s+drafts?)\b/i;

  if (acceptSignals.test(text)) return true;

  // "ok the mail is good" / "yeah this is fine" without explicit change words
  if (
    text.length <= 120 &&
    new RegExp(`\\b(${APPROVAL_WORDS})\\b`, "i").test(text) &&
    /\b(mail|email|draft|message|this|that|it)\b/i.test(text) &&
    !isClearReviseMessage(text)
  ) {
    return true;
  }

  return false;
}

function hasSaveDraftAsk(text: string) {
  return /\b(create|save|make)\s+(the\s+)?draft\b|\bsave\s+it\b|\bcreate\s+it\b|\bsend\s+it\s+to\s+drafts?\b/i.test(
    text
  );
}

/**
 * Clear request to change the pending draft (not a new unrelated ask).
 */
export function isClearReviseMessage(message: string) {
  const text = message.trim().toLowerCase().replace(/\s+/g, " ");
  if (!text) return false;

  // Saving/creating the draft is approval, not a rewrite.
  if (hasSaveDraftAsk(text) && !/\b(change|rewrite|fix|update|shorter|longer|formal|casual)\b/i.test(text)) {
    return false;
  }

  return /\b(change|rewrite|rephrase|shorter|longer|formal|casual|fix|update\s+(the\s+)?(draft|email|mail|body|subject)|don'?t|dont|avoid|instead|remove|add\s+|too\s+(long|short|formal|casual|wordy)|make\s+it\s+(more|less|shorter|longer|friendlier|formal|casual)|can\s+you\s+(make|change|update|rewrite|fix)|please\s+(change|fix|update|rewrite|shorten)|tone\s+down|more\s+polite|less\s+formal)\b/i.test(
    text
  );
}

/**
 * Fast intent without an LLM. Returns "ambiguous" when unsure.
 */
export function classifyPendingDraftIntentHeuristic(
  message: string
): PendingDraftIntent | "ambiguous" {
  const text = message.trim();
  if (!text) return "ambiguous";

  if (isDraftAcceptMessage(text)) return "accept";
  if (isClearReviseMessage(text)) return "revise";
  return "ambiguous";
}

/**
 * @deprecated Prefer classifyPendingDraftIntentHeuristic / resolvePendingDraftIntent.
 * Old behavior: any non-accept message was treated as feedback (too aggressive).
 */
export function isPendingDraftFeedbackMessage(message: string) {
  return classifyPendingDraftIntentHeuristic(message) === "revise";
}
