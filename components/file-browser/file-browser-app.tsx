"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { Check, Copy, ExternalLink, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ClipThumbnail } from "@/components/social-post-preview/clip-thumbnail";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useCopy } from "@/hooks/use-copy";
import { MAX_LABEL_LENGTH, normalizeLabel } from "@/lib/asset-labels";
import type { StoredClip, StoredImage } from "@/lib/blob";
import { formatBytes, isImagePathname } from "@/lib/images";
import { measureVideoUrl } from "@/lib/social-post-preview/measure-media";
import { cn } from "@/lib/utils";

type Tab = "latest" | "images" | "clips";

type LibraryState = {
  images: StoredImage[];
  clips: StoredClip[];
  imagesHasMore: boolean;
  clipsHasMore: boolean;
};

type BrowserRow =
  | { kind: "image"; uploadedAt: string; image: StoredImage }
  | { kind: "clip"; uploadedAt: string; clip: StoredClip };

type PendingDelete = {
  kind: "image" | "clip";
  pathname: string;
  title: string;
};

const TAB_LABELS: { value: Tab; label: string }[] = [
  { value: "latest", label: "Latest" },
  { value: "images", label: "Images" },
  { value: "clips", label: "Clips" },
];

const LABEL_PLACEHOLDER = "Label, e.g. Title slide or Mjoll path";

function formatUploadedAt(iso: string) {
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function formatDuration(seconds?: number) {
  if (seconds == null || !Number.isFinite(seconds)) return null;
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

async function loadLibrary(): Promise<LibraryState | Error> {
  try {
    const [imgRes, clipRes] = await Promise.all([
      fetch("/api/images", { cache: "no-store" }),
      fetch("/api/clips", { cache: "no-store" }),
    ]);
    const imgData = await imgRes.json().catch(() => ({}));
    const clipData = await clipRes.json().catch(() => ({}));
    if (!imgRes.ok) return new Error(imgData.error || imgRes.statusText);
    if (!clipRes.ok) return new Error(clipData.error || clipRes.statusText);
    return {
      images: (imgData.images as StoredImage[]) ?? [],
      clips: (clipData.clips as StoredClip[]) ?? [],
      imagesHasMore: Boolean(imgData.hasMore),
      clipsHasMore: Boolean(clipData.hasMore),
    };
  } catch (e) {
    return e instanceof Error ? e : new Error("Couldn't load files.");
  }
}

export function FileBrowserApp() {
  const [tab, setTab] = useState<Tab>("latest");
  const [library, setLibrary] = useState<LibraryState | null>(null);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [durations, setDurations] = useState<Record<string, number>>({});
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [deleting, setDeleting] = useState(false);
  const { copiedKey, copy } = useCopy();

  const applyLibrary = useCallback((result: LibraryState | Error) => {
    if (result instanceof Error) {
      setLibrary(null);
      setLibraryError(result.message);
    } else {
      setLibrary(result);
      setLibraryError(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadLibrary().then((result) => {
      if (!cancelled) applyLibrary(result);
    });
    return () => {
      cancelled = true;
    };
  }, [applyLibrary]);

  const refresh = async () => {
    setRefreshing(true);
    applyLibrary(await loadLibrary());
    setRefreshing(false);
  };

  const requestDelete = useCallback((item: PendingDelete) => {
    setPendingDelete(item);
  }, []);

  const updateImage = useCallback((pathname: string, patch: Partial<StoredImage>) => {
    setLibrary((prev) =>
      prev && { ...prev, images: prev.images.map((i) => (i.pathname === pathname ? { ...i, ...patch } : i)) },
    );
  }, []);

  const updateClip = useCallback((pathname: string, patch: Partial<StoredClip>) => {
    setLibrary((prev) =>
      prev && { ...prev, clips: prev.clips.map((c) => (c.pathname === pathname ? { ...c, ...patch } : c)) },
    );
  }, []);

  const saveLabel = useCallback(
    async (asset: { pathname: string; label: string | null }, raw: string) => {
      const label = normalizeLabel(raw);
      if (label === (asset.label ?? "")) return;
      const previous = asset.label;
      const isImage = isImagePathname(asset.pathname);
      if (isImage) updateImage(asset.pathname, { label: label || null });
      else updateClip(asset.pathname, { label: label || null });
      const result = await putLabel(asset.pathname, label);
      if (result instanceof Error) {
        if (isImage) updateImage(asset.pathname, { label: previous });
        else updateClip(asset.pathname, { label: previous });
        toast.error(result.message);
      } else if (isImage) updateImage(asset.pathname, { label: result });
      else updateClip(asset.pathname, { label: result });
    },
    [updateClip, updateImage],
  );

  const confirmDelete = async () => {
    const item = pendingDelete;
    if (!item) return;
    setDeleting(true);
    const endpoint = item.kind === "image" ? "/api/images" : "/api/clips";
    try {
      const res = await fetch(endpoint, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pathname: item.pathname }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || res.statusText);
      setLibrary((prev) => {
        if (!prev) return prev;
        if (item.kind === "image") {
          return { ...prev, images: prev.images.filter((i) => i.pathname !== item.pathname) };
        }
        return { ...prev, clips: prev.clips.filter((c) => c.pathname !== item.pathname) };
      });
      setDurations((d) => {
        const next = { ...d };
        delete next[item.pathname];
        return next;
      });
      toast.success(`Deleted ${item.title}.`, { description: "Cached copies can take up to a minute to clear." });
      setPendingDelete(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed.");
    } finally {
      setDeleting(false);
    }
  };

  const latestRows = useMemo((): BrowserRow[] => {
    if (!library) return [];
    const rows: BrowserRow[] = [
      ...library.images.map((image) => ({ kind: "image" as const, uploadedAt: image.uploadedAt, image })),
      ...library.clips.map((clip) => ({ kind: "clip" as const, uploadedAt: clip.uploadedAt, clip })),
    ];
    rows.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
    return rows;
  }, [library]);

  const probeClip = useCallback(
    (clip: StoredClip) => {
      if (durations[clip.pathname]) return;
      measureVideoUrl(clip.url)
        .then((m) => setDurations((d) => ({ ...d, [clip.pathname]: m.durationSeconds ?? 0 })))
        .catch(() => {});
    },
    [durations],
  );

  const hasMore = library?.imagesHasMore || library?.clipsHasMore;
  const isEmpty =
    !loading &&
    !libraryError &&
    library &&
    (tab === "latest"
      ? !latestRows.length
      : tab === "images"
        ? !library.images.length
        : !library.clips.length);

  return (
    <>
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle>Public files</CardTitle>
          <CardDescription>Recent exports from the clipper and reframe tools, plus image uploads.</CardDescription>
        </div>
        <Button type="button" variant="outline" size="sm" disabled={loading || refreshing} onClick={() => void refresh()}>
          <RefreshCw className={cn(refreshing && "animate-spin")} />
          Refresh
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {TAB_LABELS.map(({ value, label }) => (
            <Button
              key={value}
              type="button"
              variant={tab === value ? "default" : "outline"}
              size="sm"
              onClick={() => setTab(value)}
            >
              {label}
            </Button>
          ))}
        </div>

        {hasMore ? (
          <p className="text-sm text-muted-foreground">
            Showing the most recent uploads; older files may be hidden.
          </p>
        ) : null}

        {libraryError ? <p className="text-sm text-destructive">{libraryError}</p> : null}

        {loading && !library ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="aspect-[4/3] w-full" />
            ))}
          </div>
        ) : null}

        {isEmpty ? (
          <p className="text-sm text-muted-foreground">
            {tab === "clips"
              ? "No clips yet. Export from the clipper or reframe tool to see them here."
              : tab === "images"
                ? "No images yet. Upload from the image uploader to see them here."
                : "No files yet. Export clips or upload images to see them here."}
          </p>
        ) : null}

        {tab === "latest" && latestRows.length ? (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {latestRows.map((row) =>
              row.kind === "image" ? (
                <ImageCard
                  key={row.image.pathname}
                  image={row.image}
                  copiedKey={copiedKey}
                  onCopy={copy}
                  onDelete={requestDelete}
                  onSaveLabel={saveLabel}
                />
              ) : (
                <ClipCard
                  key={row.clip.pathname}
                  clip={row.clip}
                  copiedKey={copiedKey}
                  onCopy={copy}
                  duration={durations[row.clip.pathname]}
                  onProbe={() => probeClip(row.clip)}
                  onDelete={requestDelete}
                  onSaveLabel={saveLabel}
                />
              ),
            )}
          </ul>
        ) : null}

        {tab === "images" && library?.images.length ? (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {library.images.map((image) => (
              <ImageCard
                key={image.pathname}
                image={image}
                copiedKey={copiedKey}
                onCopy={copy}
                onDelete={requestDelete}
                onSaveLabel={saveLabel}
              />
            ))}
          </ul>
        ) : null}

        {tab === "clips" && library?.clips.length ? (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {library.clips.map((clip) => (
              <ClipCard
                key={clip.pathname}
                clip={clip}
                copiedKey={copiedKey}
                onCopy={copy}
                duration={durations[clip.pathname]}
                onProbe={() => probeClip(clip)}
                onDelete={requestDelete}
                onSaveLabel={saveLabel}
              />
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>

    <AlertDialog open={pendingDelete != null} onOpenChange={(open) => !open && !deleting && setPendingDelete(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {pendingDelete?.title}?</AlertDialogTitle>
          <AlertDialogDescription>
            The public link stops working for everyone you shared it with. This can&apos;t be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={deleting}
            onClick={(e) => {
              e.preventDefault();
              void confirmDelete();
            }}
          >
            {deleting ? "Deleting…" : "Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}

type CopyFn = (key: string, text: string, message: string) => void;

type DeleteFn = (item: PendingDelete) => void;

type SaveLabelFn = (asset: { pathname: string; label: string | null }, raw: string) => void;

function ImageCard({
  image,
  copiedKey,
  onCopy,
  onDelete,
  onSaveLabel,
}: {
  image: StoredImage;
  copiedKey: string | null;
  onCopy: CopyFn;
  onDelete: DeleteFn;
  onSaveLabel: SaveLabelFn;
}) {
  const displayTitle = image.label || image.name;
  return (
    <li className="overflow-hidden rounded-lg border">
      <div className="relative aspect-[4/3] bg-muted">
        <a href={image.url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${displayTitle}`}>
          <Image
            src={image.url}
            alt=""
            fill
            sizes="(min-width: 1280px) 240px, (min-width: 1024px) 320px, (min-width: 640px) 50vw, 100vw"
            className="object-cover"
          />
        </a>
        <span className="absolute top-2 right-2 rounded bg-background/90 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Image
        </span>
      </div>
      <AssetMeta
        label={image.label}
        fileName={image.name}
        pathname={image.pathname}
        size={image.size}
        uploadedAt={image.uploadedAt}
        url={image.url}
        copiedKey={copiedKey}
        onCopy={onCopy}
        onDelete={() => onDelete({ kind: "image", pathname: image.pathname, title: displayTitle })}
        onSaveLabel={(raw) => onSaveLabel(image, raw)}
      />
    </li>
  );
}

function ClipCard({
  clip,
  copiedKey,
  onCopy,
  duration,
  onProbe,
  onDelete,
  onSaveLabel,
}: {
  clip: StoredClip;
  copiedKey: string | null;
  onCopy: CopyFn;
  duration?: number;
  onProbe: () => void;
  onDelete: DeleteFn;
  onSaveLabel: SaveLabelFn;
}) {
  useEffect(() => {
    onProbe();
  }, [clip.pathname, onProbe]);

  const displayTitle = clip.label || clip.name;
  const durationLabel = formatDuration(duration);
  return (
    <li className="overflow-hidden rounded-lg border">
      <div className="relative aspect-video bg-black">
        <a
          href={clip.url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Open ${displayTitle}`}
          className="block size-full"
        >
          <ClipThumbnail url={clip.url} className="size-full rounded-none" />
        </a>
        <span className="absolute top-2 right-2 rounded bg-background/90 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Clip
        </span>
        {durationLabel ? (
          <span className="absolute bottom-2 right-2 rounded bg-black/70 px-1.5 py-0.5 text-xs text-white">
            {durationLabel}
          </span>
        ) : null}
      </div>
      <AssetMeta
        label={clip.label}
        fileName={clip.name}
        pathname={clip.pathname}
        size={clip.size}
        uploadedAt={clip.uploadedAt}
        url={clip.url}
        copiedKey={copiedKey}
        onCopy={onCopy}
        onDelete={() => onDelete({ kind: "clip", pathname: clip.pathname, title: displayTitle })}
        onSaveLabel={(raw) => onSaveLabel(clip, raw)}
      />
    </li>
  );
}

function AssetMeta({
  label,
  fileName,
  pathname,
  size,
  uploadedAt,
  url,
  copiedKey,
  onCopy,
  onDelete,
  onSaveLabel,
}: {
  label: string | null;
  fileName: string;
  pathname: string;
  size: number;
  uploadedAt: string;
  url: string;
  copiedKey: string | null;
  onCopy: CopyFn;
  onDelete: () => void;
  onSaveLabel: (raw: string) => void;
}) {
  const openLabel = label || fileName;
  return (
    <div className="space-y-2 p-3">
      <CommitInput
        key={`label:${label ?? ""}`}
        value={label ?? ""}
        maxLength={MAX_LABEL_LENGTH}
        placeholder={LABEL_PLACEHOLDER}
        ariaLabel={`Label for ${fileName}`}
        onCommit={onSaveLabel}
      />
      <div className="min-w-0">
        <p className="truncate text-sm font-medium" title={fileName}>
          {fileName}
        </p>
        <p className="truncate text-xs text-muted-foreground" title={pathname}>
          {pathname}
        </p>
        <p className="text-xs text-muted-foreground">
          {formatBytes(size)} · {formatUploadedAt(uploadedAt)}
        </p>
      </div>
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="flex-1"
          onClick={() => onCopy(pathname, url, "Link copied.")}
        >
          {copiedKey === pathname ? <Check /> : <Copy />}
          Copy link
        </Button>
        <Button type="button" variant="ghost" size="icon-sm" asChild>
          <a href={url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${openLabel} in a new tab`}>
            <ExternalLink />
          </a>
        </Button>
        <Button type="button" variant="ghost" size="icon-sm" aria-label={`Delete ${openLabel}`} onClick={onDelete}>
          <Trash2 />
        </Button>
      </div>
    </div>
  );
}

/** Saves on blur or Enter; remounted via `key` when the stored value changes. */
function CommitInput({
  value,
  maxLength,
  placeholder,
  ariaLabel,
  onCommit,
}: {
  value: string;
  maxLength: number;
  placeholder: string;
  ariaLabel: string;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  return (
    <Input
      value={draft}
      maxLength={maxLength}
      placeholder={placeholder}
      aria-label={ariaLabel}
      title={draft || undefined}
      className="h-8 text-xs"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => onCommit(draft)}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") setDraft(value);
      }}
    />
  );
}

async function putLabel(pathname: string, label: string): Promise<string | null | Error> {
  try {
    const res = await fetch("/api/labels", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pathname, label }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return new Error(data.error || "Couldn't save the label.");
    return (data.label as string | null) ?? null;
  } catch {
    return new Error("Couldn't save the label.");
  }
}
