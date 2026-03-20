/**
 * CLI Commands - mcpm subcommands
 */

import * as p from '@clack/prompts';
import pc from 'picocolors';
import type { AgentType } from '../types.js';
import { listServers, removeServer } from '../registry/index.js';
import { detectInstalledAgents, getAgentConfig, agents, isValidAgentType } from '../agents.js';
import { syncRegistryToAgents, showSyncSummary, detectDuplicates, detectDrift } from '../core/sync.js';
import { runImportMode } from '../core/import.js';
import { runBuildMode } from '../prompts/build.js';
import { isCancel } from '@clack/prompts';
import { injectConfig } from '../core/injector.js';
import type { ParsedMcpConfig, McpServerConfig } from '../types.js';

/** Parsed CLI flags shared across commands */
export interface CliFlags {
    yes: boolean;           // -y, --yes: skip confirmations
    json: boolean;          // --json: machine-readable JSON output
    quiet: boolean;         // -q, --quiet: minimal output
    agents: AgentType[];    // --agent:<name>: target specific agents
    scope: 'global' | 'project';  // --scope:global|project
    allAgents: boolean;     // -a: all agents
}

/**
 * Parse standard CLI flags from args array.
 * Returns parsed flags and remaining positional args.
 */
export function parseFlags(args: string[]): { flags: CliFlags; positional: string[] } {
    const flags: CliFlags = {
        yes: false,
        json: false,
        quiet: false,
        agents: [],
        scope: 'global',
        allAgents: false,
    };
    const positional: string[] = [];

    for (const arg of args) {
        if (arg === '-y' || arg === '--yes') {
            flags.yes = true;
        } else if (arg === '--json') {
            flags.json = true;
            flags.quiet = true; // JSON mode implies quiet
        } else if (arg === '-q' || arg === '--quiet') {
            flags.quiet = true;
        } else if (arg === '-a' || arg === '--all') {
            flags.allAgents = true;
        } else if (arg.startsWith('--agent:')) {
            const name = arg.slice('--agent:'.length);
            if (name === 'all') {
                flags.allAgents = true;
            } else if (isValidAgentType(name)) {
                flags.agents.push(name);
            }
        } else if (arg.startsWith('--scope:')) {
            const val = arg.slice('--scope:'.length);
            if (val === 'global' || val === 'project') {
                flags.scope = val;
            }
        } else {
            positional.push(arg);
        }
    }

    return { flags, positional };
}

/**
 * mcpm list - Show all servers in registry
 */
export async function cmdList(flags: CliFlags): Promise<void> {
    const servers = listServers();

    if (flags.json) {
        const output = servers.map(s => ({
            name: s.name,
            transport: s.transport,
            command: s.command,
            args: s.args,
            url: s.url,
            envCount: s.env ? Object.keys(s.env).length : 0,
        }));
        console.log(JSON.stringify(output, null, 2));
        return;
    }

    if (servers.length === 0) {
        p.log.info('No servers in registry. Run `mcpm add` to add one.');
        return;
    }

    p.log.info(`Registry (${servers.length} server${servers.length > 1 ? 's' : ''}):`);

    for (const server of servers) {
        const value = server.transport === 'stdio'
            ? `${server.command} ${server.args?.join(' ') || ''}`
            : server.url;

        console.log(`  ${server.name} (${server.transport})`);
        console.log(`    ${value}`);

        if (server.env && Object.keys(server.env).length > 0) {
            const envCount = Object.keys(server.env).length;
            console.log(`    ${envCount} env var${envCount > 1 ? 's' : ''}`);
        }
    }
}

/**
 * mcpm add - Add a new server interactively
 */
export async function cmdAdd(): Promise<void> {
    const result = await runBuildMode();

    if (result) {
        p.log.success(`Server "${result.server.name}" added to registry`);

        const sync = await p.confirm({
            message: 'Sync to installed agents now?',
            initialValue: true,
        });

        if (!isCancel(sync) && sync) {
            await cmdSync(
                { yes: true, json: false, quiet: false, agents: [], scope: 'global', allAgents: false },
                [result.server.name]
            );
        }
    }
}

/**
 * mcpm remove - Remove server(s) from registry and agents
 *
 * Non-interactive with -y: removes named servers without confirmation
 * With --agent:<name>: also removes from specific agent configs
 */
export async function cmdRemove(flags: CliFlags, serverNames: string[]): Promise<void> {
    const servers = listServers();

    if (servers.length === 0) {
        if (flags.json) {
            console.log(JSON.stringify({ success: false, error: 'No servers in registry' }));
        } else {
            p.log.warn('No servers in registry');
        }
        return;
    }

    let namesToRemove = serverNames;

    // If no server names given and not auto mode, prompt
    if (namesToRemove.length === 0 && !flags.yes) {
        const selected = await p.select({
            message: 'Select server to remove',
            options: servers.map(s => ({
                value: s.name,
                label: s.name,
                hint: s.transport,
            })),
        });

        if (isCancel(selected)) return;
        namesToRemove = [selected];
    }

    if (namesToRemove.length === 0) {
        if (flags.json) {
            console.log(JSON.stringify({ success: false, error: 'No server name specified' }));
        } else {
            p.log.error('No server name specified. Usage: mcpm rm <name> -y');
        }
        return;
    }

    // Validate server names exist
    const validNames = namesToRemove.filter(n => servers.some(s => s.name === n));
    const invalidNames = namesToRemove.filter(n => !servers.some(s => s.name === n));

    if (invalidNames.length > 0 && !flags.quiet) {
        p.log.warn(`Unknown server(s): ${invalidNames.join(', ')}`);
    }

    // Skip confirmation if -y flag
    if (!flags.yes) {
        const confirm = await p.confirm({
            message: pc.red(`Remove "${validNames.join(', ')}" from registry?`),
            initialValue: false,
        });

        if (isCancel(confirm) || !confirm) {
            p.log.info('Not removed');
            return;
        }
    }

    const results: { name: string; registry: boolean; agents: string[] }[] = [];

    for (const name of validNames) {
        const removed = removeServer(name);
        const agentsRemoved: string[] = [];

        // Also remove from targeted agents if specified
        const targetAgents = flags.allAgents
            ? detectInstalledAgents()
            : flags.agents;

        if (targetAgents.length > 0) {
            for (const agentType of targetAgents) {
                const count = await removeFromAgentConfig(agentType, [name]);
                if (count > 0) agentsRemoved.push(getAgentConfig(agentType).displayName);
            }
        }

        results.push({ name, registry: removed, agents: agentsRemoved });
    }

    if (flags.json) {
        console.log(JSON.stringify({ success: true, removed: results }));
        return;
    }

    for (const r of results) {
        if (r.registry) {
            p.log.success(`Removed "${r.name}" from registry`);
        }
        if (r.agents.length > 0) {
            p.log.success(`Removed "${r.name}" from: ${r.agents.join(', ')}`);
        }
    }

    if (targetAgentsEmpty(flags)) {
        p.log.info('Note: Server configs in agents are preserved. Use --agent:<name> or -a to also remove from agents.');
    }
}

function targetAgentsEmpty(flags: CliFlags): boolean {
    return !flags.allAgents && flags.agents.length === 0;
}

/**
 * Remove servers from an agent's config file
 */
async function removeFromAgentConfig(agentType: AgentType, serverNames: string[]): Promise<number> {
    const { existsSync, readFileSync, writeFileSync } = await import('node:fs');
    const config = getAgentConfig(agentType);
    const configPath = config.mcpConfigPath;

    if (!configPath || !existsSync(configPath)) return 0;

    try {
        const content = readFileSync(configPath, 'utf-8');
        const parsed = JSON.parse(content);
        const serversObj = parsed[config.wrapperKey] || {};

        let removed = 0;
        for (const name of serverNames) {
            if (serversObj[name]) { delete serversObj[name]; removed++; }
            const mcpmName = `mcpm_${name}`;
            if (serversObj[mcpmName]) { delete serversObj[mcpmName]; removed++; }
            // Also check legacy mcpm- prefix
            const legacyName = `mcpm-${name}`;
            if (serversObj[legacyName]) { delete serversObj[legacyName]; removed++; }
        }

        if (removed > 0) {
            parsed[config.wrapperKey] = serversObj;
            writeFileSync(configPath, JSON.stringify(parsed, null, 2) + '\n');
        }

        return removed;
    } catch {
        return 0;
    }
}

/**
 * mcpm sync - Sync registry servers to agent configs
 *
 * Non-interactive: syncs all/named servers to all/targeted agents
 * Flags: -y (auto-confirm overrides), --agent:<name>, -a (all agents), --json
 */
export async function cmdSync(flags: CliFlags, serverNames?: string[]): Promise<void> {
    const installedAgents = detectInstalledAgents();

    if (installedAgents.length === 0) {
        if (flags.json) {
            console.log(JSON.stringify({ success: false, error: 'No agents detected' }));
        } else {
            p.log.warn('No agents detected');
        }
        return;
    }

    const servers = listServers();
    if (servers.length === 0) {
        if (flags.json) {
            console.log(JSON.stringify({ success: false, error: 'No servers in registry' }));
        } else {
            p.log.warn('No servers in registry to sync');
        }
        return;
    }

    const toSync = serverNames && serverNames.length > 0
        ? servers.filter(s => serverNames.includes(s.name))
        : servers;

    if (toSync.length === 0) {
        if (flags.json) {
            console.log(JSON.stringify({ success: false, error: `No matching servers: ${serverNames?.join(', ')}` }));
        } else {
            p.log.warn(`No matching servers: ${serverNames?.join(', ')}`);
        }
        return;
    }

    // Determine target agents
    let targetAgents = flags.allAgents || flags.agents.length === 0
        ? installedAgents
        : flags.agents.filter(a => installedAgents.includes(a));

    if (!flags.quiet) {
        p.log.info(`Syncing ${toSync.length} server(s) to ${targetAgents.length} agent(s)...`);
    }

    // Build results by injecting directly (non-interactive)
    const results: { agent: string; agentType: AgentType; servers: { name: string; status: 'added' | 'skipped' | 'error'; error?: string }[] }[] = [];

    for (const agentType of targetAgents) {
        const agentConfig = getAgentConfig(agentType);
        const serverResults: { name: string; status: 'added' | 'skipped' | 'error'; error?: string }[] = [];

        for (const server of toSync) {
            try {
                // Convert to config format
                const serverConfig: McpServerConfig = server.transport === 'stdio'
                    ? { type: 'stdio', command: server.command, args: server.args, env: server.env as Record<string, string> }
                    : { type: server.transport, url: server.url, headers: server.headers };

                const parsedConfig: ParsedMcpConfig = {
                    servers: { [server.name]: serverConfig },
                    sourceFormat: 'json',
                    sourceWrapperKey: 'mcpServers',
                };

                await injectConfig(agentType, parsedConfig);
                serverResults.push({ name: server.name, status: 'added' });
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                serverResults.push({ name: server.name, status: 'error', error: msg });
            }
        }

        results.push({ agent: agentConfig.displayName, agentType, servers: serverResults });
    }

    // Output
    if (flags.json) {
        console.log(JSON.stringify({
            success: true,
            results: results.map(r => ({
                agent: r.agent,
                agentType: r.agentType,
                servers: r.servers,
            })),
        }, null, 2));
        return;
    }

    if (!flags.quiet) {
        for (const r of results) {
            const added = r.servers.filter(s => s.status === 'added');
            const skipped = r.servers.filter(s => s.status === 'skipped');
            const errors = r.servers.filter(s => s.status === 'error');

            p.log.info(`${pc.bold(r.agent)}:`);
            for (const s of added) {
                p.log.success(`  Added: ${s.name}`);
            }
            for (const s of skipped) {
                p.log.info(`  Skipped: ${s.name}`);
            }
            for (const s of errors) {
                p.log.error(`  Error: ${s.name} — ${s.error}`);
            }
        }
    }
}

/**
 * mcpm status - Show sync status and drift
 */
export async function cmdStatus(flags: CliFlags): Promise<void> {
    const installedAgents = detectInstalledAgents();
    const servers = listServers();

    const duplicates = await detectDuplicates(installedAgents);
    const drift = await detectDrift(installedAgents);

    if (flags.json) {
        console.log(JSON.stringify({
            registry: { count: servers.length, servers: servers.map(s => s.name) },
            agents: { count: installedAgents.length, installed: installedAgents },
            conflicts: Object.fromEntries(
                Array.from(duplicates.entries()).map(([a, c]) => [a, c.map(x => x.serverName)])
            ),
            drift: Object.fromEntries(drift.entries()),
            inSync: duplicates.size === 0 && drift.size === 0,
        }, null, 2));
        return;
    }

    p.log.info('Registry:');
    p.log.info(`  ${servers.length} server(s)`);

    p.log.info('Agents:');
    p.log.info(`  ${installedAgents.length} detected`);

    if (duplicates.size > 0) {
        p.log.warn(pc.yellow('Conflicts:'));
        for (const [agent, conflicts] of duplicates) {
            const agentName = getAgentConfig(agent).displayName;
            p.log.warn(`  ${agentName}: ${conflicts.map(c => c.serverName).join(', ')}`);
        }
    }

    if (drift.size > 0) {
        p.log.warn(pc.yellow('Drift (config mismatch):'));
        for (const [agent, drifted] of drift) {
            const agentName = getAgentConfig(agent).displayName;
            p.log.warn(`  ${agentName}: ${drifted.join(', ')}`);
        }
    }

    if (duplicates.size === 0 && drift.size === 0) {
        p.log.success('All agents in sync');
    }
}

/**
 * Run CLI command
 */
export async function runCommand(command: string, args: string[]): Promise<boolean> {
    const { flags, positional } = parseFlags(args);

    switch (command) {
        case 'list':
        case 'ls':
            await cmdList(flags);
            return true;

        case 'add':
            await cmdAdd();
            return true;

        case 'remove':
        case 'rm':
            await cmdRemove(flags, positional);
            return true;

        case 'sync':
            await cmdSync(flags, positional.length > 0 ? positional : undefined);
            return true;

        case 'status':
            await cmdStatus(flags);
            return true;

        case 'import':
            await runImportMode();
            return true;

        case 'help':
        case '--help':
        case '-h':
            showHelp();
            return true;

        default:
            return false;
    }
}

/**
 * Show help text
 */
function showHelp(): void {
    console.log(`
mcpm - MCP Manager v${process.env.npm_package_version || ''}

Manage MCP servers across AI coding agents (Claude Code, Cursor, Windsurf, etc.)

Usage:
  mcpm                              Interactive menu
  mcpm <command> [options]           Run a command

Commands:
  list, ls                           List servers in registry
  add                                Add a new server interactively
  remove, rm <name> [options]        Remove server(s) from registry/agents
  sync [servers...] [options]        Sync registry to agent configs
  status                             Show sync status and drift
  import                             Import servers from agent configs
  help                               Show this help

Global Options:
  -y, --yes                          Skip all confirmations (non-interactive)
  -a, --all                          Target all installed agents
  --agent:<name>                     Target specific agent (repeatable)
  --scope:global|project             Installation scope (default: global)
  --json                             Machine-readable JSON output
  -q, --quiet                        Minimal output

Install Options (with JSON/URL input):
  --env:KEY=VALUE                    Pre-configure environment variable
  --header:KEY=VALUE                 Pre-configure HTTP header
  --note:"text"                      Add annotation

Examples:
  # List servers in registry
  mcpm ls
  mcpm ls --json

  # Sync all servers to all agents (non-interactive)
  mcpm sync -y

  # Sync specific server to Claude Code only
  mcpm sync my-server --agent:claude-code

  # Remove server from registry and all agents
  mcpm rm my-server -y -a

  # Install from JSON config to Claude Code
  mcpm '{"mcpServers":{"my-server":{"command":"npx","args":["-y","my-pkg"]}}}' -y --agent:claude-code

  # Check sync status as JSON
  mcpm status --json

Supported Agents:
  claude-code, claude-desktop, cursor, windsurf, cline, roo, codex,
  vscode-copilot, gemini-cli, amp, goose, opencode, amazon-q, cody,
  continue, droid, github-copilot, jetbrains-ai, antigravity, zed
`);
}
