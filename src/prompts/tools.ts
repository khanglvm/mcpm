import * as p from '@clack/prompts';
import pc from 'picocolors';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import type { AgentType, ParsedMcpConfig, McpServerConfig, InstallScope } from '../types.js';
import { agents, getAgentConfig, getAgentsWithLocalSupport } from '../agents.js';
import { showSecurityWarning } from './security.js';
import { injectConfig, injectLocalConfig } from '../core/injector.js';
import { addServer } from '../registry/store.js';
import type { RegistryServer } from '../registry/types.js';
import { extractEnvSchema, extractHeaderSchema } from '../registry/schema.js';
import { multiselectWithAll } from './shared.js';

/**
 * Show tool selector (multiselect) with scope selection
 * @param installedAgents - List of detected installed agents
 * @param config - Parsed MCP configuration
 * @param preAgents - Optional pre-selected agents from CLI args (will be filtered by scope/transport)
 * @param autoSelectAll - If true, pre-select all compatible agents
 */
export async function showToolSelector(
    installedAgents: AgentType[],
    config: ParsedMcpConfig,
    preAgents?: AgentType[],
    autoSelectAll?: boolean
) {
    // Step 1: Scope selection
    const scope = await p.select({
        message: 'Where would you like to install?',
        options: [
            { value: 'global', label: 'Global', hint: 'available in all projects' },
            { value: 'project', label: 'Project', hint: 'current directory only' },
        ],
        initialValue: 'global',
    }) as InstallScope | symbol;

    if (p.isCancel(scope)) {
        p.log.info('Cancelled');
        return;
    }

    // Step 2: Filter agents based on scope support
    const localSupportAgents = getAgentsWithLocalSupport();
    let availableAgents = scope === 'project'
        ? installedAgents.filter(a => localSupportAgents.includes(a))
        : installedAgents;

    // Step 3: Apply pre-selection filter if provided
    let preSelectedAgents: AgentType[] | undefined;
    if (preAgents && preAgents.length > 0) {
        // Filter pre-agents by:
        // 1. Must be installed
        // 2. Must support selected scope
        const validPreAgents = preAgents.filter(a => availableAgents.includes(a));
        const invalidPreAgents = preAgents.filter(a => !availableAgents.includes(a));

        if (invalidPreAgents.length > 0) {
            const reasons = invalidPreAgents.map(a => {
                if (!installedAgents.includes(a)) return `${agents[a].displayName} (not installed)`;
                if (scope === 'project' && !localSupportAgents.includes(a)) {
                    return `${agents[a].displayName} (global-only)`;
                }
                return agents[a].displayName;
            });
            p.log.warn(`Skipped incompatible agents: ${reasons.join(', ')}`);
        }

        if (validPreAgents.length > 0) {
            preSelectedAgents = validPreAgents;
        }
    }

    // Step 3b: If autoSelectAll is true, pre-select all available agents
    if (autoSelectAll && (!preSelectedAgents || preSelectedAgents.length === 0)) {
        preSelectedAgents = [...availableAgents];
    }

    // Show warning if no agents support local config
    if (scope === 'project' && availableAgents.length === 0) {
        p.log.warn('No installed agents support project-scope config.');
        const unsupportedNames = installedAgents
            .filter(a => !localSupportAgents.includes(a))
            .map(a => agents[a].displayName)
            .join(', ');
        p.log.info(`Unsupported: ${unsupportedNames}`);
        return;
    }

    // Step 4: Build multiselect items with registry toggle at top
    const registryItem = {
        value: '__registry__' as const,
        label: 'Add to registry',
        hint: scope === 'global' ? 'save for sync later' : 'save configuration',
    };

    const agentItems = availableAgents.map((type) => ({
        value: type,
        label: agents[type].displayName,
        hint: scope === 'project' ? agents[type].localConfigPath : agents[type].wrapperKey,
    }));

    // Show which agents don't support local config (as info)
    if (scope === 'project') {
        const unsupported = installedAgents.filter(a => !localSupportAgents.includes(a));
        if (unsupported.length > 0) {
            const names = unsupported.map(a => agents[a].displayName).join(', ');
            p.log.info(pc.dim(`Global-only agents (skipped): ${names}`));
        }
    }

    const allItems = [registryItem, ...agentItems];

    // Set initial values: registry for global, pre-selected agents if provided
    const initialValues: string[] = [];
    if (scope === 'global') {
        initialValues.push('__registry__');
    }
    if (preSelectedAgents) {
        initialValues.push(...preSelectedAgents);
    }

    const selectedItems = await p.multiselect({
        message: `Select targets: (press 'space' to toggle, 'a' to select all)`,
        options: allItems,
        initialValues,
        required: true,
    });

    if (p.isCancel(selectedItems)) {
        p.log.info('Cancelled');
        return;
    }

    const selected = selectedItems as string[];
    const addToRegistry = selected.includes('__registry__');
    const selectedTools = selected.filter(s => s !== '__registry__') as AgentType[];

    if (selectedTools.length === 0 && !addToRegistry) {
        p.log.warn('No targets selected.');
        return;
    }

    // Show security warning
    const confirmed = await showSecurityWarning(config);
    if (!confirmed) {
        p.log.info('Cancelled');
        return;
    }

    // Use tasks for structured installation
    const serverNames = Object.keys(config.servers).join(', ');

    const tasks: Parameters<typeof p.tasks>[0] = [];
    // Track failed installations for final summary
    const failedInstalls: { agent: string; error: string }[] = [];

    // Registry task (conditional)
    if (addToRegistry) {
        tasks.push({
            title: `Saving to registry`,
            task: async () => {
                for (const [name, serverConfig] of Object.entries(config.servers)) {
                    const registryServer = toRegistryServer(name, serverConfig);
                    addServer(registryServer);
                }
                return `Saved ${Object.keys(config.servers).length} server(s) to registry`;
            },
        });
    }

    // Combined backup + install task
    if (selectedTools.length > 0) {
        const scopeLabel = scope === 'project' ? 'project config' : 'agents';
        tasks.push({
            title: `Installing to ${scopeLabel}: ${serverNames}`,
            task: async () => {
                const results: string[] = [];
                for (const tool of selectedTools) {
                    const agentConfig = getAgentConfig(tool);
                    const configPath = scope === 'project'
                        ? agentConfig.localConfigPath
                        : agentConfig.mcpConfigPath;

                    const lines: string[] = [`${agents[tool].displayName}:`];

                    // Backup existing config (global scope only)
                    if (scope === 'global' && existsSync(agentConfig.mcpConfigPath)) {
                        const backupPath = await backupConfig(tool);
                        if (backupPath) {
                            lines.push(`    Backed up: ${backupPath}`);
                        }
                    }

                    // Install
                    try {
                        if (scope === 'project') {
                            await injectLocalConfig(tool, config);
                        } else {
                            await injectConfig(tool, config);
                        }
                        lines.push(`    Config: ${configPath}`);
                        lines.push(`    Status: ${pc.green('Success')}`);
                    } catch (err) {
                        const errorMsg = err instanceof Error ? err.message : 'Unknown error';
                        lines.push(`    Config: ${configPath || 'N/A'}`);
                        lines.push(`    Status: ${pc.red(errorMsg)}`);
                        failedInstalls.push({ agent: agents[tool].displayName, error: errorMsg });
                    }

                    results.push(lines.join('\n'));
                }
                return results.join('\n');
            },
        });
    }

    if (tasks.length > 0) {
        await p.tasks(tasks);
    }

    // Show appropriate completion status
    if (failedInstalls.length > 0) {
        if (failedInstalls.length === selectedTools.length) {
            // All failed
            p.log.error('Configuration failed!');
        } else {
            // Partial failure
            p.log.warn('Configuration completed with errors');
        }
        // List failed agents
        for (const { agent, error } of failedInstalls) {
            p.log.error(`${pc.red('✗')} ${agent}: ${error}`);
        }
    } else {
        p.log.success('Configuration complete!');
    }

    if (selectedTools.length > 0 && failedInstalls.length < selectedTools.length) {
        const successCount = selectedTools.length - failedInstalls.length;
        p.log.info(`Servers installed: ${pc.cyan(serverNames)} (${successCount}/${selectedTools.length} agents)`);
    }
    if (addToRegistry) {
        p.log.info(`Added to registry: ${pc.cyan(serverNames)}`);
    }
}

/**
 * Backup existing config before overwrite
 * Returns the backup path if successful
 */
async function backupConfig(agentType: AgentType): Promise<string | null> {
    const agentConfig = getAgentConfig(agentType);
    const configPath = agentConfig.mcpConfigPath;

    if (!existsSync(configPath)) return null;

    // Create backup directory
    const backupDir = join(homedir(), '.mcpm', 'backups');
    if (!existsSync(backupDir)) {
        mkdirSync(backupDir, { recursive: true });
    }

    // Create timestamped backup with original file extension
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const ext = configPath.includes('.') ? configPath.slice(configPath.lastIndexOf('.')) : '.json';
    const backupPath = join(backupDir, `${agentType}-${timestamp}${ext}`);

    const content = readFileSync(configPath, 'utf-8');
    writeFileSync(backupPath, content);

    return backupPath;
}

/**
 * Convert McpServerConfig to RegistryServer format
 */
function toRegistryServer(name: string, config: McpServerConfig): RegistryServer {
    const transport = config.type || 'stdio';
    const createdAt = new Date().toISOString();

    if (transport === 'stdio') {
        return {
            name,
            transport: 'stdio',
            command: config.command!,
            args: config.args,
            env: config.env as Record<string, string>,
            schema: {
                env: extractEnvSchema(config.env),
            },
            createdAt,
        };
    } else {
        return {
            name,
            transport: transport as 'http' | 'sse',
            url: config.url!,
            headers: config.headers,
            schema: {
                headers: extractHeaderSchema(config.headers),
            },
            createdAt,
        };
    }
}

