import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AgentType, ParsedMcpConfig, McpServerConfig } from '../types.js';
import { getAgentConfig } from '../agents.js';
import { createParser } from '../parsers/factory.js';
import { resolveEnvWithSecrets } from '../registry/keychain.js';
import { addPrefix, hasPrefix } from '../registry/naming.js';
import TOML from '@iarna/toml';
import yaml from 'js-yaml';

/**
 * Inject MCP configuration into an agent's config file
 */
export async function injectConfig(
    agentType: AgentType,
    config: ParsedMcpConfig
): Promise<void> {
    const agentConfig = getAgentConfig(agentType);

    // Resolve keychain references in env vars before injecting
    const resolvedServers = await resolveKeychainRefs(config.servers);

    // For XML format (JetBrains), use the parser directly
    if (agentConfig.configFormat === 'xml') {
        const parser = createParser(agentType);
        await parser.write(resolvedServers, { createIfMissing: true, backup: true, merge: true });
        return;
    }

    const configPath = agentConfig.mcpConfigPath;

    // Ensure directory exists
    const dir = dirname(configPath);
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
    }

    // Apply mcpm_ prefix to server names for consistency across all flows
    const prefixedServers: Record<string, McpServerConfig> = {};
    for (const [name, server] of Object.entries(resolvedServers)) {
        const prefixedName = hasPrefix(name) ? name : addPrefix(name, agentType);
        prefixedServers[prefixedName] = server;
    }

    // Transform servers for this agent
    const transformedServers = transformForAgent(agentType, prefixedServers);

    // Determine format from agent config or file extension
    const format = agentConfig.configFormat || getFormatFromPath(configPath);

    // Read existing config or create new
    let existingConfig: Record<string, unknown> = {};

    if (existsSync(configPath)) {
        try {
            const content = readFileSync(configPath, 'utf-8');
            existingConfig = parseConfig(content, format);
        } catch {
            // If parse fails, start fresh
            existingConfig = {};
        }
    }

    // Merge servers
    const wrapperKey = agentConfig.wrapperKey;
    const existingServers = (existingConfig[wrapperKey] as Record<string, unknown>) || {};

    const newConfig = {
        ...existingConfig,
        [wrapperKey]: {
            ...existingServers,
            ...transformedServers,
        },
    };

    // Write config in the correct format
    const output = stringifyConfig(newConfig, format);
    writeFileSync(configPath, output);
}

/**
 * Detect config file format from file extension
 */
function getFormatFromPath(path: string): 'json' | 'yaml' | 'toml' {
    if (path.endsWith('.toml')) return 'toml';
    if (path.endsWith('.yaml') || path.endsWith('.yml')) return 'yaml';
    return 'json';
}

/**
 * Parse config content based on format
 */
function parseConfig(content: string, format: string): Record<string, unknown> {
    switch (format) {
        case 'toml':
            return TOML.parse(content) as Record<string, unknown>;
        case 'yaml':
            return (yaml.load(content) as Record<string, unknown>) || {};
        case 'json':
        default:
            return JSON.parse(content);
    }
}

/**
 * Stringify config based on format
 */
function stringifyConfig(config: Record<string, unknown>, format: string): string {
    switch (format) {
        case 'toml':
            return TOML.stringify(config as TOML.JsonMap);
        case 'yaml':
            return yaml.dump(config, { indent: 2, lineWidth: -1 });
        case 'json':
        default:
            return JSON.stringify(config, null, 2) + '\n';
    }
}

/**
 * Resolve keychain references in server env vars.
 * Converts "keychain:serverName.envName" to actual secret values.
 * This ensures agents receive real values, not keychain references.
 */
async function resolveKeychainRefs(
    servers: Record<string, McpServerConfig>
): Promise<Record<string, McpServerConfig>> {
    const resolved: Record<string, McpServerConfig> = {};

    for (const [name, server] of Object.entries(servers)) {
        if (server.env) {
            // Convert env to plain strings and resolve keychain refs
            const plainEnv: Record<string, string> = {};
            for (const [key, value] of Object.entries(server.env)) {
                if (typeof value === 'string') {
                    plainEnv[key] = value;
                } else if (value && typeof value === 'object' && value.value) {
                    plainEnv[key] = String(value.value);
                }
                // Skip null/undefined values
            }

            const resolvedEnv = await resolveEnvWithSecrets(name, plainEnv);
            resolved[name] = { ...server, env: resolvedEnv };
        } else {
            resolved[name] = server;
        }
    }

    return resolved;
}

/**
 * Transform servers for specific agent format
 * 
 * Remote transport field mappings (from research):
 * - Antigravity: serverUrl, headers
 * - Gemini CLI: httpUrl, headers  
 * - Claude Code: type: "http", url, headers
 * - Cursor: type: "sse", url
 * - Windsurf: serverUrl, transport: "sse", headers
 * - Cline/Roo: type: "sse", url
 * - VS Code Copilot: type: "sse", url, headers (always needs type field)
 * - Continue: url, transport: "sse" (YAML)
 * - Goose: url, type: "sse" (YAML)
 * - OpenCode: command[], environment, url, type
 * - Standard fallback: url only
 */

/**
 * Flatten headers from extended schema to plain strings.
 * Extended schema: { value: string, description?, ... } -> string
 * Plain strings remain unchanged.
 */
function flattenHeaders(
    headers?: Record<string, string | null | { value: string | null; description?: string; note?: string; required?: boolean; hidden?: boolean }>
): Record<string, string> | undefined {
    if (!headers) return undefined;

    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
        if (typeof value === 'string') {
            result[key] = value;
        } else if (value && typeof value === 'object' && value.value !== null) {
            result[key] = String(value.value);
        }
        // Skip null values (not yet configured)
    }
    return Object.keys(result).length > 0 ? result : undefined;
}

function transformForAgent(
    agentType: AgentType,
    servers: Record<string, McpServerConfig>
): Record<string, unknown> {
    const agentConfig = getAgentConfig(agentType);
    const result: Record<string, unknown> = {};

    for (const [name, server] of Object.entries(servers)) {
        const isStdio = server.command || server.type === 'stdio';

        if (agentConfig.transformCommand) {
            // OpenCode format: command is array, env -> environment
            result[name] = {
                command: server.args ? [server.command, ...server.args] : [server.command],
                ...(server.env && { environment: server.env }),
                ...(server.type && { type: server.type }),
                ...(server.url && { url: server.url }),
            };
        } else if (agentType === 'zed') {
            // Zed: only stdio, no remote support
            result[name] = {
                command: server.command,
                args: server.args,
                env: server.env,
            };
        } else if (agentType === 'vscode-copilot') {
            // VS Code Copilot: always requires type field
            if (isStdio) {
                result[name] = {
                    type: 'stdio',
                    command: server.command,
                    ...(server.args?.length && { args: server.args }),
                    ...(server.env && { env: server.env }),
                };
            } else {
                result[name] = {
                    type: server.type || 'sse',
                    url: server.url,
                    ...(flattenHeaders(server.headers) && { headers: flattenHeaders(server.headers) }),
                };
            }
        } else if (agentType === 'antigravity') {
            // Antigravity: serverUrl for remote (no type field)
            if (isStdio) {
                result[name] = {
                    command: server.command,
                    ...(server.args?.length && { args: server.args }),
                    ...(server.env && { env: server.env }),
                };
            } else {
                result[name] = {
                    serverUrl: server.url,
                    ...(flattenHeaders(server.headers) && { headers: flattenHeaders(server.headers) }),
                };
            }
        } else if (agentType === 'gemini-cli') {
            // Gemini CLI: httpUrl for remote
            if (isStdio) {
                result[name] = {
                    command: server.command,
                    ...(server.args?.length && { args: server.args }),
                    ...(server.env && { env: server.env }),
                };
            } else {
                result[name] = {
                    httpUrl: server.url,
                    ...(flattenHeaders(server.headers) && { headers: flattenHeaders(server.headers) }),
                };
            }
        } else if (agentType === 'windsurf') {
            // Windsurf: serverUrl + transport for remote
            if (isStdio) {
                result[name] = {
                    command: server.command,
                    ...(server.args?.length && { args: server.args }),
                    ...(server.env && { env: server.env }),
                };
            } else {
                result[name] = {
                    serverUrl: server.url,
                    transport: server.type || 'sse',
                    ...(flattenHeaders(server.headers) && { headers: flattenHeaders(server.headers) }),
                };
            }
        } else if (agentType === 'claude-code') {
            // Claude Code: type: "http" for remote
            if (isStdio) {
                result[name] = {
                    command: server.command,
                    ...(server.args?.length && { args: server.args }),
                    ...(server.env && { env: server.env }),
                };
            } else {
                result[name] = {
                    type: server.type || 'http',
                    url: server.url,
                    ...(flattenHeaders(server.headers) && { headers: flattenHeaders(server.headers) }),
                };
            }
        } else if (agentType === 'cursor' || agentType === 'cline' || agentType === 'roo') {
            // Cursor, Cline, Roo: type: "sse" for remote
            if (isStdio) {
                result[name] = {
                    command: server.command,
                    ...(server.args?.length && { args: server.args }),
                    ...(server.env && { env: server.env }),
                };
            } else {
                result[name] = {
                    type: server.type || 'sse',
                    url: server.url,
                    ...(flattenHeaders(server.headers) && { headers: flattenHeaders(server.headers) }),
                };
            }
        } else {
            // Default format for other agents (amp, droid, github-copilot, goose, etc.)
            // Stdio: command, args, env
            // Remote: url only (no type field)
            if (isStdio) {
                result[name] = {
                    ...(server.command && { command: server.command }),
                    ...(server.args?.length && { args: server.args }),
                    ...(server.env && { env: server.env }),
                };
            } else {
                result[name] = {
                    url: server.url,
                    ...(flattenHeaders(server.headers) && { headers: flattenHeaders(server.headers) }),
                };
            }
        }
    }

    return result;
}

/**
 * Inject MCP configuration into an agent's LOCAL (project-scope) config file
 */
export async function injectLocalConfig(
    agentType: AgentType,
    config: ParsedMcpConfig
): Promise<void> {
    const agentConfig = getAgentConfig(agentType);

    if (!agentConfig.supportsLocalConfig || !agentConfig.localConfigPath) {
        throw new Error(`${agentConfig.displayName} does not support project-scope config`);
    }

    // Resolve keychain references in env vars before injecting
    const resolvedServers = await resolveKeychainRefs(config.servers);

    const configPath = agentConfig.localConfigPath;

    // Ensure directory exists
    const dir = dirname(configPath);
    if (dir && !existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
    }

    // Transform servers for this agent
    const transformedServers = transformForAgent(agentType, resolvedServers);

    // Read existing config or create new
    let existingConfig: Record<string, unknown> = {};

    if (existsSync(configPath)) {
        try {
            const content = readFileSync(configPath, 'utf-8');
            existingConfig = JSON.parse(content);
        } catch {
            // If parse fails, start fresh
            existingConfig = {};
        }
    }

    // Merge servers
    const wrapperKey = agentConfig.wrapperKey;
    const existingServers = (existingConfig[wrapperKey] as Record<string, unknown>) || {};

    const newConfig = {
        ...existingConfig,
        [wrapperKey]: {
            ...existingServers,
            ...transformedServers,
        },
    };

    // Write config
    writeFileSync(configPath, JSON.stringify(newConfig, null, 2) + '\n');
}
