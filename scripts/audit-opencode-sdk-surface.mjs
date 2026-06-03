import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const pkgPath = path.join(root, "node_modules", "@opencode-ai", "sdk", "package.json");
const typesPath = path.join(root, "node_modules", "@opencode-ai", "sdk", "dist", "gen", "types.gen.d.ts");
const v2TypesPath = path.join(root, "node_modules", "@opencode-ai", "sdk", "dist", "v2", "gen", "types.gen.d.ts");

function readIfExists(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
}

const sdkPkg = JSON.parse(readIfExists(pkgPath) || "{}");
const sources = [
  ["gen", readIfExists(typesPath)],
  ["v2", readIfExists(v2TypesPath)],
];

const names = [
  "EventMessagePartDelta",
  "EventMessagePartUpdated",
  "SyncEventMessagePartUpdated",
  "EventPermissionAsked",
  "EventPermissionReplied",
  "EventQuestionAsked",
  "EventQuestionReplied",
  "EventMessageUpdated",
  "ToolPart",
  "StepStartPart",
  "StepFinishPart",
  "Part",
];

const report = {
  generatedAt: new Date().toISOString(),
  sdkVersion: sdkPkg.version || "unknown",
  exports: sdkPkg.exports || {},
  surfaces: {},
};

for (const [label, source] of sources) {
  report.surfaces[label] = {};
  for (const name of names) {
    const pattern = new RegExp(`export type ${name} = \\\\{[\\\\s\\\\S]*?\\\\n\\\\};`);
    const match = source.match(pattern);
    report.surfaces[label][name] = match ? match[0] : null;
  }
}

console.log(JSON.stringify(report, null, 2));
