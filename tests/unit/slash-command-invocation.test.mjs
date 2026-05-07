import test from "node:test";
import assert from "node:assert/strict";

import { joinFromRoot, readAllSources } from "../helpers/source-utils.mjs";

const chatProviderSource = readAllSources([
  joinFromRoot("src", "providers", "ChatViewProvider.ts"),
], "ChatViewProvider.ts");

test("leading slash skills are sent as model-visible internal reminders", () => {
  assert.match(
    chatProviderSource,
    /parseSlashSkillInvocation\(/,
    "ChatViewProvider should parse leading slash skill invocations before dispatch",
  );

  assert.match(
    chatProviderSource,
    /<auto-slash-command>[\s\S]*Skill invoked:[\s\S]*Use the skill tool with name=/,
    "slash skills should produce the internal reminder shown as a system message",
  );

  assert.match(
    chatProviderSource,
    /const modelInputText = slashSkillSystemReminder[\s\S]*\$\{slashSkillSystemReminder\}\\n\\n\$\{slashSkillInvocation\?\.request \|\| text\}/,
    "slash skill reminders must be included in the text sent to the model",
  );

  assert.match(
    chatProviderSource,
    /const slashCommandInvocation = slashSkillInvocation[\s\S]*\? null[\s\S]*: await this\.resolveSlashCommandInvocation/,
    "skill matches should take priority over command routing",
  );
});

test("exact slash commands are routed through the OpenCode command endpoint", () => {
  assert.match(
    chatProviderSource,
    /resolveSlashCommandInvocation\(/,
    "ChatViewProvider should resolve exact slash commands",
  );

  assert.match(
    chatProviderSource,
    /client\.session\.command\(\{[\s\S]*command:\s*slashInvocation\.command[\s\S]*arguments:\s*slashInvocation\.arguments/s,
    "exact slash commands should call client.session.command with command and arguments",
  );
});

test("slash command routing does not treat plan control commands as skills", () => {
  assert.match(
    chatProviderSource,
    /if\s*\(\s*this\.planManager\.isPlanProceedMessageText\(trimmed\)\s*\)\s*\{[\s\S]*return null;[\s\S]*\}/,
    "plan proceed commands should keep the existing plan-control send path",
  );
});
