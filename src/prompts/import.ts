/**
 * Import flow - import servers from agent configs into registry
 * New flow: Select agent → Select servers → Handle duplicates → Import
 */

import * as p from '@clack/prompts';
import pc from 'picocolors';
import type { AgentType } from '../types.js';
import type { RegistryServer } from '../registry/types.js';
import { addServer, serverExists, loadRegistry, saveRegistry } from '../registry/store.js';
import { agents, getAgentConfig, detectInstalledAgents } from '../agents.js';
import { extractServersFromAgent, configToRegistryServer } from '../core/import.js';
import { storeSecret, isKeychainAvailable } from '../registry/keychain.js';
import { multiselectWithAll } from './shared.js';

type FlowResult = 'back' | 'done';

/** Secret detection patterns */
const SECRET_NAME_PATTERNS = [
    /api[_-]?key/i, /secret/i, /token/i, /password/i, /passwd/i,
    /credential/i, /auth/i, /private[_-]?key/i, /access[_-]?key/i,
];

/**
 * Run import flow with new UX
 */
export async function runImportFlow(): Promise<FlowResult> {
    // Step 1: Select an agent
    const installedAgents = detectInstalledAgents();

    if (installedAgents.length === 0) {
        p.log.warn('No agents detected on this system.');
        return 'done';
    }

    while (true) {
        const agentOptions = installedAgents.map(type => ({
            value: type,
            label: agents[type].displayName,
        }));

        const selectedAgent = await p.select({
            message: 'Select agent to import from:',
            options: agentOptions,
        });

        if (p.isCancel(selectedAgent)) {
            return 'back';
        }

        // Step 2: Extract servers from agent
        const agentServers = await extractServersFromAgent(selectedAgent as AgentType);

        if (agentServers.size === 0) {
            p.log.warn('No MCP configurations found in this agent.');
            // Go back to agent selection
            continue;
        }

        // Step 3: Multi-select servers to import (with "Select all")
        const serverEntries = Array.from(agentServers.entries());
        const serverItems = serverEntries.map(([name, config]) => ({
            value: name,
            label: name,
            hint: config.command ? String(config.command) : String(config.url || config.serverUrl || ''),
        }));

        const serverNames = await multiselectWithAll({
            message: 'Select servers to import:',
            items: serverItems,
        });

        if (serverNames === null) {
            // Go back to agent selection
            continue;
        }

        // Step 4: Check for duplicates
        const registry = loadRegistry();
        const duplicates = serverNames.filter(name => registry.servers[name]);
        const nonDuplicates = serverNames.filter(name => !registry.servers[name]);

        // Step 5: Handle duplicates if any
        if (duplicates.length > 0) {
            p.log.warn(`Duplicate names: ${pc.yellow(duplicates.join(', '))}`);

            const action = await p.select({
                message: 'How to handle duplicates?',
                options: [
                    {
                        value: 'override',
                        label: 'Override from Agent',
                        hint: 'Replace registry with agent config',
                    },
                    {
                        value: 'ignore',
                        label: 'Ignore duplicates',
                        hint: 'Only import non-duplicates',
                    },
                    {
                        value: 'rename',
                        label: 'Change server names',
                        hint: 'Rename duplicates before import',
                    },
                    {
                        value: 'cancel',
                        label: 'Cancel',
                    },
                ],
            });

            if (p.isCancel(action) || action === 'cancel') {
                // Go back to server selection
                continue;
            }

            if (action === 'ignore') {
                if (nonDuplicates.length === 0) {
                    p.log.info('No new servers to import.');
                    return 'done';
                }
                // Import only non-duplicates
                return await performImport(
                    selectedAgent as AgentType,
                    agentServers,
                    nonDuplicates,
                    []
                );
            } else if (action === 'rename') {
                // Rename flow for each duplicate
                const renamedServers: { original: string; newName: string }[] = [];

                for (const name of duplicates) {
                    let newName: string | undefined;

                    while (true) {
                        const input = await p.text({
                            message: `New name for "${name}":`,
                            placeholder: `${name}-imported`,
                            validate: (val) => {
                                if (!val?.trim()) return 'Name required';
                                if (registry.servers[val]) return 'Name already exists in registry';
                                if (renamedServers.some(r => r.newName === val)) return 'Name already used';
                                return undefined;
                            },
                        });

                        if (p.isCancel(input)) {
                            // Cancel rename, skip this server
                            break;
                        }

                        newName = input;
                        break;
                    }

                    if (newName) {
                        renamedServers.push({ original: name, newName });
                    }
                }

                // Import with renamed servers
                const renamedNames = [
                    ...nonDuplicates,
                    ...renamedServers.map(r => r.original),
                ];

                return await performImport(
                    selectedAgent as AgentType,
                    agentServers,
                    renamedNames,
                    renamedServers
                );
            }
            // If override, continue with all serverNames
        }

        // Step 6: Perform import (override or no duplicates)
        return await performImport(
            selectedAgent as AgentType,
            agentServers,
            serverNames,
            []
        );
    }
}

/**
 * Perform the actual import with spinner
 */
async function performImport(
    agentType: AgentType,
    agentServers: Map<string, Record<string, unknown>>,
    serverNames: string[],
    renamedServers: { original: string; newName: string }[]
): Promise<FlowResult> {
    const s = p.spinner();
    s.start('Importing servers...');

    const keychainAvailable = await isKeychainAvailable();
    let imported = 0;
    let secretsStored = 0;

    for (const name of serverNames) {
        const config = agentServers.get(name);
        if (!config) continue;

        const server = configToRegistryServer(name, config, agentType);
        if (!server) continue;

        // Check if this is a renamed server
        const renamed = renamedServers.find(r => r.original === name);
        if (renamed) {
            server.name = renamed.newName;
        }

        // Auto-detect secrets and store in keychain
        if (keychainAvailable && server.env) {
            for (const [key, value] of Object.entries(server.env)) {
                if (isSecretName(key) && value && !value.startsWith('keychain:')) {
                    // Store in keychain using serverName.envName format
                    await storeSecret(server.name, key, value);
                    server.env[key] = `keychain:${server.name}.${key}`;
                    secretsStored++;
                }
            }
        }

        addServer(server);
        imported++;
    }

    s.stop('Import complete');

    // Show results
    p.log.success(`Imported ${imported} server(s)`);
    if (secretsStored > 0) {
        p.log.info(`Stored ${secretsStored} secret(s) in keychain`);
    }

    return 'done';
}

/**
 * Check if env var name looks like a secret
 */
function isSecretName(name: string): boolean {
    return SECRET_NAME_PATTERNS.some(p => p.test(name));
}
