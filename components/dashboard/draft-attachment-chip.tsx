"use client";

import { useEffect, useId, useState } from "react";
import {
  inferDrivePreviewKind,
  type DrivePreviewKind,
} from "@/lib/drive/preview";

export type DraftAttachmentChipData = {
  driveFileId: string;
  name: string;
  mimeType?: string;
  exportFormat?: string;
};

type PreviewPayload = {
  fileId: string;
  name: string;
  mimeType: string;
  kind: DrivePreviewKind;
  summary: string | null;
  previewEmbedUrl: string;
  openInDriveUrl: string;
  error?: string;
};

function kindLabel(kind: DrivePreviewKind) {
  switch (kind) {
    case "spreadsheet":
      return "Sheet";
    case "document":
      return "Doc";
    case "presentation":
      return "Slides";
    case "pdf":
      return "PDF";
    default:
      return "File";
  }
}

function KindIcon({ kind }: { kind: DrivePreviewKind }) {
  const common = "h-4 w-4 shrink-0";
  if (kind === "spreadsheet") {
    return (
      <svg className={common} viewBox="0 0 16 16" fill="none" aria-hidden>
        <rect x="2" y="2" width="12" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
        <path d="M2 6h12M2 10h12M6 2v12" stroke="currentColor" strokeWidth="1.4" />
      </svg>
    );
  }
  if (kind === "presentation") {
    return (
      <svg className={common} viewBox="0 0 16 16" fill="none" aria-hidden>
        <rect x="2" y="3" width="12" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
        <path d="M6 13h4M8 11v2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg className={common} viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M4 2.5h5.5L12.5 5.5V13.5a1 1 0 0 1-1 1h-7.5a1 1 0 0 1-1-1v-10a1 1 0 0 1 1-1Z"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <path d="M9.5 2.5V5.5H12.5" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

export function DraftAttachmentPreviewModal({
  attachment,
  onClose,
}: {
  attachment: DraftAttachmentChipData;
  onClose: () => void;
}) {
  const titleId = useId();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewPayload | null>(null);
  const [iframeFailed, setIframeFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch(
          `/api/drive/preview?fileId=${encodeURIComponent(attachment.driveFileId)}`
        );
        const payload = (await response.json()) as PreviewPayload & {
          error?: string;
        };
        if (!response.ok) {
          throw new Error(payload.error ?? "Failed to load file preview");
        }
        if (!cancelled) {
          setPreview(payload);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Failed to load file preview"
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [attachment.driveFileId]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const displayName = preview?.name || attachment.name;
  const kind =
    preview?.kind ??
    inferDrivePreviewKind({
      mimeType: attachment.mimeType,
      exportFormat: attachment.exportFormat,
      name: attachment.name,
    });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-zinc-950 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-white/10 px-5 py-4">
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-wider text-indigo-300/80">
              File review · {kindLabel(kind)}
            </p>
            <h2
              id={titleId}
              className="mt-1 truncate text-base font-semibold text-white"
            >
              {displayName}
            </h2>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {(preview?.openInDriveUrl || attachment.driveFileId) && (
              <a
                href={
                  preview?.openInDriveUrl ??
                  `https://drive.google.com/file/d/${encodeURIComponent(attachment.driveFileId)}/view`
                }
                target="_blank"
                rel="noreferrer"
                className="rounded-full border border-white/15 bg-white/[0.06] px-3 py-1.5 text-xs font-medium text-zinc-200 transition hover:bg-white/[0.1]"
              >
                Open in Drive
              </a>
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-white/15 bg-white/[0.06] px-3 py-1.5 text-xs font-medium text-zinc-200 transition hover:bg-white/[0.1]"
            >
              Close
            </button>
          </div>
        </div>

        {preview?.summary ? (
          <div className="border-b border-white/10 bg-indigo-500/[0.06] px-5 py-3">
            <p className="text-[11px] font-medium uppercase tracking-wider text-indigo-200/80">
              Summary
            </p>
            <p className="mt-1 text-sm leading-relaxed text-zinc-300">
              {preview.summary}
            </p>
          </div>
        ) : null}

        <div className="min-h-0 flex-1 bg-black/40">
          {loading ? (
            <div className="flex h-[min(60vh,520px)] items-center justify-center text-sm text-zinc-400">
              Loading file preview…
            </div>
          ) : error ? (
            <div className="flex h-[min(60vh,520px)] flex-col items-center justify-center gap-3 px-6 text-center">
              <p className="text-sm text-rose-300">{error}</p>
              <a
                href={`https://drive.google.com/file/d/${encodeURIComponent(attachment.driveFileId)}/view`}
                target="_blank"
                rel="noreferrer"
                className="rounded-full bg-indigo-500/90 px-4 py-2 text-xs font-medium text-white"
              >
                Open in Drive instead
              </a>
            </div>
          ) : iframeFailed || !preview?.previewEmbedUrl ? (
            <div className="flex h-[min(60vh,520px)] flex-col items-center justify-center gap-3 px-6 text-center">
              <p className="text-sm text-zinc-400">
                In-app preview could not be shown. Open the file in Drive to
                review it.
              </p>
              <a
                href={
                  preview?.openInDriveUrl ??
                  `https://drive.google.com/file/d/${encodeURIComponent(attachment.driveFileId)}/view`
                }
                target="_blank"
                rel="noreferrer"
                className="rounded-full bg-indigo-500/90 px-4 py-2 text-xs font-medium text-white"
              >
                Open in Drive
              </a>
            </div>
          ) : (
            <iframe
              title={`Preview of ${displayName}`}
              src={preview.previewEmbedUrl}
              className="h-[min(60vh,520px)] w-full border-0 bg-white"
              onError={() => setIframeFailed(true)}
              allow="autoplay"
            />
          )}
        </div>

        <p className="border-t border-white/10 px-5 py-3 text-[11px] text-zinc-500">
          Review this file, then close and thumbs-up the draft if it looks right.
          Preview is view-only — accepting the draft still attaches a copy.
        </p>
      </div>
    </div>
  );
}

export function DraftAttachmentChip({
  attachment,
  onOpen,
}: {
  attachment: DraftAttachmentChipData;
  onOpen: (attachment: DraftAttachmentChipData) => void;
}) {
  const kind = inferDrivePreviewKind({
    mimeType: attachment.mimeType,
    exportFormat: attachment.exportFormat,
    name: attachment.name,
  });

  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onOpen(attachment);
      }}
      title={`Open and review ${attachment.name}`}
      className="inline-flex max-w-full items-center gap-2 rounded-full border border-white/12 bg-white/[0.06] px-3 py-1.5 text-left text-xs text-zinc-200 transition hover:border-indigo-400/40 hover:bg-indigo-500/15 hover:text-white"
    >
      <span className="text-indigo-300">
        <KindIcon kind={kind} />
      </span>
      <span className="truncate font-medium">{attachment.name}</span>
      <span className="shrink-0 text-[10px] uppercase tracking-wide text-zinc-500">
        {kindLabel(kind)}
      </span>
    </button>
  );
}

export function DraftAttachmentChips({
  attachments,
}: {
  attachments: DraftAttachmentChipData[];
}) {
  const [openAttachment, setOpenAttachment] =
    useState<DraftAttachmentChipData | null>(null);

  if (!attachments.length) return null;

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {attachments.map((attachment) => (
          <DraftAttachmentChip
            key={`${attachment.driveFileId}:${attachment.name}`}
            attachment={attachment}
            onOpen={setOpenAttachment}
          />
        ))}
      </div>
      {openAttachment ? (
        <DraftAttachmentPreviewModal
          key={openAttachment.driveFileId}
          attachment={openAttachment}
          onClose={() => setOpenAttachment(null)}
        />
      ) : null}
    </>
  );
}
