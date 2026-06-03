import * as fs from "fs";
import * as path from "path";

export type CompatibilityStatus = "supported" | "untested" | "unknown";

export interface CompatibilityResult {
  status: CompatibilityStatus;
  component: "sdk" | "server";
  version?: string;
  supportedRange: string;
  policy: "warn";
  message: string;
}

export const OPENCODE_COMPATIBILITY = {
  extensionVersion: "0.1.14",
  sdk: {
    package: "@opencode-ai/sdk",
    supportedRange: ">=1.15.12 <1.16.0",
    testedVersions: ["1.15.12", "1.15.13"],
  },
  server: {
    supportedRange: ">=1.15.0 <1.16.0",
    testedVersions: ["1.15.12", "1.15.13"],
  },
  policy: "warn" as const,
};

function parseVersion(value: string | undefined): [number, number, number] | undefined {
  if (!value) return undefined;
  const match = value.trim().match(/^v?(\d+)\.(\d+)\.(\d+)/);
  if (!match) return undefined;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareVersions(a: [number, number, number], b: [number, number, number]): number {
  for (let index = 0; index < 3; index += 1) {
    if (a[index] > b[index]) return 1;
    if (a[index] < b[index]) return -1;
  }
  return 0;
}

function isInSupportedRange(version: string | undefined, range: string): boolean | undefined {
  const parsed = parseVersion(version);
  if (!parsed) return undefined;
  const lower = range.match(/>=([0-9]+\.[0-9]+\.[0-9]+)/)?.[1];
  const upper = range.match(/<([0-9]+\.[0-9]+\.[0-9]+)/)?.[1];
  const lowerParsed = parseVersion(lower);
  const upperParsed = parseVersion(upper);
  if (lowerParsed && compareVersions(parsed, lowerParsed) < 0) return false;
  if (upperParsed && compareVersions(parsed, upperParsed) >= 0) return false;
  return true;
}

function buildResult(
  component: "sdk" | "server",
  version: string | undefined,
  supportedRange: string,
): CompatibilityResult {
  const inRange = isInSupportedRange(version, supportedRange);
  if (inRange === undefined) {
    return {
      status: "unknown",
      component,
      version,
      supportedRange,
      policy: "warn",
      message: `Unable to determine OpenCode ${component} compatibility for version ${version || "<unknown>"}.`,
    };
  }

  if (inRange) {
    return {
      status: "supported",
      component,
      version,
      supportedRange,
      policy: "warn",
      message: `OpenCode ${component} ${version} is within supported range ${supportedRange}.`,
    };
  }

  return {
    status: "untested",
    component,
    version,
    supportedRange,
    policy: "warn",
    message: `OpenCode ${component} ${version} is outside supported range ${supportedRange}; extension ${OPENCODE_COMPATIBILITY.extensionVersion} may need an SDK parity update.`,
  };
}

export function checkOpencodeSdkVersion(version: string | undefined): CompatibilityResult {
  return buildResult("sdk", version, OPENCODE_COMPATIBILITY.sdk.supportedRange);
}

export function checkOpencodeServerVersion(version: string | undefined): CompatibilityResult {
  return buildResult("server", version, OPENCODE_COMPATIBILITY.server.supportedRange);
}

export function detectInstalledOpencodeSdkVersion(): string | undefined {
  const roots = [__dirname, process.cwd()];
  const candidates = new Set<string>();

  for (const root of roots) {
    let current = root;
    for (let depth = 0; depth < 8; depth += 1) {
      candidates.add(
        path.resolve(current, "node_modules", "@opencode-ai", "sdk", "package.json"),
      );
      const parent = path.dirname(current);
      if (parent === current) {
        break;
      }
      current = parent;
    }
  }

  for (const packagePath of candidates) {
    if (!fs.existsSync(packagePath)) {
      continue;
    }
    try {
      const raw = fs.readFileSync(packagePath, "utf8");
      const pkg = JSON.parse(raw) as { version?: string };
      if (typeof pkg.version === "string" && pkg.version.trim()) {
        return pkg.version.trim();
      }
    } catch {
      // Keep searching other candidate paths.
    }
  }

  return undefined;
}
