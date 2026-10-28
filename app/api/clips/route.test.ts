import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { labelSidecarPathname } from "@/lib/asset-labels";

const blob = vi.hoisted(() => ({ list: vi.fn(), del: vi.fn() }));

vi.mock("@vercel/blob", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@vercel/blob")>()),
  list: blob.list,
  del: blob.del,
}));

const { GET, DELETE } = await import("@/app/api/clips/route");

const TOKEN = "vercel_blob_rw_StoreAbc_secret";
const HOST = "https://storeabc.public.blob.vercel-storage.com";
const CLIP = "clips/0b7c6f1e-3c9a-4d2e-9f8a-1234567890ab/Musk_4m55s-5m17s.mp4";
const IMAGE = "images/aaaaaaaaaa/_DSC0457.jpg";

function jsonRequest(method: string, body: unknown) {
  return new Request("http://localhost/api/clips", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function stored(pathname: string, uploadedAt = "2026-10-18T00:00:00Z", size = 100) {
  return { url: `${HOST}/${pathname}`, downloadUrl: `${HOST}/${pathname}?download=1`, pathname, size, uploadedAt: new Date(uploadedAt) };
}

beforeEach(() => {
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", TOKEN);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("GET /api/clips", () => {
  it("lists mp4 clips with labels", async () => {
    const sidecar = labelSidecarPathname(CLIP, "Main stage moment");
    blob.list.mockResolvedValue({
      hasMore: false,
      blobs: [stored(CLIP, "2026-10-18T00:00:00Z", 500), stored(sidecar, "2026-10-18T00:00:01Z", 10)],
    });

    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(blob.list).toHaveBeenCalledWith({ prefix: "clips/", limit: 1000, cursor: undefined, token: TOKEN });
    expect(data.clips).toEqual([
      {
        url: `${HOST}/${CLIP}`,
        pathname: CLIP,
        name: "Musk_4m55s-5m17s.mp4",
        label: "Main stage moment",
        size: 500,
        uploadedAt: "2026-10-18T00:00:00.000Z",
      },
    ]);
  });
});

describe("DELETE /api/clips", () => {
  it("deletes the clip and its label from the public store", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const sidecar = labelSidecarPathname(CLIP, "Main stage moment");
    blob.list.mockResolvedValue({ hasMore: false, blobs: [stored(CLIP), stored(sidecar)] });
    blob.del.mockResolvedValue(undefined);
    const res = await DELETE(jsonRequest("DELETE", { pathname: CLIP }));
    expect(res.status).toBe(200);
    expect(blob.list).toHaveBeenCalledWith({ prefix: "clips/0b7c6f1e-3c9a-4d2e-9f8a-1234567890ab/", token: TOKEN });
    expect(blob.del).toHaveBeenCalledWith([`${HOST}/${CLIP}`, `${HOST}/${sidecar}`], { token: TOKEN });
  });

  it("refuses anything that isn't a clip", async () => {
    for (const pathname of [IMAGE, "uploads/source.mp4", "clips/bad/a.mp4", 42]) {
      const res = await DELETE(jsonRequest("DELETE", { pathname }));
      expect(res.status).toBe(400);
    }
    expect(blob.del).not.toHaveBeenCalled();
  });

  it("rejects invalid JSON", async () => {
    expect((await DELETE(new Request("http://localhost", { method: "DELETE", body: "{" }))).status).toBe(400);
  });
});
