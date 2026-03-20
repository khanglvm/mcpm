import yaml from 'js-yaml';
import * as TOML from '@iarna/toml';
import type { ParsedMcpConfig, WrapperKey, McpServerConfig } from '../types.js';

/**
 * Known wrapper keys for different tools
 */
const WRAPPER_KEYS: WrapperKey[] = [
    'mcpServers',
    'servers',
    'context_servers',
    'mcp',
    'mcp_servers',
];

/**
 * Detect format and parse MCP configuration
 */
export function parseConfig(input: string): ParsedMcpConfig {
    const trimmed = input.trim();

    // Try JSON first
    if (trimmed.startsWith('{')) {
        return parseJsonConfig(trimmed);
    }

    // Try TOML (starts with [ for section or key = for assignment)
    if (isTOML(trimmed)) {
        return parseTomlConfig(trimmed);
    }

    // Try YAML
    return parseYamlConfig(trimmed);
}

/**
 * Check if input looks like TOML format
 */
function isTOML(input: string): boolean {
    // TOML sections start with [
    if (input.startsWith('[')) return true;

    // Check for TOML-style key = value patterns at start of lines
    const tomlPatterns = [
        /^\s*\w+\s*=\s*["\[\{]/m,  // key = "value" or key = [ or key = {
        /^\s*\[[\w.]+\]/m,         // [section] or [section.subsection]
    ];

    return tomlPatterns.some(p => p.test(input));
}

/**
 * Parse JSON configuration
 */
function parseJsonConfig(input: string): ParsedMcpConfig {
    let parsed: Record<string, unknown>;

    try {
        parsed = JSON.parse(input);
    } catch (err) {
        throw new Error(`Invalid JSON: ${err instanceof Error ? err.message : 'Parse error'}`);
    }

    return extractServers(parsed, 'json');
}

/**
 * Parse YAML configuration
 */
function parseYamlConfig(input: string): ParsedMcpConfig {
    let parsed: Record<string, unknown>;

    try {
        parsed = yaml.load(input) as Record<string, unknown>;
    } catch (err) {
        throw new Error(`Invalid YAML: ${err instanceof Error ? err.message : 'Parse error'}`);
    }

    if (!parsed || typeof parsed !== 'object') {
        throw new Error('Invalid YAML: must be an object');
    }

    return extractServers(parsed, 'yaml');
}

/**
 * Parse TOML configuration
 */
function parseTomlConfig(input: string): ParsedMcpConfig {
    let parsed: Record<string, unknown>;

    try {
        parsed = TOML.parse(input) as Record<string, unknown>;
    } catch (err) {
        throw new Error(`Invalid TOML: ${err instanceof Error ? err.message : 'Parse error'}`);
    }

    if (!parsed || typeof parsed !== 'object') {
        throw new Error('Invalid TOML: must be an object');
    }

    return extractServers(parsed, 'toml');
}

/**
 * Extract servers from parsed config, auto-detecting wrapper key
 */
function extractServers(
    parsed: Record<string, unknown>,
    sourceFormat: 'json' | 'yaml' | 'toml'
): ParsedMcpConfig {
    // Find wrapper key
    let wrapperKey: WrapperKey | string | undefined;
    let serversObj: Record<string, unknown> | undefined;

    for (const key of WRAPPER_KEYS) {
        if (key in parsed) {
            wrapperKey = key;
            serversObj = parsed[key] as Record<string, unknown>;
            break;
        }
    }

    // If no known wrapper key, check if it's a direct server config
    if (!wrapperKey) {
        // Check if this looks like a direct server config (has command or url)
        const firstValue = Object.values(parsed)[0];
        if (firstValue && typeof firstValue === 'object' && ('command' in firstValue || 'url' in firstValue)) {
            wrapperKey = 'direct';
            serversObj = parsed;
        } else {
            throw new Error('Could not detect MCP configuration format. Expected mcpServers, servers, context_servers, mcp, or mcp_servers key.');
        }
    }

    if (!serversObj || typeof serversObj !== 'object') {
        throw new Error(`Invalid ${wrapperKey} value: must be an object`);
    }

    // Validate and normalize servers
    const servers: Record<string, McpServerConfig> = {};

    for (const [name, config] of Object.entries(serversObj)) {
        if (!config || typeof config !== 'object') {
            throw new Error(`Invalid server config for "${name}": must be an object`);
        }

        const serverConfig = config as Record<string, unknown>;

        // Handle OpenCode special format (command is array)
        if (Array.isArray(serverConfig.command)) {
            const [cmd, ...args] = serverConfig.command as string[];
            servers[name] = {
                command: cmd,
                args,
                env: (serverConfig.environment || serverConfig.env) as Record<string, string | null> | undefined,
                type: normalizeType(serverConfig.type),
            };
        } else {
            servers[name] = {
                command: serverConfig.command as string | undefined,
                args: serverConfig.args as string[] | undefined,
                env: serverConfig.env as McpServerConfig['env'],
                type: normalizeType(serverConfig.type),
                url: serverConfig.url as string | undefined,
                // Headers can be plain strings or extended schema (like env)
                headers: serverConfig.headers as McpServerConfig['headers'],
            };
        }
    }

    return {
        servers,
        sourceFormat,
        sourceWrapperKey: wrapperKey,
    };
}

/**
 * Normalize transport type to lowercase
 */
function normalizeType(type: unknown): 'stdio' | 'http' | 'sse' | undefined {
    if (typeof type !== 'string') return undefined;
    const lower = type.toLowerCase();
    if (lower === 'stdio' || lower === 'http' || lower === 'sse') {
        return lower;
    }
    return undefined;
}
