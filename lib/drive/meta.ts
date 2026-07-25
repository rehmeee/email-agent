/**
 * Drive file metadata via files.get (explicit fields — description is not default).
 */

const DRIVE_FILES = "https://www.googleapis.com/drive/v3/files";

export type DriveFileMeta = {
  fileId: string;
  name: string;
  mimeType: string;
  description: string;
  modifiedTime: string | null;
  sizeBytes: number | null;
  trashed: boolean;
};

const META_FIELDS =
  "id,name,mimeType,description,modifiedTime,size,trashed";

export function exportFormatHintForMime(mimeType: string): string | null {
  if (mimeType.includes("spreadsheet")) return "xlsx";
  if (mimeType.includes("presentation")) return "pdf";
  if (mimeType.startsWith("application/vnd.google-apps.")) return "pdf";
  return null;
}

export async function getDriveFileMeta(input: {
  accessToken: string;
  fileId: string;
}): Promise<DriveFileMeta> {
  const url = new URL(
    `${DRIVE_FILES}/${encodeURIComponent(input.fileId)}`
  );
  url.searchParams.set("fields", META_FIELDS);
  url.searchParams.set("supportsAllDrives", "true");

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${input.accessToken}` },
  });

  if (response.status === 404) {
    throw new DriveFileNotFoundError(input.fileId);
  }

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(
      `Drive metadata failed for ${input.fileId}: ${response.status} ${errText.slice(0, 200)}`
    );
  }

  const payload = (await response.json()) as {
    id?: string;
    name?: string;
    mimeType?: string;
    description?: string;
    modifiedTime?: string;
    size?: string;
    trashed?: boolean;
  };

  const sizeRaw = payload.size ? Number(payload.size) : NaN;

  return {
    fileId: payload.id ?? input.fileId,
    name: payload.name?.trim() || "untitled",
    mimeType: payload.mimeType?.trim() || "application/octet-stream",
    description:
      typeof payload.description === "string" ? payload.description.trim() : "",
    modifiedTime: payload.modifiedTime ?? null,
    sizeBytes: Number.isFinite(sizeRaw) ? sizeRaw : null,
    trashed: Boolean(payload.trashed),
  };
}

export class DriveFileNotFoundError extends Error {
  readonly fileId: string;

  constructor(fileId: string) {
    super(`Drive file not found: ${fileId}`);
    this.name = "DriveFileNotFoundError";
    this.fileId = fileId;
  }
}

/**
 * Best-effort plain-text excerpt for summarization (Google Docs export or binary text).
 * Binary/non-text files may return empty — summary then relies on name + description.
 */
export async function getDriveFileTextExcerpt(input: {
  accessToken: string;
  fileId: string;
  mimeType: string;
  maxChars?: number;
}): Promise<string> {
  const maxChars = input.maxChars ?? 12_000;
  const mime = input.mimeType;
  const isGoogleNative = mime.startsWith("application/vnd.google-apps.");

  let downloadUrl: string;
  if (mime === "application/vnd.google-apps.document") {
    downloadUrl = `${DRIVE_FILES}/${encodeURIComponent(input.fileId)}/export?mimeType=${encodeURIComponent("text/plain")}`;
  } else if (mime === "application/vnd.google-apps.spreadsheet") {
    downloadUrl = `${DRIVE_FILES}/${encodeURIComponent(input.fileId)}/export?mimeType=${encodeURIComponent("text/csv")}`;
  } else if (mime === "application/vnd.google-apps.presentation") {
    downloadUrl = `${DRIVE_FILES}/${encodeURIComponent(input.fileId)}/export?mimeType=${encodeURIComponent("text/plain")}`;
  } else if (
    mime.startsWith("text/") ||
    mime === "application/json" ||
    mime === "application/csv" ||
    mime === "text/csv"
  ) {
    downloadUrl = `${DRIVE_FILES}/${encodeURIComponent(input.fileId)}?alt=media`;
  } else if (isGoogleNative) {
    // Forms, drawings, etc. — no useful text export
    return "";
  } else {
    // PDFs / Office / images: skip bytes in v1; name+description still help
    return "";
  }

  const response = await fetch(downloadUrl, {
    headers: { Authorization: `Bearer ${input.accessToken}` },
  });

  if (!response.ok) {
    return "";
  }

  const text = await response.text();
  const trimmed = text.replace(/\u0000/g, "").trim();
  if (!trimmed) return "";
  return trimmed.length > maxChars
    ? `${trimmed.slice(0, maxChars)}\n…[truncated]`
    : trimmed;
}
