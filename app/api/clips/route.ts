import { deletePublicClip, listPublicClips, publicClipsStoreConfigured } from "@/lib/blob";
import { isClipPathname } from "@/lib/asset-labels";

export const runtime = "nodejs";

const NOT_CONFIGURED = { error: "Connect the media-utils-clips-public Blob store to list clips." };

export async function GET() {
  if (!publicClipsStoreConfigured()) {
    return Response.json(NOT_CONFIGURED, { status: 501 });
  }
  return Response.json(await listPublicClips());
}

export async function DELETE(req: Request) {
  if (!publicClipsStoreConfigured()) return Response.json(NOT_CONFIGURED, { status: 501 });

  let pathname: unknown;
  try {
    ({ pathname } = (await req.json()) as { pathname?: unknown });
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (typeof pathname !== "string" || !isClipPathname(pathname)) {
    return Response.json({ error: "Invalid clip path" }, { status: 400 });
  }

  try {
    await deletePublicClip(pathname);
    console.info("clip deleted", { pathname });
    return Response.json({ ok: true });
  } catch (e) {
    console.error("delete clip failed", e instanceof Error ? e.message : e);
    return Response.json({ error: "Couldn't delete that clip. Try again." }, { status: 500 });
  }
}
