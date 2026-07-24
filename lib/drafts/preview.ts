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

/** What to do with the next user message while a draft is pending review. */
export type PendingDraftIntent = "accept" | "revise" | "other";

export function buildDraftReviewReply(options?: { afterFeedback?: boolean }) {
  if (options?.afterFeedback) {
    return "Got it — I'll keep this in mind. Here's the updated draft. Thumbs up to save to Gmail, thumbs down for more feedback, or just reply in chat.";
  }
  return "Here's your draft — thumbs up to save to Gmail, thumbs down to give feedback, or just reply in chat.";
}

export function formatDraftPreviewBlock(preview: DraftPreview) {
  return `To: ${preview.to}\nSubject: ${preview.subject}\n\n${preview.body}`;
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
