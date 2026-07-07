export const FALLBACK_ICON_COLOR = "#6e7681";

export function cleanFileIconKey(key: string): string {
  return key
    .replace(/\./g, "-")
    .replace(/\//g, "-")
    .replace(/\+/g, "p")
    .replace(/#/g, "h")
    .replace(/,/g, "");
}

export function getFileIconKeys(filePath?: string): string[] {
  if (!filePath) {
    return [];
  }

  const fileName = (filePath.split(/[\\/]/).pop() || "").split(":")[0].toLowerCase();
  if (!fileName) {
    return [];
  }

  const parts = fileName.split(".");
  const baseName = parts.length > 1 ? parts[0] : fileName;
  const extensionKeys =
    parts.length > 1
      ? parts
          .slice(1)
          .map((_, index) => parts.slice(index + 1).join("."))
          .reverse()
      : [];
  const aliasKeys = new Set<string>();

  const addAlias = (...values: Array<string | undefined>) => {
    for (const value of values) {
      if (value) {
        aliasKeys.add(value);
      }
    }
  };

  for (const candidate of [fileName, baseName, ...extensionKeys]) {
    switch (candidate) {
      case "md":
      case "mdx":
        addAlias("markdown", "md");
        break;
      case "tsx":
        addAlias("typescriptreact", "tsx");
        break;
      case "jsx":
        addAlias("javascriptreact", "jsx");
        break;
      case "js":
      case "mjs":
      case "cjs":
        addAlias("javascript", candidate);
        break;
      case "ts":
      case "cts":
      case "mts":
        addAlias("typescript", candidate);
        break;
      case "yml":
      case "yaml":
        addAlias("yaml", "yml");
        break;
      case "json":
      case "jsonc":
        addAlias("json", "jsonc");
        break;
      default:
        break;
    }
  }

  return Array.from(
    new Set([fileName, baseName, ...extensionKeys, ...aliasKeys].filter(Boolean)),
  );
}

export function isDirectoryPath(filePath?: string, explicitIsDirectory = false): boolean {
  if (explicitIsDirectory) {
    return true;
  }

  if (!filePath) {
    return false;
  }

  return /[\\/]$/.test(filePath.trim());
}

const KNOWN_EXTENSIONLESS_FILES = new Set([
  "makefile",
  "dockerfile",
  "readme",
  "readme.md",
  "readme.txt",
  "license",
  "copying",
  "changelog",
  "contributors",
  ".gitignore",
  ".npmignore",
  ".dockerignore",
  ".env",
]);

export function isLikelyDirectoryPath(filePath?: string): boolean {
  if (!filePath) {
    return false;
  }

  const normalized = filePath.trim();
  if (!normalized || isDirectoryPath(normalized)) {
    return isDirectoryPath(normalized);
  }

  const parts = normalized.split(/[\\/]/);
  const leaf = (parts.pop() || "").split(":")[0].toLowerCase();
  if (!leaf) {
    return false;
  }

  if (KNOWN_EXTENSIONLESS_FILES.has(leaf)) {
    return false;
  }

  return parts.length > 0 && !leaf.includes(".");
}

export function getFileIconThemeClasses(params: {
  filePath?: string;
  isDirectory?: boolean;
  useGenericFileIcon?: boolean;
}): string[] {
  const { filePath, isDirectory = false, useGenericFileIcon = false } = params;
  if (isDirectoryPath(filePath, isDirectory)) {
    return ["file-icon-type-folder"];
  }

  if (useGenericFileIcon || !filePath) {
    return ["file-icon-type-file"];
  }

  return getFileIconKeys(filePath).map((key) => `file-icon-type-${cleanFileIconKey(key)}`);
}

export function getFileIconFallbackKind(params: {
  filePath?: string;
  isDirectory?: boolean;
}): "file" | "folder" {
  return isDirectoryPath(params.filePath, params.isDirectory) ? "folder" : "file";
}

export function hasThemeIcon(element: HTMLElement): boolean {
  const before = window.getComputedStyle(element, "::before");
  const content = before.getPropertyValue("content");
  const backgroundImage = before.getPropertyValue("background-image");

  return (
    (!!content && content !== "none" && content !== "normal" && content !== '""') ||
    (!!backgroundImage && backgroundImage !== "none")
  );
}

export function makeFileIconSvgMarkup(kind: "file" | "folder"): string {
  if (kind === "folder") {
    return (
      '<svg class="file-icon-svg" viewBox="0 0 16 16" width="16" height="16" fill="none" xmlns="http://www.w3.org/2000/svg">' +
      `<path d="M1.5 3.5h4.25l1.5 1.5h7.25v8.5H1.5V3.5Z" fill="${FALLBACK_ICON_COLOR}" opacity="0.18"/>` +
      `<path d="M1.5 3.5h4.25l1.5 1.5h7.25v8.5H1.5V3.5Z" stroke="${FALLBACK_ICON_COLOR}" stroke-width="1.2" stroke-linejoin="round"/>` +
      "</svg>"
    );
  }

  return (
    '<svg class="file-icon-svg" viewBox="0 0 16 16" width="16" height="16" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    `<path d="M3.5 1.75h6.25L13 5v9.25H3.5V1.75Z" fill="${FALLBACK_ICON_COLOR}" opacity="0.18"/>` +
    `<path d="M9.5 1.75V5.25H13M3.5 1.75h6.25L13 5v9.25H3.5V1.75Z" stroke="${FALLBACK_ICON_COLOR}" stroke-width="1.2" stroke-linejoin="round"/>` +
    "</svg>"
  );
}
