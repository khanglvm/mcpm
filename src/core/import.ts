/**
 * Import - Import servers from agent configs into registry
 */

import * as p from '@clack/prompts';
import pc from 'picocolors';
import type { AgentType } from '../types.js';
import type { RegistryServer, TransportType } from '../registry/types.js';
import { addServer, serverExists, loadRegistry } from '../registry/index.js';
import { hasPrefix, removePrefix } from '../registry/naming.js';
import { createParser } from '../parsers/factory.js';
import { getAgentConfig, detectInstalledAgents } from '../agents.js';
import { isCancel } from '@clack/prompts';

/**
 * Conflict resolution for import
 */
export type ImportConflictStrategy = 'replace' | 'skip' | 'rename';

/**
 * Imported server info
 */
export interface ImportedServer {
    name: string;
    originalName: string;
    fromAgent: AgentType;
    server: RegistryServer;
}

/**
 * Import result
 */
export interface ImportResult {
    imported: ImportedServer[];
    skipped: string[];
    errors: string[];
}

/**
 * Extract MCP servers from an agent config
 */
export async function extractServersFromAgent(agentType: AgentType): Promise<Map<string, Record<string, unknown>>> {
    const parser = createParser(agentType);
    const config = await parser.read();

    if (!config || !config.servers) {
        return new Map();
    }

    const servers = new Map<string, Record<string, unknown>>();

    for (const [name, serverConfig] of Object.entries(config.servers)) {
        servers.set(name, serverConfig as Record<string, unknown>);
    }

    return servers;
}

/**
 * Convert agent MCP config to registry server format
 */
export function configToRegistryServer(
    name: string,
    config: Record<string, unknown>,
    fromAgent: AgentType
): RegistryServer | null {
    // Determine transport
    let transport: TransportType = 'stdio';

    if (config.url) {
        // HTTP or SSE
        const url = String(config.url);
        transport = url.includes('/sse') ? 'sse' : 'http';
    }

    // Clean name (remove mcpm_ prefix if present)
    const cleanName = hasPrefix(name) ? removePrefix(name) : name;

    const server: RegistryServer = {
        name: cleanName,
        transport,
        createdAt: new Date().toISOString(),
        importedFrom: fromAgent,
    };

    if (transport === 'stdio') {
        if (!config.command) {
            return null; // Invalid config
        }
        server.command = String(config.command);
        if (Array.isArray(config.args)) {
            server.args = config.args.map(String);
        }
    } else {
        if (!config.url) {
            return null;
        }
        server.url = String(config.url);
        if (config.headers && typeof config.headers === 'object') {
            server.headers = config.headers as Record<string, string>;
        }
    }

    if (config.env && typeof config.env === 'object') {
        server.env = config.env as Record<string, string>;
    }

    return server;
}

/**
 * Scan all agents and find servers to import
 */
export async function scanAgentsForImport(
    agentTypes?: AgentType[],
    includeManaged: boolean = false
): Promise<Map<string, { config: Record<string, unknown>; agents: AgentType[] }>> {
    const agents = agentTypes || detectInstalledAgents();
    const found = new Map<string, { config: Record<string, unknown>; agents: AgentType[] }>();

    for (const agentType of agents) {
        const servers = await extractServersFromAgent(agentType);

        for (const [name, config] of servers) {
            // Skip mcpm-managed servers unless explicitly included
            if (!includeManaged && hasPrefix(name)) {
                continue;
            }

            const cleanName = hasPrefix(name) ? removePrefix(name) : name;

            if (found.has(cleanName)) {
                // Add to existing entry
                found.get(cleanName)!.agents.push(agentType);
            } else {
                found.set(cleanName, { config, agents: [agentType] });
            }
        }
    }

    return found;
}

/**
 * Interactive import command
 */
export async function runImportMode(): Promise<ImportResult> {
    const result: ImportResult = {
        imported: [],
        skipped: [],
        errors: [],
    };

    p.note('Import existing MCP servers from your agents into the registry.', 'Import Mode');

    const spin = p.spinner();
    spin.start('Scanning agents...');

    const found = await scanAgentsForImport();

    spin.stop(`Found ${found.size} server(s) in agents`);

    if (found.size === 0) {
        p.log.info('No non-managed servers found in agents.');
        p.log.info(pc.dim('Servers prefixed with mcpm_ are managed by the registry and excluded.'));
        return result;
    }

    // Show what was found
    p.log.info(pc.bold('Servers found:'));
    for (const [name, { agents }] of found) {
        const agentNames = agents.map(a => getAgentConfig(a).displayName).join(', ');
        console.log(`  ${pc.green('●')} ${pc.bold(name)} (in ${agentNames})`);
    }

    // Ask which to import
    const choices = await p.multiselect({
        message: 'Select servers to import',
        options: Array.from(found.entries()).map(([name, { agents }]) => ({
            value: name,
            label: name,
            hint: `from ${agents.length} agent(s)`,
            selected: true, // Default to all selected
        })),
    });

    if (isCancel(choices) || choices.length === 0) {
        p.cancel('Import cancelled');
        return result;
    }

    // Import each selected server
    for (const name of choices) {
        const entry = found.get(name);
        if (!entry) continue;

        // Use the first agent's config
        const fromAgent = entry.agents[0];
        const server = configToRegistryServer(name, entry.config, fromAgent);

        if (!server) {
            result.errors.push(`${name}: Invalid config format`);
            continue;
        }

        // Check if exists in registry
        if (serverExists(name)) {
            const action = await p.select<ImportConflictStrategy>({
                message: `"${name}" already exists in registry`,
                options: [
                    { value: 'replace', label: 'Replace', hint: 'Overwrite registry entry' },
                    { value: 'skip', label: 'Skip', hint: 'Keep existing' },
                    { value: 'rename', label: 'Rename', hint: 'Enter a new name' },
                ],
            });

            if (isCancel(action)) {
                result.skipped.push(name);
                continue;
            }

            if (action === 'skip') {
                result.skipped.push(name);
                continue;
            }

            if (action === 'rename') {
                const newName = await p.text({
                    message: 'Enter new name',
                    placeholder: `${name}-imported`,
                    validate: (v) => {
                        if (!v || v.length < 2) return 'Name too short';
                        if (serverExists(v)) return 'Name already exists';
                        return undefined;
                    },
                });

                if (isCancel(newName)) {
                    result.skipped.push(name);
                    continue;
                }

                server.name = newName;
            }
        }

        // Import
        addServer(server);

        result.imported.push({
            name: server.name,
            originalName: name,
            fromAgent,
            server,
        });
    }

    // Summary
    if (result.imported.length > 0) {
        p.log.success(`Imported ${result.imported.length} server(s)`);
    }
    if (result.skipped.length > 0) {
        p.log.info(`Skipped ${result.skipped.length} server(s)`);
    }
    if (result.errors.length > 0) {
        p.log.error(`Errors: ${result.errors.join(', ')}`);
    }

    return result;
}

/**
 * Quick import - import a specific server by name (non-interactive)
 */
export async function importServerByName(
    serverName: string,
    fromAgent?: AgentType,
    strategy: ImportConflictStrategy = 'skip'
): Promise<boolean> {
    const agents = fromAgent ? [fromAgent] : detectInstalledAgents();

    for (const agentType of agents) {
        const servers = await extractServersFromAgent(agentType);
        const config = servers.get(serverName);

        if (!config) continue;

        const server = configToRegistryServer(serverName, config, agentType);
        if (!server) continue;

        if (serverExists(serverName)) {
            if (strategy === 'skip') {
                return false;
            }
            // Replace: continue to addServer which will overwrite
        }

        addServer(server);
        return true;
    }

    return false;
}
