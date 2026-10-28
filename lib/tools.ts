import { FolderOpen, ImageUp, LayoutTemplate, RectangleVertical, Scissors, type LucideIcon } from "lucide-react";

export type Tool = {
  slug: string;
  title: string;
  description: string;
  icon: LucideIcon;
};

export type ToolGroup = {
  label: string;
  tools: Tool[];
};

const fileBrowser: Tool = {
  slug: "file-browser",
  title: "File browser",
  description: "Browse recent clips and uploaded images stored in Blob.",
  icon: FolderOpen,
};

const clipper: Tool = {
  slug: "clipper",
  title: "Video clipper",
  description: "Trim videos from a URL or upload, export clips, and transcribe selections.",
  icon: Scissors,
};

const reframe: Tool = {
  slug: "reframe",
  title: "Vertical reframe",
  description: "Turn landscape video into 9:16 for Reels and Stories, with control over the crop.",
  icon: RectangleVertical,
};

const images: Tool = {
  slug: "images",
  title: "Image uploader",
  description: "Upload images and get public links to share with your team.",
  icon: ImageUp,
};

const socialPostPreview: Tool = {
  slug: "social-post-preview",
  title: "Social Post Preview",
  description: "Assemble Instagram and X posts, preview them, and share a review link with your team.",
  icon: LayoutTemplate,
};

/** Sidebar groups; order is display order within each group. */
export const toolGroups: ToolGroup[] = [
  { label: "Library", tools: [fileBrowser] },
  { label: "Media", tools: [clipper, reframe, images] },
  { label: "Review", tools: [socialPostPreview] },
];

/** Flat list for the dashboard and lookups; follows `toolGroups` order. */
export const tools: Tool[] = toolGroups.flatMap((group) => group.tools);

export function toolHref(tool: Tool) {
  return `/${tool.slug}`;
}

export function getTool(slug: string): Tool {
  const tool = tools.find((t) => t.slug === slug);
  if (!tool) throw new Error(`Unknown tool: ${slug}`);
  return tool;
}
