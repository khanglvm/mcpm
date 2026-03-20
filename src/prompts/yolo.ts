/**
 * Auto Mode (-y) - Automated MCP Installation
 * Success-or-fail, no retries, no user interaction
 */

import * as p from '@clack/prompts';
import pc from 'picocolors';
import type { AgentType, ParsedMcpConfig, McpServerConfig, InstallScope, EnvVarSchema } from '../types.js';
import { agents, getAgentConfig, getAgentsWithLocalSupport } from '../agents.js';
import { validateAllServers } from '../core/validator.js';
import { injectConfig, injectLocalConfig } from '../core/injector.js';
import { addServer } from '../registry/store.js';
import type { RegistryServer } from '../registry/types.js';
import { extractEnvSchema, extractHeaderSchema } from '../registry/schema.js';
import { plural } from './shared.js';

/**
 * Check if all required credentials are complete for a server
 */
function areServerCredentialsComplete(server: McpServerConfig): boolean {
    const isHttp = !server.command && (!!server.url || server.type === 'http' || server.type === 'sse');

    if (isHttp) {
        // HTTP/SSE: check headers
        if (!server.headers) return true;
        return areEntriesComplete(server.headers);
    } else {
        // stdio: check env
        if (!server.env) return true;
        return areEntriesComplete(server.env);
    }
}

/**
 * Check if all required entries have values
 */
function areEntriesComplete(entries: Record<string, string | null | EnvVarSchema>): boolean {
    for (const [, schema] of Object.entries(entries)) {
        if (typeof schema === 'string') {
            // Simple string value is complete
            continue;
        } else if (schema === null) {
            // null means needs user input
            return false;
        } else if (typeof schema === 'object' && 'value' in schema) {
            const extended = schema as EnvVarSchema;
            const isRequired = extended.required !== false; // default true
            if (isRequired && extended.value === null) {
                return false;
            }
        }
    }
    return true;
}

/**
 * Check if auto mode conditions are met
 */
export function checkAutoConditions(
    config: ParsedMcpConfig,
    installedAgents: AgentType[],
    scope: InstallScope
): { canRun: boolean; reason?: string } {
    // Check 1: All servers have complete credentials
    for (const [name, server] of Object.entries(config.servers)) {
        if (!areServerCredentialsComplete(server)) {
            return { canRun: false, reason: `Server "${name}" has missing required credentials` };
        }
    }

    // Check 2: At least one agent supports the scope
    const localSupportAgents = getAgentsWithLocalSupport();
    const compatibleAgents = scope === 'project'
        ? installedAgents.filter(a => localSupportAgents.includes(a))
        : installedAgents;

    if (compatibleAgents.length === 0) {
        return { canRun: false, reason: `No installed agents support ${scope} scope` };
    }

    return { canRun: true };
}

/**
 * Get transport type for a server config
 */
function getServerTransport(server: McpServerConfig): 'stdio' | 'http' | 'sse' {
    if (server.type) return server.type;
    if (server.command) return 'stdio';
    return 'sse'; // default for URL-based
}

/**
 * Convert McpServerConfig to RegistryServer format
 */
function toRegistryServer(name: string, config: McpServerConfig): RegistryServer {
    const transport = getServerTransport(config);
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

/**
 * Run automated (-y) installation
 * @returns true on success, false on failure
 */
export async function runAutoInstall(
    config: ParsedMcpConfig,
    installedAgents: AgentType[],
    scope: InstallScope,
    preAgents?: AgentType[],
    autoSelectAll?: boolean
): Promise<boolean> {
    // If autoSelectAll is true and no specific agents were pre-selected, use all installed agents
    if (autoSelectAll && (!preAgents || preAgents.length === 0)) {
        preAgents = [...installedAgents];
    }

    const serverNames = Object.keys(config.servers);

    p.log.info(pc.cyan('🚀 Auto mode (-y): Automated installation'));

    // Step 1: Validate all servers
    const s = p.spinner();
    s.start(`Validating ${plural(serverNames.length, 'MCP server')}...`);

    const results = await validateAllServers(config.servers);
    const passed = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);

    if (failed.length > 0) {
        s.stop(pc.red(`✗ ${failed.length}/${results.length} server(s) failed validation`));
        // Clean UX: only show server names, not stack traces
        for (const result of failed) {
            // Extract clean message without stack traces
            const cleanError = result.error?.split('\n')[0] || 'Validation failed';
            p.log.error(`${result.serverName}: ${cleanError}`);
        }
        return false;
    }

    s.stop(pc.green(`✓ All ${plural(serverNames.length, 'server')} validated`));

    // Show tools for each server
    for (const result of passed) {
        if (result.tools && result.tools.length > 0) {
            p.log.success(`${pc.cyan(result.serverName)}`);
            p.log.message(`  ${pc.dim(`${result.tools.length} tool(s):`)}`);
            for (const tool of result.tools) {
                const desc = tool.description
                    ? ` ${pc.dim(`— ${tool.description.slice(0, 50)}${tool.description.length > 50 ? '...' : ''}`)}`
                    : '';
                p.log.message(`    ${pc.yellow('•')} ${tool.name}${desc}`);
            }
        }
    }

    // Step 2: Determine target agents
    const localSupportAgents = getAgentsWithLocalSupport();
    let targetAgents = scope === 'project'
        ? installedAgents.filter(a => localSupportAgents.includes(a))
        : installedAgents;

    // Apply pre-agent filter if provided
    if (preAgents && preAgents.length > 0) {
        targetAgents = targetAgents.filter(a => preAgents.includes(a));
    }

    // Step 3: Install to registry (global scope only)
    if (scope === 'global') {
        for (const [name, serverConfig] of Object.entries(config.servers)) {
            const registryServer = toRegistryServer(name, serverConfig);
            addServer(registryServer);
        }
        p.log.success(`Added to registry: ${pc.cyan(serverNames.join(', '))}`);
    }

    // Step 4: Install to agents
    const successAgents: string[] = [];
    const failedAgents: { agent: string; error: string }[] = [];

    for (const agentType of targetAgents) {
        const agentConfig = getAgentConfig(agentType);
        try {
            if (scope === 'project') {
                await injectLocalConfig(agentType, config);
            } else {
                await injectConfig(agentType, config);
            }
            successAgents.push(agents[agentType].displayName);
        } catch (err) {
            // Clean error message for UX
            const cleanError = (err instanceof Error ? err.message : 'Unknown error').split('\n')[0];
            failedAgents.push({
                agent: agents[agentType].displayName,
                error: cleanError,
            });
        }
    }

    // Step 5: Summary
    if (successAgents.length > 0) {
        p.log.success(`Installed to: ${pc.cyan(successAgents.join(', '))}`);
    }

    if (failedAgents.length > 0) {
        for (const { agent, error } of failedAgents) {
            p.log.error(`${pc.red('✗')} ${agent}: ${error}`);
        }
    }

    // Return success if at least one agent succeeded (or registry was updated)
    const hasSuccess = scope === 'global' || successAgents.length > 0;

    if (hasSuccess && failedAgents.length === 0) {
        p.log.success(pc.green('✓ Auto installation complete!'));
    } else if (hasSuccess) {
        p.log.warn('Auto installation completed with errors');
    } else {
        p.log.error('Auto installation failed');
        return false;
    }

    return true;
}
