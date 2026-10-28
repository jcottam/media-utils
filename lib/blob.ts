import { del, issueSignedToken, list, type ListBlobResultBlob, presignUrl, put } from "@vercel/blob";
import {
  assetFolder,
  CLIP_PREFIX,
  isClipPathname,
  isSidecar,
  labelFromSidecar,
  normalizeSidecarText,
  type SidecarKind,
  sidecarPathname,
  tagFromSidecar,
} from "@/lib/asset-labels";
import { blobDownloadUrl } from "@/lib/blob-download-url";
import { IMAGE_PREFIX, imageDisplayName, isImagePathname } from "@/lib/images";

export { blobDownloadUrl };
export { CLIP_PREFIX } from "@/lib/asset-labels";

export function blobStoreConfigured() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);
}

/** Public `media-utils-clips-public` store (stable clip URLs). Uses `BLOB_READ_WRITE_TOKEN` from that connection. */
export function publicClipsStoreConfigured() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

/**
 * Token for the public store. Pass it explicitly: without it the SDK prefers OIDC + `BLOB_STORE_ID`,
 * which is the private uploads store.
 */
export function publicBlobToken() {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    throw new Error(
      "Connect the media-utils-clips-public Blob store to this project (BLOB_READ_WRITE_TOKEN).",
    );
  }
  return token;
}

export async function putPublicClip(pathname: string, body: Buffer, contentType: string) {
  return put(pathname, body, { access: "public", contentType, token: publicBlobToken() });
}

export type StoredImage = {
  url: string;
  pathname: string;
  name: string;
  label: string | null;
  tag: string | null;
  size: number;
  uploadedAt: string;
};

export type StoredClip = {
  url: string;
  pathname: string;
  name: string;
  label: string | null;
  size: number;
  uploadedAt: string;
};

const LIST_PAGE_LIMIT = 1000;
const MAX_LIST_PAGES = 5;

/** Newest first. Stops after a few list pages; `hasMore` says whether older images were left out. */
export async function listPublicImages(): Promise<{ images: StoredImage[]; hasMore: boolean }> {
  const token = publicBlobToken();
  const blobs: ListBlobResultBlob[] = [];
  let cursor: string | undefined;
  let hasMore = false;
  for (let page = 0; page < MAX_LIST_PAGES; page++) {
    const result = await list({ prefix: IMAGE_PREFIX, limit: LIST_PAGE_LIMIT, cursor, token });
    blobs.push(...result.blobs);
    hasMore = result.hasMore;
    cursor = result.cursor;
    if (!hasMore) break;
  }

  const labels = new Map<string, string>();
  const tags = new Map<string, string>();
  for (const b of blobs) {
    const label = labelFromSidecar(b.pathname);
    if (label) labels.set(assetFolder(b.pathname), label);
    const tag = tagFromSidecar(b.pathname);
    if (tag) tags.set(assetFolder(b.pathname), tag);
  }
  const images = blobs
    .filter((b) => isImagePathname(b.pathname))
    .map((b) => ({
      url: b.url,
      pathname: b.pathname,
      name: imageDisplayName(b.pathname),
      label: labels.get(assetFolder(b.pathname)) ?? null,
      tag: tags.get(assetFolder(b.pathname)) ?? null,
      size: b.size,
      uploadedAt: new Date(b.uploadedAt).toISOString(),
    }))
    .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
  return { images, hasMore };
}

/** Newest first. Stops after a few list pages; `hasMore` says whether older clips were left out. */
export async function listPublicClips(): Promise<{ clips: StoredClip[]; hasMore: boolean }> {
  const token = publicBlobToken();
  const blobs: ListBlobResultBlob[] = [];
  let cursor: string | undefined;
  let hasMore = false;
  for (let page = 0; page < MAX_LIST_PAGES; page++) {
    const result = await list({ prefix: CLIP_PREFIX, limit: LIST_PAGE_LIMIT, cursor, token });
    blobs.push(...result.blobs);
    hasMore = result.hasMore;
    cursor = result.cursor;
    if (!hasMore) break;
  }

  const labels = new Map<string, string>();
  for (const b of blobs) {
    const label = labelFromSidecar(b.pathname);
    if (label) labels.set(assetFolder(b.pathname), label);
  }

  const clips = blobs
    .filter((b) => isClipPathname(b.pathname))
    .map((b) => ({
      url: b.url,
      pathname: b.pathname,
      name: b.pathname.slice(b.pathname.lastIndexOf("/") + 1),
      label: labels.get(assetFolder(b.pathname)) ?? null,
      size: b.size,
      uploadedAt: new Date(b.uploadedAt).toISOString(),
    }))
    .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
  return { clips, hasMore };
}

/** Removes the image and its label and tag sidecars. */
export async function deletePublicImage(pathname: string) {
  if (!isImagePathname(pathname)) throw new Error("Invalid image path");
  const token = publicBlobToken();
  const { blobs } = await list({ prefix: assetFolder(pathname), token });
  const urls = blobs.filter((b) => b.pathname === pathname || isSidecar(b.pathname)).map((b) => b.url);
  await del(urls.length ? urls : pathname, { token });
}

/** Removes the clip and its label sidecars. */
export async function deletePublicClip(pathname: string) {
  if (!isClipPathname(pathname)) throw new Error("Invalid clip path");
  const token = publicBlobToken();
  const { blobs } = await list({ prefix: assetFolder(pathname), token });
  const urls = blobs.filter((b) => b.pathname === pathname || isSidecar(b.pathname)).map((b) => b.url);
  await del(urls.length ? urls : pathname, { token });
}

export function isLabelableAsset(pathname: string) {
  return isImagePathname(pathname) || isClipPathname(pathname);
}

/** Replaces the `kind` sidecar of an asset. Empty text removes it. */
async function setAssetSidecar(kind: SidecarKind, assetPathname: string, raw: unknown) {
  const text = normalizeSidecarText(kind, raw);
  const token = publicBlobToken();
  const { blobs } = await list({ prefix: assetFolder(assetPathname), token });
  const next = text ? sidecarPathname(kind, assetPathname, text) : null;
  const stale = blobs.filter((b) => isSidecar(b.pathname, kind) && b.pathname !== next).map((b) => b.url);
  if (next && !blobs.some((b) => b.pathname === next)) {
    await put(next, text, {
      access: "public",
      contentType: "text/plain; charset=utf-8",
      addRandomSuffix: false,
      allowOverwrite: true,
      token,
    });
  }
  if (stale.length) await del(stale, { token });
  return text || null;
}

/** Replaces the label for an image or clip. An empty label removes it. */
export async function setAssetLabel(assetPathname: string, rawLabel: unknown) {
  if (!isLabelableAsset(assetPathname)) throw new Error("Invalid asset path");
  return setAssetSidecar("label", assetPathname, rawLabel);
}

/** Replaces an image's tag (e.g. "Post 1"). An empty tag removes it. */
export async function setImageTag(imagePathname: string, rawTag: unknown) {
  if (!isImagePathname(imagePathname)) throw new Error("Invalid image path");
  return setAssetSidecar("tag", imagePathname, rawTag);
}

/** Short-lived GET link to one private blob. `download` makes the browser save it instead of playing it. */
export async function signedBlobUrl(pathname: string, opts: { ttlMs: number; download?: boolean }) {
  const validUntil = Date.now() + opts.ttlMs;
  const token = await issueSignedToken({ pathname, operations: ["get"], validUntil });
  const { presignedUrl } = await presignUrl(token, { operation: "get", pathname, access: "private" });
  if (!opts.download) return presignedUrl;
  return blobDownloadUrl(presignedUrl);
}
