export type DraftPreview = {
  to: string;
  subject: string;
  body: string;
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

export function buildDraftReviewReply(options?: { afterFeedback?: boolean }) {
  if (options?.afterFeedback) {
    return "Got it — I'll keep this in mind. Here's the updated draft. Thumbs up to save to Gmail, thumbs down for more feedback, or just reply in chat.";
  }
  return "Here's your draft — thumbs up to save to Gmail, thumbs down to give feedback, or just reply in chat.";
}

export function formatDraftPreviewBlock(preview: DraftPreview) {
  return `To: ${preview.to}\nSubject: ${preview.subject}\n\n${preview.body}`;
}

/**
 * Approval / save-draft intent while a pending draft is awaiting review.
 * Allows short phrases and slightly longer "looking good, create the draft" style messages.
 */
export function isDraftAcceptMessage(message: string) {
  const text = message.trim().toLowerCase().replace(/\s+/g, " ");
  if (!text || text.length > 160) return false;

  // Exact / near-exact approvals
  if (
    /^(ok|okay|yes|yep|yeah|perfect|great|good|lgtm|approve|approved|go ahead|ship it|create it|save it)[\s!.]*$/i.test(
      text
    )
  ) {
    return true;
  }

  // Contains-style accept (e.g. "looking good make a draft")
  const acceptSignals =
    /\b(looks?\s+good|looks?\s+great|sounds?\s+good|that'?s\s+fine|thats\s+fine|go\s+ahead|lgtm|approve(d)?|create\s+(the\s+)?draft|save\s+(the\s+)?draft|make\s+(the\s+)?draft|create\s+it|save\s+it)\b/i;

  // Reject if clearly asking for changes
  const changeSignals =
    /\b(change|rewrite|shorter|longer|formal|casual|fix|don'?t|dont|avoid|instead|too\s+|make\s+it\s+(more|less|shorter|longer))\b/i;

  if (changeSignals.test(text)) return false;
  return acceptSignals.test(text);
}

/**
 * While a draft is pending review: any non-empty message that is not accept
 * is treated as feedback / rewrite remarks.
 */
export function isPendingDraftFeedbackMessage(message: string) {
  const text = message.trim();
  if (!text) return false;
  return !isDraftAcceptMessage(text);
}
