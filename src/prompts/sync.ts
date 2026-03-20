/**
 * Sync flow - push registry servers to agents
 */

import * as p from '@clack/prompts';
import pc from 'picocolors';
import type { AgentType, McpServerConfig, ParsedMcpConfig, EnvVarSchema } from '../types.js';
import { agents, getAgentConfig, detectInstalledAgents } from '../agents.js';
import { loadRegistry, listServers, addServer } from '../registry/store.js';
import type { RegistryServer } from '../registry/types.js';
import { hasSchema, createBlankConfigFromSchema } from '../registry/schema.js';
import { existsSync, readFileSync } from 'node:fs';
import { getSecret, storeSecret, isKeychainAvailable } from '../registry/keychain.js';
import { multiselectWithAll } from './shared.js';
import { injectConfig } from '../core/injector.js';

/**
 * Result type for navigation
 */
type FlowResult = 'back' | 'done';

/**
 * Run sync flow
 * Returns 'back' to go to previous menu, 'done' when complete
 */
export async function runSyncFlow(): Promise<FlowResult> {
    const servers = listServers();

    if (servers.length === 0) {
        p.log.warn('Registry is empty. Add servers first.');
        return 'done';
    }

    // Step 1: Select servers to sync
    const serverItems = servers.map(s => ({
        value: s.name,
        label: s.name,
        hint: s.transport === 'stdio' ? s.command : s.url,
    }));

    const selectedServers = await multiselectWithAll({
        message: 'Select servers to sync:',
        items: serverItems,
    });

    if (selectedServers === null) {
        return 'back';
    }

    // Filter selected servers
    let selectedServersList = servers.filter(s =>
        (selectedServers as string[]).includes(s.name)
    );

    // Step 2: Check if any servers have schema for reconfiguration
    const serversWithSchema = selectedServersList.filter(s => hasSchema(s));

    if (serversWithSchema.length > 0) {
        const configMode = await p.select({
            message: 'Configuration mode:',
            options: [
                {
                    value: 'saved',
                    label: 'Use saved config',
                    hint: 'sync with current credentials',
                },
                {
                    value: 'reconfigure',
                    label: 'Reconfigure',
                    hint: 're-enter credentials from schema',
                },
            ],
            initialValue: 'saved',
        });

        if (p.isCancel(configMode)) {
            return 'back';
        }

        if (configMode === 'reconfigure') {
            // Reconfigure: prompt for all credentials from schema
            const reconfiguredServers = await reconfigureServers(serversWithSchema);
            if (reconfiguredServers === null) {
                return 'back';
            }

            // Replace selected servers with reconfigured versions
            selectedServersList = selectedServersList.map(s => {
                const reconfigured = reconfiguredServers.find(r => r.name === s.name);
                return reconfigured || s;
            });
        }
    }

    // Step 3: Select agents to sync to
    const installedAgents = detectInstalledAgents();

    if (installedAgents.length === 0) {
        p.log.warn('No agents detected on this system.');
        return 'done';
    }

    const agentItems = installedAgents.map(type => ({
        value: type,
        label: agents[type].displayName,
    }));

    const selectedAgents = await multiselectWithAll({
        message: 'Select agents to sync to:',
        items: agentItems,
    });

    if (selectedAgents === null) {
        // Go back to server selection - but for simplicity, go to root
        return 'back';
    }

    // Step 4: Check for duplicates in target agents


    const duplicates = await findDuplicates(
        selectedServersList,
        selectedAgents as AgentType[]
    );

    if (duplicates.length > 0) {
        const duplicateNames = [...new Set(duplicates.map(d => d.serverName))];
        p.log.warn(`Found existing servers: ${pc.yellow(duplicateNames.join(', '))}`);

        const override = await p.confirm({
            message: 'Override existing configurations?',
            initialValue: true,
        });

        if (p.isCancel(override)) {
            return 'back';
        }

        if (!override) {
            return 'back';
        }
    }

    // Step 4: Inject configs
    const s = p.spinner();
    s.start('Syncing servers to agents...');

    const results: { agent: string; success: boolean; error?: string }[] = [];

    for (const agentType of selectedAgents as AgentType[]) {
        try {
            await injectServersToAgent(agentType, selectedServersList);
            results.push({ agent: agents[agentType].displayName, success: true });
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            results.push({ agent: agents[agentType].displayName, success: false, error: msg });
        }
    }

    s.stop('Sync complete');

    // Show results
    for (const r of results) {
        if (r.success) {
            p.log.success(`${pc.green('✓')} ${r.agent}`);
        } else {
            p.log.error(`${pc.red('✗')} ${r.agent}: ${r.error}`);
        }
    }

    return 'done';
}

/**
 * Find servers that already exist in target agents
 */
async function findDuplicates(
    servers: RegistryServer[],
    targetAgents: AgentType[]
): Promise<{ serverName: string; agentType: AgentType }[]> {
    const duplicates: { serverName: string; agentType: AgentType }[] = [];

    for (const agentType of targetAgents) {
        const config = getAgentConfig(agentType);
        if (!existsSync(config.mcpConfigPath)) continue;

        try {
            const content = readFileSync(config.mcpConfigPath, 'utf-8');
            const parsed = JSON.parse(content);
            const existingServers = parsed[config.wrapperKey] || {};

            for (const server of servers) {
                // Check both exact name and mcpm-prefixed name
                const mcpmName = `mcpm-${server.name}`;
                if (existingServers[server.name] || existingServers[mcpmName]) {
                    duplicates.push({ serverName: server.name, agentType });
                }
            }
        } catch {
            // Skip unreadable configs
        }
    }

    return duplicates;
}

/**
 * Inject servers into an agent's config using the centralized injector
 * This ensures proper agent-specific transformations are applied
 */
async function injectServersToAgent(
    agentType: AgentType,
    servers: RegistryServer[]
): Promise<void> {
    // Convert registry servers to ParsedMcpConfig format
    const serverConfigs: Record<string, McpServerConfig> = {};

    for (const server of servers) {
        const serverConfig = await registryServerToConfig(server);
        // Use original name - injectConfig will apply mcpm_ prefix automatically
        serverConfigs[server.name] = serverConfig;
    }

    const parsedConfig: ParsedMcpConfig = {
        servers: serverConfigs,
        sourceFormat: 'json',
        sourceWrapperKey: 'mcpServers',
    };

    // Use centralized injector which handles agent-specific transformations
    await injectConfig(agentType, parsedConfig);
}

/**
 * Convert RegistryServer to McpServerConfig, resolving keychain secrets
 */
async function registryServerToConfig(server: RegistryServer): Promise<McpServerConfig> {
    if (server.transport === 'stdio') {
        const env: Record<string, string> = {};

        // Resolve keychain secrets
        if (server.env) {
            for (const [key, value] of Object.entries(server.env)) {
                if (value.startsWith('keychain:')) {
                    // Parse keychain reference: keychain:serverName.envName
                    const ref = value.slice('keychain:'.length);
                    const parts = ref.split('.');
                    if (parts.length >= 2) {
                        const serverName = parts[0];
                        const envName = parts.slice(1).join('.');
                        const secret = await getSecret(serverName, envName);
                        env[key] = secret || value; // Fallback to keychain reference if not found
                    } else {
                        env[key] = value;
                    }
                } else {
                    env[key] = value;
                }
            }
        }

        return {
            type: 'stdio',
            command: server.command,
            args: server.args,
            env: Object.keys(env).length > 0 ? env : undefined,
        };
    } else {
        return {
            type: server.transport,
            url: server.url,
            headers: server.headers,
        };
    }
}

/**
 * Reconfigure servers by prompting for all credentials from schema
 * @returns Reconfigured servers, or null if cancelled
 */
async function reconfigureServers(
    servers: RegistryServer[]
): Promise<RegistryServer[] | null> {
    const keychainAvailable = await isKeychainAvailable();
    const reconfiguredServers: RegistryServer[] = [];

    p.log.info(pc.dim('Re-entering credentials from schema (required fields first)'));

    for (const server of servers) {
        p.log.info(`\n${pc.bold(server.name)}`);

        const blankConfig = createBlankConfigFromSchema(server.schema);
        const newEnv: Record<string, string> = {};
        const newHeaders: Record<string, string> = {};

        // Handle env vars (for stdio)
        if (blankConfig.env && Object.keys(blankConfig.env).length > 0) {
            const result = await promptCredentialsFromSchema(
                server.name,
                blankConfig.env,
                'env',
                keychainAvailable
            );
            if (result === null) return null;
            Object.assign(newEnv, result);
        }

        // Handle headers (for http/sse)
        if (blankConfig.headers && Object.keys(blankConfig.headers).length > 0) {
            const result = await promptCredentialsFromSchema(
                server.name,
                blankConfig.headers,
                'header',
                keychainAvailable
            );
            if (result === null) return null;
            Object.assign(newHeaders, result);
        }

        // Create reconfigured server
        const reconfigured: RegistryServer = {
            ...server,
            env: Object.keys(newEnv).length > 0 ? newEnv : server.env,
            lastSyncedAt: new Date().toISOString(),
        };

        // Only update headers if we have new ones
        if (Object.keys(newHeaders).length > 0) {
            reconfigured.headers = newHeaders;
        }

        // Save updated server to registry
        addServer(reconfigured);

        reconfiguredServers.push(reconfigured);
    }

    p.log.success('Credentials updated');
    return reconfiguredServers;
}

/**
 * Prompt for credentials from schema (env vars or headers)
 * Returns filled values record or null if cancelled
 */
async function promptCredentialsFromSchema(
    serverName: string,
    schema: Record<string, EnvVarSchema>,
    type: 'env' | 'header',
    keychainAvailable: boolean
): Promise<Record<string, string> | null> {
    const result: Record<string, string> = {};

    // Secret detection patterns
    const SECRET_PATTERNS = [
        /api[_-]?key/i, /secret/i, /token/i, /password/i,
        /credential/i, /auth/i, /private[_-]?key/i, /access[_-]?key/i,
        /^authorization$/i, /^x-api-key$/i,
    ];

    const isSecretName = (name: string) => SECRET_PATTERNS.some(p => p.test(name));

    for (const [key, meta] of Object.entries(schema)) {
        const isRequired = meta.required !== false;
        const isHidden = meta.hidden ?? isSecretName(key);
        const isSecret = isSecretName(key);

        // Show description/note
        if (meta.description) {
            p.log.info(`  ${pc.dim(meta.description)}`);
        }
        if (meta.note) {
            p.log.info(`  Note: ${meta.note}`);
        }

        let value: string | symbol;

        if (isHidden) {
            value = await p.password({
                message: `${key}:`,
                validate(v) {
                    if (isRequired && !v) return `${key} is required`;
                },
            });
        } else {
            value = await p.text({
                message: `${key}:`,
                placeholder: isRequired ? 'Enter value...' : '(optional, press Enter to skip)',
                validate(v) {
                    if (isRequired && !v) return `${key} is required`;
                },
            });
        }

        if (p.isCancel(value)) {
            return null;
        }

        // Skip empty optional values
        if (!value && !isRequired) {
            continue;
        }

        // Store secrets in keychain
        if (isSecret && keychainAvailable && value) {
            await storeSecret(serverName, key, value);
            result[key] = `keychain:${serverName}.${key}`;
            p.log.info(`  ${pc.dim('Stored in keychain')}`);
        } else if (value) {
            result[key] = value;
        }
    }

    return result;
}
