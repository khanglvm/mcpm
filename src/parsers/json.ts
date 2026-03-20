/**
 * JSON Parser for agents using JSON config files
 * Handles: Claude Code, Cursor, Windsurf, Cline, Roo, Gemini CLI,
 *          GitHub Copilot, Factory Droid, VS Code + Copilot, Antigravity,
 *          Amp, Zed, OpenCode, Goose
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import type { AgentType, McpServerConfig, AgentConfig } from '../types.js';
import type { AgentParser, AgentMcpConfig, WriteOptions } from './types.js';
import { getAgentConfig } from '../agents.js';

/**
 * Get nested value from object using dotted key (e.g., 'cody.mcpServers')
 */
function getNestedValue(obj: Record<string, unknown>, key: string): unknown {
    const parts = key.split('.');
    let current: unknown = obj;
    for (const part of parts) {
        if (current === null || typeof current !== 'object') return undefined;
        current = (current as Record<string, unknown>)[part];
    }
    return current;
}

/**
 * Set nested value in object using dotted key (e.g., 'cody.mcpServers')
 */
function setNestedValue(obj: Record<string, unknown>, key: string, value: unknown): void {
    const parts = key.split('.');
    let current = obj;
    for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        if (!(part in current) || typeof current[part] !== 'object') {
            current[part] = {};
        }
        current = current[part] as Record<string, unknown>;
    }
    current[parts[parts.length - 1]] = value;
}

/**
 * Create a JSON parser for a specific agent
 */
export function createJsonParser(agentType: AgentType): AgentParser {
    const agentConfig = getAgentConfig(agentType);

    return {
        agent: agentType,
        format: 'json',

        exists(): boolean {
            return existsSync(agentConfig.mcpConfigPath);
        },

        async read(): Promise<AgentMcpConfig> {
            const configPath = agentConfig.mcpConfigPath;

            if (!existsSync(configPath)) {
                return {
                    agent: agentType,
                    configPath,
                    servers: {},
                };
            }

            try {
                const content = readFileSync(configPath, 'utf-8');
                const raw = JSON.parse(content);
                const servers = extractServers(agentConfig, raw);

                return {
                    agent: agentType,
                    configPath,
                    servers,
                    rawConfig: raw,
                };
            } catch {
                return {
                    agent: agentType,
                    configPath,
                    servers: {},
                };
            }
        },

        async write(
            servers: Record<string, McpServerConfig>,
            options: WriteOptions = {}
        ): Promise<void> {
            const { createIfMissing = true, backup = true, merge = true } = options;
            const configPath = agentConfig.mcpConfigPath;

            // Ensure directory exists
            const dir = dirname(configPath);
            if (!existsSync(dir)) {
                if (!createIfMissing) {
                    throw new Error(`Config directory does not exist: ${dir}`);
                }
                mkdirSync(dir, { recursive: true });
            }

            // Backup if needed
            if (backup && existsSync(configPath)) {
                const backupDir = join(homedir(), '.mcpm', 'backups');
                if (!existsSync(backupDir)) {
                    mkdirSync(backupDir, { recursive: true });
                }
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                const backupPath = join(backupDir, `${agentType}-${timestamp}.json`);
                copyFileSync(configPath, backupPath);
            }

            // Read existing or start fresh
            let existing: Record<string, unknown> = {};
            if (existsSync(configPath)) {
                try {
                    existing = JSON.parse(readFileSync(configPath, 'utf-8'));
                } catch {
                    existing = {};
                }
            }

            // Transform servers for this agent
            const transformedServers = transformServersForAgent(agentConfig, servers);

            // Merge or replace
            const wrapperKey = agentConfig.wrapperKey;
            const existingServers = (getNestedValue(existing, wrapperKey) as Record<string, unknown>) || {};

            // For dotted keys, we need to set nested value
            const newConfig = { ...existing };
            setNestedValue(newConfig, wrapperKey, merge
                ? { ...existingServers, ...transformedServers }
                : transformedServers);

            writeFileSync(configPath, JSON.stringify(newConfig, null, 2) + '\n');
        },

        async getInstalledServerNames(): Promise<string[]> {
            const config = await this.read();
            return Object.keys(config.servers);
        },

        async removeServers(names: string[]): Promise<void> {
            const configPath = agentConfig.mcpConfigPath;

            if (!existsSync(configPath)) return;

            try {
                const content = readFileSync(configPath, 'utf-8');
                const raw = JSON.parse(content);
                const wrapperKey = agentConfig.wrapperKey;
                const servers = (getNestedValue(raw, wrapperKey) as Record<string, unknown>) || {};

                for (const name of names) {
                    delete servers[name];
                }

                setNestedValue(raw, wrapperKey, servers);
                writeFileSync(configPath, JSON.stringify(raw, null, 2) + '\n');
            } catch {
                // Ignore errors
            }
        },
    };
}

/**
 * Extract servers from agent-specific format to standard format
 */
function extractServers(
    agentConfig: AgentConfig,
    raw: Record<string, unknown>
): Record<string, McpServerConfig> {
    const wrapperKey = agentConfig.wrapperKey;
    const rawServers = (getNestedValue(raw, wrapperKey) as Record<string, unknown>) || {};
    const servers: Record<string, McpServerConfig> = {};

    for (const [name, rawServer] of Object.entries(rawServers)) {
        servers[name] = normalizeServer(agentConfig, rawServer);
    }

    return servers;
}

/**
 * Normalize agent-specific server format to standard format
 */
function normalizeServer(
    agentConfig: AgentConfig,
    rawServer: unknown
): McpServerConfig {
    const server = rawServer as Record<string, unknown>;

    if (agentConfig.transformCommand) {
        // OpenCode format: command is array, environment -> env
        const cmd = server.command as string[] | undefined;
        return {
            command: cmd?.[0],
            args: cmd?.slice(1) as string[],
            env: server.environment as Record<string, string>,
            type: server.type as 'stdio' | 'http' | 'sse',
            url: server.url as string,
        };
    }

    // Standard format - handle serverUrl as alias for url (used by Antigravity/Gemini)
    return {
        command: server.command as string,
        args: server.args as string[],
        env: server.env as Record<string, string>,
        type: server.type as 'stdio' | 'http' | 'sse',
        url: (server.url || server.serverUrl) as string,
        headers: server.headers as Record<string, string>,
    };
}

/**
 * Transform standard server format to agent-specific format
 */
function transformServersForAgent(
    agentConfig: AgentConfig,
    servers: Record<string, McpServerConfig>
): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    for (const [name, server] of Object.entries(servers)) {
        if (agentConfig.transformCommand) {
            // OpenCode format
            result[name] = {
                command: server.args ? [server.command, ...server.args] : [server.command],
                ...(server.env && { environment: server.env }),
                ...(server.type && { type: server.type }),
                ...(server.url && { url: server.url }),
            };
        } else {
            // Standard format - only include non-null fields
            const transformed: Record<string, unknown> = {};
            if (server.command) transformed.command = server.command;
            if (server.args?.length) transformed.args = server.args;
            if (server.env && Object.keys(server.env).length) transformed.env = server.env;
            if (server.type) transformed.type = server.type;
            if (server.url) transformed.url = server.url;
            if (server.headers && Object.keys(server.headers).length) {
                transformed.headers = server.headers;
            }
            result[name] = transformed;
        }
    }

    return result;
}
