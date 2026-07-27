import { NextResponse } from "next/server";
import {
  buildDriveOpenUrl,
  buildDrivePreviewEmbedUrl,
  inferDrivePreviewKind,
} from "@/lib/drive/preview";
import {
  DriveFileNotFoundError,
  getDriveFileMeta,
} from "@/lib/drive/meta";
import { getDriveFileSummary } from "@/lib/drive/summaries";
import { getValidGmailAccessToken } from "@/lib/gmail/connection";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const fileId = new URL(request.url).searchParams.get("fileId")?.trim();
  if (!fileId) {
    return NextResponse.json(
      { error: "fileId query param is required" },
      { status: 400 }
    );
  }

  try {
    const { accessToken } = await getValidGmailAccessToken(user.id, {
      skipScopeCheck: true,
    });

    const meta = await getDriveFileMeta({ accessToken, fileId });
    const summaryRecord = await getDriveFileSummary(user.id, fileId);
    const kind = inferDrivePreviewKind({
      mimeType: meta.mimeType,
      exportFormat: summaryRecord?.exportFormatHint,
      name: meta.name,
    });

    return NextResponse.json({
      fileId: meta.fileId,
      name: meta.name,
      mimeType: meta.mimeType,
      kind,
      summary: summaryRecord?.summary?.trim() || null,
      exportFormatHint:
        summaryRecord?.exportFormatHint ??
        (kind === "spreadsheet"
          ? "xlsx"
          : kind === "document" || kind === "presentation" || kind === "pdf"
            ? "pdf"
            : null),
      sizeBytes: meta.sizeBytes,
      previewEmbedUrl: buildDrivePreviewEmbedUrl({
        fileId: meta.fileId,
        mimeType: meta.mimeType,
      }),
      openInDriveUrl: buildDriveOpenUrl({
        fileId: meta.fileId,
        mimeType: meta.mimeType,
      }),
    });
  } catch (error) {
    if (error instanceof DriveFileNotFoundError) {
      return NextResponse.json(
        { error: "Drive file not found", fileId },
        { status: 404 }
      );
    }
    const message =
      error instanceof Error ? error.message : "Failed to load Drive preview";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
