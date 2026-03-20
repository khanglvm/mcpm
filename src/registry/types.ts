/**
 * Registry types for mcpm
 * Centralized MCP server configuration management
 */

/**
 * Transport types supported by MCP
 */
export type TransportType = 'stdio' | 'http' | 'sse';

/**
 * Transport support for an agent
 */
export interface AgentTransportSupport {
    stdio: boolean;
    http: boolean;
    sse: boolean;
}

/**
 * Registry server configuration
 * Stored in ~/.mcpm/registry.json
 */
export interface RegistryServer {
    /** Clean name (no prefix) */
    name: string;

    /** Transport type */
    transport: TransportType;

    /** For stdio: command to run */
    command?: string;

    /** For stdio: command arguments */
    args?: string[];

    /** For http/sse: server URL */
    url?: string;

    /** For http/sse: custom headers (supports extended schema) */
    headers?: Record<string, string | null | { value: string | null; description?: string; note?: string; required?: boolean; hidden?: boolean }>;

    /** Environment variables (value or keychain reference) */
    env?: Record<string, string>;

    /** Original schema without values - for reconfiguration */
    schema?: {
        env?: Record<string, CredentialSchema>;
        headers?: Record<string, CredentialSchema>;
    };

    /** When this server was added */
    createdAt: string;

    /** Last sync timestamp */
    lastSyncedAt?: string;

    /** Description/notes */
    description?: string;

    /** Agent this was imported from (if any) */
    importedFrom?: string;
}

/**
 * Schema for a single credential field (env var or header)
 */
export interface CredentialSchema {
    description?: string;
    note?: string;
    required?: boolean;
    hidden?: boolean;
}

/**
 * Registry file structure
 * ~/.mcpm/registry.json
 */
export interface Registry {
    /** Registry format version */
    version: '1.0';

    /** MCP servers by name */
    servers: Record<string, RegistryServer>;

    /** Registry metadata */
    meta?: {
        lastModified: string;
        description?: string;
    };
}

/**
 * Keychain reference format
 * Stored in env as: "keychain:<server>.<envName>"
 */
export const KEYCHAIN_PREFIX = 'keychain:';

/**
 * Check if a value is a keychain reference
 */
export function isKeychainRef(value: string): boolean {
    return value.startsWith(KEYCHAIN_PREFIX);
}

/**
 * Create a keychain reference
 */
export function makeKeychainRef(serverName: string, envName: string): string {
    return `${KEYCHAIN_PREFIX}${serverName}.${envName}`;
}

/**
 * Parse a keychain reference to get server and env name
 */
export function parseKeychainRef(ref: string): { serverName: string; envName: string } | null {
    if (!isKeychainRef(ref)) return null;

    const parts = ref.slice(KEYCHAIN_PREFIX.length).split('.');
    if (parts.length < 2) return null;

    return {
        serverName: parts[0],
        envName: parts.slice(1).join('.'),
    };
}

/**
 * Transport support matrix for known agents
 * Based on research: 2025-2026 documentation
 */
export const AGENT_TRANSPORT_SUPPORT: Record<string, AgentTransportSupport> = {
    'amp': { stdio: true, http: true, sse: true },
    'antigravity': { stdio: true, http: true, sse: true },
    'claude-code': { stdio: true, http: true, sse: true },
    'cline': { stdio: true, http: true, sse: true },
    'codex': { stdio: true, http: false, sse: false }, // stdio only
    'continue': { stdio: true, http: true, sse: false }, // SSE deprecated
    'cursor': { stdio: true, http: true, sse: true },
    'droid': { stdio: true, http: true, sse: false }, // SSE deprecated
    'gemini-cli': { stdio: true, http: true, sse: true },
    'github-copilot': { stdio: true, http: true, sse: false }, // SSE legacy
    'goose': { stdio: true, http: true, sse: false }, // SSE deprecated
    'opencode': { stdio: true, http: true, sse: false }, // Streamable HTTP
    'roo': { stdio: true, http: true, sse: true },
    'vscode-copilot': { stdio: true, http: true, sse: false }, // SSE legacy
    'windsurf': { stdio: true, http: true, sse: true },
    'zed': { stdio: true, http: false, sse: false }, // stdio only via SSH
};

/**
 * Get agents that don't support a transport type
 */
export function getUnsupportedAgents(transport: TransportType): string[] {
    return Object.entries(AGENT_TRANSPORT_SUPPORT)
        .filter(([_, support]) => !support[transport])
        .map(([agent]) => agent);
}
