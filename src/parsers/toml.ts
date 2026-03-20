/**
 * TOML Parser for agents using TOML config files
 * Handles: Codex (OpenAI)
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import type { AgentType, McpServerConfig, AgentConfig } from '../types.js';
import type { AgentParser, AgentMcpConfig, WriteOptions } from './types.js';
import { getAgentConfig } from '../agents.js';

// Simple TOML parser/serializer for MCP config
// Codex uses a simple structure that we can handle without a full TOML library

/**
 * Create a TOML parser for Codex
 */
export function createTomlParser(agentType: AgentType): AgentParser {
    const agentConfig = getAgentConfig(agentType);

    return {
        agent: agentType,
        format: 'toml',

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
                const servers = parseTomlServers(content);

                return {
                    agent: agentType,
                    configPath,
                    servers,
                    rawConfig: content,
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
                const backupPath = join(backupDir, `${agentType}-${timestamp}.toml`);
                copyFileSync(configPath, backupPath);
            }

            // Read existing or start fresh
            let existingServers: Record<string, McpServerConfig> = {};
            let existingContent = '';
            if (existsSync(configPath)) {
                existingContent = readFileSync(configPath, 'utf-8');
                existingServers = parseTomlServers(existingContent);
            }

            // Merge or replace
            const finalServers = merge
                ? { ...existingServers, ...servers }
                : servers;

            // Generate TOML content
            const tomlContent = generateTomlServers(finalServers, existingContent);
            writeFileSync(configPath, tomlContent);
        },

        async getInstalledServerNames(): Promise<string[]> {
            const config = await this.read();
            return Object.keys(config.servers);
        },

        async removeServers(names: string[]): Promise<void> {
            const configPath = agentConfig.mcpConfigPath;

            if (!existsSync(configPath)) return;

            const config = await this.read();
            for (const name of names) {
                delete config.servers[name];
            }

            await this.write(config.servers, { merge: false, backup: false });
        },
    };
}

/**
 * Parse MCP servers from TOML content
 * Codex format:
 * [mcp_servers.github]
 * command = "npx"
 * args = ["-y", "@modelcontextprotocol/server-github"]
 */
function parseTomlServers(content: string): Record<string, McpServerConfig> {
    const servers: Record<string, McpServerConfig> = {};
    const lines = content.split('\n');

    let currentServer: string | null = null;
    let currentConfig: Record<string, unknown> = {};

    for (const line of lines) {
        const trimmed = line.trim();

        // Server header: [mcp_servers.name]
        const headerMatch = trimmed.match(/^\[mcp_servers\.(\w+)\]$/);
        if (headerMatch) {
            // Save previous server
            if (currentServer) {
                servers[currentServer] = toMcpServerConfig(currentConfig);
            }
            currentServer = headerMatch[1];
            currentConfig = {};
            continue;
        }

        // Skip non-mcp sections
        if (trimmed.startsWith('[') && !trimmed.startsWith('[mcp_servers.')) {
            if (currentServer) {
                servers[currentServer] = toMcpServerConfig(currentConfig);
                currentServer = null;
                currentConfig = {};
            }
            continue;
        }

        // Parse key = value
        if (currentServer) {
            const kvMatch = trimmed.match(/^(\w+)\s*=\s*(.+)$/);
            if (kvMatch) {
                const [, key, rawValue] = kvMatch;
                currentConfig[key] = parseTomlValue(rawValue);
            }
        }
    }

    // Save last server
    if (currentServer) {
        servers[currentServer] = toMcpServerConfig(currentConfig);
    }

    return servers;
}

/**
 * Parse a TOML value
 */
function parseTomlValue(raw: string): unknown {
    const trimmed = raw.trim();

    // String
    if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
        return trimmed.slice(1, -1);
    }

    // Array
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        const inner = trimmed.slice(1, -1);
        return inner.split(',').map(s => {
            const t = s.trim();
            if (t.startsWith('"') && t.endsWith('"')) {
                return t.slice(1, -1);
            }
            return t;
        }).filter(s => s.length > 0);
    }

    // Boolean
    if (trimmed === 'true') return true;
    if (trimmed === 'false') return false;

    // Number
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
        return parseFloat(trimmed);
    }

    return trimmed;
}

/**
 * Convert raw config to McpServerConfig
 */
function toMcpServerConfig(raw: Record<string, unknown>): McpServerConfig {
    return {
        command: raw.command as string,
        args: raw.args as string[],
        env: raw.env as Record<string, string>,
        type: (raw.type as 'stdio' | 'http' | 'sse') || 'stdio',
        url: raw.url as string,
    };
}

/**
 * Generate TOML content for servers
 * Preserves non-mcp sections from original content
 */
function generateTomlServers(
    servers: Record<string, McpServerConfig>,
    existingContent: string
): string {
    // Find non-mcp sections to preserve
    const lines = existingContent.split('\n');
    const preserved: string[] = [];
    let inMcpSection = false;

    for (const line of lines) {
        const trimmed = line.trim();

        if (trimmed.startsWith('[mcp_servers.')) {
            inMcpSection = true;
            continue;
        }

        if (trimmed.startsWith('[') && !trimmed.startsWith('[mcp_servers.')) {
            inMcpSection = false;
        }

        if (!inMcpSection && trimmed.length > 0) {
            preserved.push(line);
        }
    }

    // Generate MCP servers section
    const mcpLines: string[] = [];
    for (const [name, server] of Object.entries(servers)) {
        mcpLines.push(`[mcp_servers.${name}]`);
        if (server.command) mcpLines.push(`command = "${server.command}"`);
        if (server.args?.length) {
            const args = server.args.map(a => `"${a}"`).join(', ');
            mcpLines.push(`args = [${args}]`);
        }
        if (server.type && server.type !== 'stdio') {
            mcpLines.push(`type = "${server.type}"`);
        }
        if (server.url) mcpLines.push(`url = "${server.url}"`);
        mcpLines.push('');
    }

    return [...preserved, '', ...mcpLines].join('\n').trim() + '\n';
}
