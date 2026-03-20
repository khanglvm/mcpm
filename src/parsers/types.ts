/**
 * Agent parser types
 * Read/write MCP configurations for all supported agents
 */

import type { AgentType, McpServerConfig } from '../types.js';

/**
 * Result of reading an agent's MCP config
 */
export interface AgentMcpConfig {
    /** Agent type */
    agent: AgentType;

    /** Path to config file */
    configPath: string;

    /** MCP servers found in config */
    servers: Record<string, McpServerConfig>;

    /** Raw config content for debugging */
    rawConfig?: unknown;
}

/**
 * Options for writing to agent config
 */
export interface WriteOptions {
    /** Create config file if not exists */
    createIfMissing?: boolean;

    /** Backup before writing */
    backup?: boolean;

    /** Merge with existing servers (true) or replace all (false) */
    merge?: boolean;
}

/**
 * Parser interface for all agents
 */
export interface AgentParser {
    /** Agent type this parser handles */
    readonly agent: AgentType;

    /** Config format: json, yaml, toml, or xml */
    readonly format: 'json' | 'yaml' | 'toml' | 'xml';

    /** Read MCP servers from agent config */
    read(): Promise<AgentMcpConfig>;

    /** Write MCP servers to agent config */
    write(servers: Record<string, McpServerConfig>, options?: WriteOptions): Promise<void>;

    /** Check if config file exists */
    exists(): boolean;

    /** Get list of server names currently installed */
    getInstalledServerNames(): Promise<string[]>;

    /** Remove specific servers by name */
    removeServers(names: string[]): Promise<void>;
}

/**
 * Server format variations by agent
 */
export type ServerFormat =
    | 'standard'     // command, args, env
    | 'opencode'     // command as array, env -> environment
    | 'zed'          // context_servers wrapper
    | 'vscode';      // servers wrapper

/**
 * Transform config from standard format to agent-specific format
 */
export type ServerTransformer = (
    name: string,
    server: McpServerConfig
) => unknown;

/**
 * Transform config from agent-specific format to standard format
 */
export type ServerNormalizer = (
    name: string,
    rawServer: unknown
) => McpServerConfig;
