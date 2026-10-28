import type { Metadata } from "next";
import { AdminShell } from "@/components/admin-shell";
import { FileBrowserApp } from "@/components/file-browser/file-browser-app";
import { getTool } from "@/lib/tools";

const tool = getTool("file-browser");

export const metadata: Metadata = { title: tool.title, description: tool.description };

export default function FileBrowserPage() {
  return (
    <AdminShell title={tool.title} description={tool.description}>
      <FileBrowserApp />
    </AdminShell>
  );
}
