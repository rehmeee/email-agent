import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { runDriveSummarizeAgent } from "@/lib/agent/agents/drive-summarize";
import { clearDriveChangePending } from "@/lib/drive/pending";
import { getDriveFileSummary } from "@/lib/drive/summaries";

/**
 * After search_drive_files finds a fileId: check cached summary, or index via
 * the Drive summarize agent on miss.
 */
export function createDriveKnowledgeTools(input: {
  userId: string;
  accessToken: string;
}) {
  const getDriveFileSummaryTool = tool(
    async ({ fileId }) => {
      const id = fileId.trim();
      const record = await getDriveFileSummary(input.userId, id);
      if (!record) {
        return JSON.stringify({
          found: false,
          fileId: id,
          hint: "No cached summary. Call index_drive_file with this fileId.",
        });
      }

      return JSON.stringify({
        found: true,
        fileId: record.fileId,
        name: record.name,
        mimeType: record.mimeType,
        description: record.description,
        summary: record.summary,
        exportFormatHint: record.exportFormatHint,
        draftUseCount: record.draftUseCount,
        modifiedTime: record.modifiedTime,
      });
    },
    {
      name: "get_drive_file_summary",
      description:
        "Look up a cached Drive file summary in MailMind's DB by file id (from search_drive_files). Returns description + summary when indexed. On miss, call index_drive_file next — do not call get_drive_file_content just to decide what the file is.",
      schema: z.object({
        fileId: z
          .string()
          .min(1)
          .describe("Google Drive file id from search_drive_files"),
      }),
    }
  );

  const indexDriveFileTool = tool(
    async ({ fileId }) => {
      const id = fileId.trim();
      const result = await runDriveSummarizeAgent({
        userId: input.userId,
        accessToken: input.accessToken,
        fileId: id,
        reason: "chat_miss",
      });

      // Avoid an immediate cron re-summarize of the same file.
      await clearDriveChangePending(input.userId, id);

      if (result.deleted) {
        return JSON.stringify({
          ok: false,
          deleted: true,
          fileId: result.fileId,
          error: result.error ?? "File missing or trashed in Drive",
        });
      }

      if (result.error && !result.summary) {
        return JSON.stringify({
          ok: false,
          fileId: result.fileId,
          error: result.error,
        });
      }

      return JSON.stringify({
        ok: true,
        cached: result.cached,
        fileId: result.fileId,
        name: result.name,
        mimeType: result.mimeType,
        description: result.description,
        summary: result.summary,
        exportFormatHint: result.exportFormatHint,
        hint: "Use fileId + name on propose_draft / draft attachments. Prefer this summary over re-reading file content.",
      });
    },
    {
      name: "index_drive_file",
      description:
        "After search_drive_files finds a fileId with no get_drive_file_summary hit: run the Drive summarize agent to load Drive description + content, store a short summary, and return it. Call once per new fileId. Ready for future Drive webhook updates via the same agent.",
      schema: z.object({
        fileId: z
          .string()
          .min(1)
          .describe("Google Drive file id from search_drive_files"),
      }),
    }
  );

  return [getDriveFileSummaryTool, indexDriveFileTool];
}
