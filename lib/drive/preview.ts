/**
 * Build Google Drive / Docs preview + open URLs for draft attachment review.
 */

export type DrivePreviewKind =
  | "spreadsheet"
  | "document"
  | "presentation"
  | "pdf"
  | "file";

export function inferDrivePreviewKind(input: {
  mimeType?: string | null;
  exportFormat?: string | null;
  name?: string | null;
}): DrivePreviewKind {
  const mime = (input.mimeType ?? "").toLowerCase();
  const format = (input.exportFormat ?? "").toLowerCase();
  const name = (input.name ?? "").toLowerCase();

  if (
    mime.includes("spreadsheet") ||
    format === "xlsx" ||
    format === "csv" ||
    /\.(xlsx|xls|csv)$/.test(name)
  ) {
    return "spreadsheet";
  }
  if (
    mime.includes("presentation") ||
    format === "pptx" ||
    /\.(pptx|ppt)$/.test(name)
  ) {
    return "presentation";
  }
  if (
    mime.includes("pdf") ||
    format === "pdf" ||
    name.endsWith(".pdf")
  ) {
    return "pdf";
  }
  if (
    mime.includes("document") ||
    mime.includes("msword") ||
    format === "docx" ||
    /\.(docx|doc)$/.test(name)
  ) {
    return "document";
  }
  return "file";
}

export function buildDrivePreviewEmbedUrl(input: {
  fileId: string;
  mimeType?: string | null;
}): string {
  const id = encodeURIComponent(input.fileId);
  const mime = (input.mimeType ?? "").toLowerCase();

  if (mime === "application/vnd.google-apps.spreadsheet") {
    return `https://docs.google.com/spreadsheets/d/${id}/preview`;
  }
  if (mime === "application/vnd.google-apps.document") {
    return `https://docs.google.com/document/d/${id}/preview`;
  }
  if (mime === "application/vnd.google-apps.presentation") {
    return `https://docs.google.com/presentation/d/${id}/preview`;
  }

  return `https://drive.google.com/file/d/${id}/preview`;
}

export function buildDriveOpenUrl(input: {
  fileId: string;
  mimeType?: string | null;
}): string {
  const id = encodeURIComponent(input.fileId);
  const mime = (input.mimeType ?? "").toLowerCase();

  if (mime === "application/vnd.google-apps.spreadsheet") {
    return `https://docs.google.com/spreadsheets/d/${id}/edit`;
  }
  if (mime === "application/vnd.google-apps.document") {
    return `https://docs.google.com/document/d/${id}/edit`;
  }
  if (mime === "application/vnd.google-apps.presentation") {
    return `https://docs.google.com/presentation/d/${id}/edit`;
  }
  return `https://drive.google.com/file/d/${id}/view`;
}
