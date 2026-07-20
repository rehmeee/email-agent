export type PendingDraftPreview = {
  to: string;
  subject: string;
  body: string;
};

export function buildDraftReviewReply(options?: { afterFeedback?: boolean }) {
  if (options?.afterFeedback) {
    return "Got it — I'll keep this in mind. Here's the updated draft. Hope you like it; reject again if you want to customize it.";
  }
  return "Here's your draft. Hope you like it; reject with feedback if you want changes.";
}

export function formatDraftPreviewBlock(preview: PendingDraftPreview) {
  return `To: ${preview.to}\nSubject: ${preview.subject}\n\n${preview.body}`;
}
