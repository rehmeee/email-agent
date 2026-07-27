import type { DraftPreview } from "@/lib/drafts/preview";

/**
 * Prompt for rewrite-after-feedback runs. Includes thread ids + attachments so
 * the model does not invent ids. When withDrive is true, Drive search/attach
 * tools are allowed; otherwise only propose_draft.
 */
export function buildRedraftPrompt(input: {
  draft: DraftPreview;
  feedback: string;
  /** When true, allow Drive tools and require real file attachments when asked. */
  withDrive?: boolean;
}): string {
  const { draft, feedback, withDrive = false } = input;
  const lines = [
    "Rewrite an improved email draft using the user's feedback and updated writing persona.",
    "When ready, call propose_draft exactly once with the improved email.",
    "",
    "Hard rules:",
  ];

  if (withDrive) {
    lines.push(
      "- You MAY use Drive tools: search_drive_files, get_drive_file_summary, index_drive_file.",
      "- Do NOT use Gmail, calendar, or other non-Drive tools.",
      "- If feedback asks to add/attach a file (e.g. roadmap, resume, sheet): search Drive, then put the file on propose_draft as attachments: [{ driveFileId, name, exportFormat? }] from real tool results.",
      "- Do NOT only paste file contents into the body when they asked to attach a file — attach the Drive file.",
      "- Prefer one clear Drive match. 0 matches → say so in the body (ask which file). 2+ matches → ask which file in the body; attach nothing until clear.",
      "- Keep the same recipient and thread ids unless feedback asks to change them.",
      "- Keep existing attachments unless feedback asks to change/remove them; add new ones when feedback asks to attach.",
      "- Never invent driveFileId values. Never claim the email was sent."
    );
  } else {
    lines.push(
      "- Call ONLY propose_draft — no Gmail, Drive, calendar, or other tools.",
      "- Keep the same recipient and thread ids unless feedback asks to change them.",
      "- Keep the same attachments unless feedback asks to change/remove them.",
      "- Never invent driveFileId values. Never claim the email was sent."
    );
  }

  lines.push(
    "",
    "Previous draft:",
    `To: ${draft.to}`,
    `Subject: ${draft.subject}`
  );

  if (draft.gmailThreadId) {
    lines.push(`gmailThreadId: ${draft.gmailThreadId}`);
  }
  if (draft.inReplyTo) {
    lines.push(`inReplyTo: ${draft.inReplyTo}`);
  }
  if (draft.references) {
    lines.push(`references: ${draft.references}`);
  }
  if (draft.attachments?.length) {
    lines.push("attachments:");
    for (const attachment of draft.attachments) {
      const parts = [
        `driveFileId=${attachment.driveFileId}`,
        `name=${attachment.name}`,
      ];
      if (attachment.exportFormat) {
        parts.push(`exportFormat=${attachment.exportFormat}`);
      }
      if (attachment.mimeType) {
        parts.push(`mimeType=${attachment.mimeType}`);
      }
      lines.push(`- ${parts.join(", ")}`);
    }
  } else {
    lines.push("attachments: (none)");
  }

  lines.push("Body:", draft.body.slice(0, 2500), "", "User feedback:", feedback.trim(), "");

  if (withDrive) {
    lines.push(
      "Do not explain what you changed. Use Drive tools if needed to attach files, then call propose_draft once (include attachments when attaching)."
    );
  } else {
    lines.push("Do not explain what you changed. Only call propose_draft.");
  }

  return lines.join("\n");
}

export const DRAFT_PRAISE_REPLY =
  "Glad it landed — I'll keep that style in mind. The draft is unchanged.";
