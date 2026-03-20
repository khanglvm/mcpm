/**
 * YAML Parser for agents using YAML config files
 * Handles: Continue, Goose (optional), OpenCode (alternative)
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import yaml from 'js-yaml';
import type { AgentType, McpServerConfig, AgentConfig } from '../types.js';
import type { AgentParser, AgentMcpConfig, WriteOptions } from './types.js';
import { getAgentConfig } from '../agents.js';

/**
 * Create a YAML parser for a specific agent
 */
export function createYamlParser(agentType: AgentType): AgentParser {
    const agentConfig = getAgentConfig(agentType);

    return {
        agent: agentType,
        format: 'yaml',

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
                const raw = yaml.load(content) as Record<string, unknown> || {};
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
                const backupPath = join(backupDir, `${agentType}-${timestamp}.yaml`);
                copyFileSync(configPath, backupPath);
            }

            // Read existing or start fresh
            let existing: Record<string, unknown> = {};
            if (existsSync(configPath)) {
                try {
                    existing = yaml.load(readFileSync(configPath, 'utf-8')) as Record<string, unknown> || {};
                } catch {
                    existing = {};
                }
            }

            // Transform servers
            const transformedServers = transformServersForYaml(servers);

            // Merge or replace
            const wrapperKey = agentConfig.wrapperKey;
            const existingServers = (existing[wrapperKey] as Record<string, unknown>) || {};

            const newConfig = {
                ...existing,
                [wrapperKey]: merge
                    ? { ...existingServers, ...transformedServers }
                    : transformedServers,
            };

            const yamlContent = yaml.dump(newConfig, {
                indent: 2,
                lineWidth: 120,
                noRefs: true,
            });

            writeFileSync(configPath, yamlContent);
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
                const raw = yaml.load(content) as Record<string, unknown> || {};
                const wrapperKey = agentConfig.wrapperKey;
                const servers = (raw[wrapperKey] as Record<string, unknown>) || {};

                for (const name of names) {
                    delete servers[name];
                }

                raw[wrapperKey] = servers;
                const yamlContent = yaml.dump(raw, { indent: 2, lineWidth: 120 });
                writeFileSync(configPath, yamlContent);
            } catch {
                // Ignore errors
            }
        },
    };
}

/**
 * Extract servers from YAML config
 */
function extractServers(
    agentConfig: AgentConfig,
    raw: Record<string, unknown>
): Record<string, McpServerConfig> {
    const wrapperKey = agentConfig.wrapperKey;
    const rawServers = (raw[wrapperKey] as Record<string, unknown>) || {};
    const servers: Record<string, McpServerConfig> = {};

    for (const [name, rawServer] of Object.entries(rawServers)) {
        const server = rawServer as Record<string, unknown>;
        servers[name] = {
            command: server.command as string,
            args: server.args as string[],
            env: server.env as Record<string, string>,
            type: server.type as 'stdio' | 'http' | 'sse',
            url: server.url as string,
        };
    }

    return servers;
}

/**
 * Transform servers for YAML format
 */
function transformServersForYaml(
    servers: Record<string, McpServerConfig>
): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    for (const [name, server] of Object.entries(servers)) {
        const transformed: Record<string, unknown> = {};
        if (server.command) transformed.command = server.command;
        if (server.args?.length) transformed.args = server.args;
        if (server.env && Object.keys(server.env).length) transformed.env = server.env;
        if (server.type) transformed.type = server.type;
        if (server.url) transformed.url = server.url;
        result[name] = transformed;
    }

    return result;
}
