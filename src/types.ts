/**
 * Supported AI agent types
 */
export type AgentType =
    | 'amazon-q'
    | 'amp'
    | 'antigravity'
    | 'claude-code'
    | 'claude-desktop'
    | 'cline'
    | 'codex'
    | 'cody'
    | 'continue'
    | 'cursor'
    | 'droid'
    | 'gemini-cli'
    | 'github-copilot'
    | 'goose'
    | 'jetbrains-ai'
    | 'jetbrains-github-copilot'
    | 'opencode'
    | 'roo'
    | 'vscode-copilot'
    | 'windsurf'
    | 'zed';

/**
 * Installation scope for MCP configs
 */
export type InstallScope = 'global' | 'project';

/**
 * Agent configuration
 */
export interface AgentConfig {
    name: AgentType;
    displayName: string;
    configDir: string;
    mcpConfigPath: string;
    wrapperKey: WrapperKey;
    configFormat?: 'json' | 'yaml' | 'toml' | 'xml';
    transformCommand?: boolean; // For OpenCode special format
    detectInstalled: () => boolean;
    /** Whether this agent supports project-scope (local) config */
    supportsLocalConfig?: boolean;
    /** Path to local config file relative to project root */
    localConfigPath?: string;
}

/**
 * MCP config wrapper keys used by different tools
 */
export type WrapperKey =
    | 'cody.mcpServers' // Sourcegraph Cody
    | 'mcpServers'     // Claude, Cursor, Windsurf, Amazon Q, etc.
    | 'servers'        // VS Code + Copilot
    | 'context_servers' // Zed
    | 'mcp'            // OpenCode
    | 'mcp_servers';   // Codex (TOML)

/**
 * Standard MCP server configuration
 */
export interface McpServerConfig {
    command?: string;
    args?: string[];
    env?: Record<string, string | null | EnvVarSchema>;
    type?: 'stdio' | 'http' | 'sse';
    url?: string;
    /**
     * HTTP headers for remote transports.
     * Supports same extended schema as env for descriptions, help URLs, and keychain.
     */
    headers?: Record<string, string | null | EnvVarSchema>;
}

/**
 * Extended env variable schema with helper info
 */
export interface EnvVarSchema {
    value: string | null;
    description?: string;
    note?: string;
    required?: boolean;
    hidden?: boolean;
}

/**
 * Parsed MCP configuration
 */
export interface ParsedMcpConfig {
    servers: Record<string, McpServerConfig>;
    sourceFormat: 'json' | 'yaml' | 'toml';
    sourceWrapperKey: WrapperKey | string;
}

/**
 * Config source types
 */
export type ConfigSource = 'paste' | 'build' | 'github';

/**
 * Extended env config from CLI arguments
 * Parsed from --env:KEY=VALUE::modifier format
 */
export interface CliEnvConfig {
    value: string | null;
    description?: string;
    note?: string;
    required?: boolean;
    hidden?: boolean;
}

/**
 * Options for automated (-y) installation mode
 */
export interface AutoOptions {
    enabled: boolean;
    scope: InstallScope;
    preAgents?: AgentType[];
    /** If true, auto-select all compatible agents based on transport and scope */
    autoSelectAll?: boolean;
}

