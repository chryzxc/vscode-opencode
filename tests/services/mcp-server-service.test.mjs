import assert from "node:assert/strict";
import test from "node:test";

import { joinFromRoot, readSource } from "../helpers/source-utils.mjs";

const service = readSource([joinFromRoot("src", "services", "McpServerService.ts")], "McpServerService.ts");
const provider = readSource([joinFromRoot("src", "providers", "ChatViewProvider.ts")], "ChatViewProvider.ts");

test("managed MCP profiles persist metadata separately from SecretStorage", () => {
  assert.match(service, /opencode\.managedMcpProfiles\.v1/);
  assert.match(service, /context\.secrets\.store/);
  assert.match(service, /environmentKeys/);
  assert.match(service, /headerKeys/);
  const profileSection = service.slice(service.indexOf("export interface ManagedMcpProfile"), service.indexOf("export type ManagedMcpDraft"));
  assert.doesNotMatch(profileSection, /environment\s*:/);
});

test("MCP mutations use the pinned SDK flat parameter shape and refresh status", () => {
  assert.match(service, /client\.mcp\.add\(\{ \...this\.scope\(\{ name: profile\.name \}\), config:/);
  assert.match(service, /mcp\.connect\(this\.scope\(\{ name \}\)\)/);
  assert.match(service, /mcp\.disconnect\(this\.scope\(\{ name \}\)\)/);
  assert.match(provider, /case "addMcpServer"/);
  assert.match(provider, /await this\.handleGetMcpStatus\(\)/);
});

test("status enrichment exposes only safe managed metadata", () => {
  assert.match(provider, /managed: true, profileId: profile\.id, kind: profile\.kind/);
  assert.doesNotMatch(provider, /enrichedServers[\s\S]*environment/);
  assert.doesNotMatch(provider, /enrichedServers[\s\S]*headers/);
});
