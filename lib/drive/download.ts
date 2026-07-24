/**
 * Download a Drive file as base64 for MCP draft attachments.
 * Prefer this over get_drive_file_download_url in WORKSPACE_MCP_STATELESS_MODE
 * (that tool only returns a truncated base64 preview, not a fetchable URL).
 */

const DRIVE_FILES = "https://www.googleapis.com/drive/v3/files";

export type DriveBinaryDownload = {
  contentBase64: string;
  filename: string;
  mimeType: string;
};

function encodeFilenameFromHeader(contentDisposition: string | null): string | null {
  if (!contentDisposition) return null;
  const utf = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf?.[1]) {
    try {
      return decodeURIComponent(utf[1]);
    } catch {
      return utf[1];
    }
  }
  const plain = contentDisposition.match(/filename="?([^";]+)"?/i);
  return plain?.[1]?.trim() || null;
}

/**
 * Download file bytes from Drive (binary or Google Workspace export).
 */
export async function downloadDriveFileAsBase64(input: {
  accessToken: string;
  fileId: string;
  filename?: string;
  mimeType?: string;
  exportFormat?: string;
}): Promise<DriveBinaryDownload> {
  const metaRes = await fetch(
    `${DRIVE_FILES}/${encodeURIComponent(input.fileId)}?fields=id,name,mimeType,size`,
    {
      headers: { Authorization: `Bearer ${input.accessToken}` },
    }
  );

  if (!metaRes.ok) {
    const errText = await metaRes.text();
    throw new Error(
      `Drive metadata failed for ${input.fileId}: ${metaRes.status} ${errText.slice(0, 200)}`
    );
  }

  const meta = (await metaRes.json()) as {
    id: string;
    name?: string;
    mimeType?: string;
  };

  const filename = input.filename?.trim() || meta.name || "attachment";
  const mimeType = input.mimeType?.trim() || meta.mimeType || "application/octet-stream";
  const isGoogleNative = mimeType.startsWith("application/vnd.google-apps.");

  let downloadUrl: string;
  let outMime = mimeType;
  let outName = filename;

  if (isGoogleNative) {
    const format =
      input.exportFormat?.trim() ||
      (mimeType.includes("spreadsheet")
        ? "xlsx"
        : mimeType.includes("presentation")
          ? "pdf"
          : "pdf");
    const exportMime =
      format === "xlsx"
        ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        : format === "docx"
          ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          : "application/pdf";
    downloadUrl = `${DRIVE_FILES}/${encodeURIComponent(input.fileId)}/export?mimeType=${encodeURIComponent(exportMime)}`;
    outMime = exportMime;
    if (!outName.includes(".")) {
      outName = `${outName}.${format}`;
    }
  } else {
    downloadUrl = `${DRIVE_FILES}/${encodeURIComponent(input.fileId)}?alt=media`;
  }

  const fileRes = await fetch(downloadUrl, {
    headers: { Authorization: `Bearer ${input.accessToken}` },
  });

  if (!fileRes.ok) {
    const errText = await fileRes.text();
    throw new Error(
      `Drive download failed for "${filename}": ${fileRes.status} ${errText.slice(0, 200)}`
    );
  }

  const headerName = encodeFilenameFromHeader(
    fileRes.headers.get("content-disposition")
  );
  if (headerName) outName = headerName;

  const buffer = Buffer.from(await fileRes.arrayBuffer());
  // Cap ~20MB to stay under Gmail's ~25MB attachment limit with MIME overhead.
  if (buffer.byteLength > 20 * 1024 * 1024) {
    throw new Error(
      `Drive file "${outName}" is too large to attach (${Math.round(buffer.byteLength / 1024 / 1024)}MB). Keep under 20MB.`
    );
  }

  return {
    contentBase64: buffer.toString("base64"),
    filename: outName,
    mimeType: outMime,
  };
}
