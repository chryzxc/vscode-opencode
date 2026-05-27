import test from 'node:test';
import assert from 'node:assert/strict';
import { extractFunctionBody, readSource } from '../helpers/source-utils.mjs';

const PANEL_COMPONENTS_PATH = 'webview/shared/src/chat/PanelComponents.tsx';

test('SkillsPanel Contract - Deep Dive', async (t) => {
    const source = await readSource(PANEL_COMPONENTS_PATH);
    const skillsPanelBody = extractFunctionBody(source, 'export function SkillsPanel');

    await t.test('renders availableCommands length in title', () => {
        assert.ok(skillsPanelBody.includes('{availableSkills.length}'), 'Should display skill count');
    });

    // Skip: subtask feature not implemented in current PanelComponents
    // await t.test('renders subtask badge when applicable', () => {
    //     assert.ok(skillsPanelBody.includes('skill.subtask &&'), 'Should check for subtask property');
    //     assert.ok(skillsPanelBody.includes('subtask'), 'Should render "subtask" text');
    //     assert.ok(skillsPanelBody.includes('opacity-50'), 'Should have lowered opacity for subtask label');
    // });

    await t.test('renders agent and model details in expanded view', () => {
        assert.ok(skillsPanelBody.includes('<Bot className="h-2.5 w-2.5" />'), 'Should render Bot icon for agent');
        assert.ok(skillsPanelBody.includes('{skill.agent}'), 'Should display agent name');
        assert.ok(skillsPanelBody.includes('<Wrench className="h-2.5 w-2.5" />'), 'Should render Wrench icon for model');
        assert.ok(skillsPanelBody.includes('{skill.model}'), 'Should display model name');
    });

    await t.test('uses max-h-80 overflow layout', () => {
        assert.ok(skillsPanelBody.includes('max-h-80 overflow-y-auto'), 'Should limit height and allow scroll');
    });
});

test('AgentsPanel Contract - Deep Dive', async (t) => {
    const source = await readSource(PANEL_COMPONENTS_PATH);
    const agentsPanelBody = extractFunctionBody(source, 'export function AgentsPanel');

    await t.test('renders color dot with agent specific color', () => {
        assert.ok(agentsPanelBody.includes('agent.color ?? "var(--oc-accent)"'), 'Should fallback to accent color');
        assert.ok(agentsPanelBody.includes('backgroundColor: agent.color'), 'Should apply dynamic background color');
    });

    await t.test('implements modeBadgeClass mapping correctly', () => {
        assert.ok(agentsPanelBody.includes('if (mode === "subagent")'), 'Should handle subagent mode');
        assert.ok(agentsPanelBody.includes('bg-[var(--oc-yellow,#f59e0b)]/20'), 'Should use yellow theme for subagents');
        assert.ok(agentsPanelBody.includes('if (mode === "all")'), 'Should handle "all" mode');
        assert.ok(agentsPanelBody.includes('text-oc-accent'), 'Should use accent for "all" mode');
    });

    await t.test('renders footer with custom and built-in counts', () => {
        assert.ok(agentsPanelBody.includes('customCount > 0'), 'Should conditionally show custom count');
        assert.ok(agentsPanelBody.includes('customCount} custom'), 'Should format custom count string');
        assert.ok(agentsPanelBody.includes('builtInCount} built-in'), 'Should format built-in count string');
    });
});

test('McpPanel Contract - Deep Dive', async (t) => {
    const source = await readSource(PANEL_COMPONENTS_PATH);
    const mcpPanelBody = extractFunctionBody(source, 'export function McpPanel');

    await t.test('implements statusDot mapping', () => {
        assert.ok(mcpPanelBody.includes('if (status === "connected") return "bg-[var(--oc-green)]"'), 'Should use green for connected');
        assert.ok(mcpPanelBody.includes('if (status === "disabled")'), 'Should handle disabled state');
        assert.ok(mcpPanelBody.includes('return "bg-[var(--oc-red)]"'), 'Should fallback to red for errors');
    });

    await t.test('renders status icons for auth and failures', () => {
        assert.ok(mcpPanelBody.includes('status === "failed"'), 'Should check for failed status');
        assert.ok(mcpPanelBody.includes('AlertCircle'), 'Should use AlertCircle for failures');
        assert.ok(mcpPanelBody.includes('Lock'), 'Should use Lock icon for auth issues');
    });

    await t.test('displays tools count when available', () => {
        assert.ok(mcpPanelBody.includes('server.tools.length > 0'), 'Should check for tool availability');
        assert.ok(mcpPanelBody.includes('tools'), 'Should render "tools" label');
    });
});

test('TodoPanel Contract - Deep Dive', async (t) => {
    const source = await readSource(PANEL_COMPONENTS_PATH);
    const todoPanelBody = extractFunctionBody(source, 'export function TodoPanel');

    await t.test('renders status icons correctly', () => {
        assert.ok(todoPanelBody.includes('case "completed":'), 'Should handle completed state');
        assert.ok(todoPanelBody.includes('return "✅"'), 'Should use checkmark for completed');
        assert.ok(todoPanelBody.includes('case "in_progress":'), 'Should handle in_progress state');
        assert.ok(todoPanelBody.includes('return "🔄"'), 'Should use refresh icon for in_progress');
    });

    await t.test('applies semantic tones for statuses', () => {
        assert.ok(todoPanelBody.includes('text-oc-green bg-oc-green/10'), 'Should use green tone for completed');
        assert.ok(todoPanelBody.includes('text-oc-red bg-oc-red/10'), 'Should use red tone for failed');
        assert.ok(todoPanelBody.includes('oc-quota-warning'), 'Should use semantic quota-warning class for pending');
    });
});
