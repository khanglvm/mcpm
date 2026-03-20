/**
 * MCP Server Validation Module
 * Connects to MCP servers and lists their exposed tools for validation
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import type { McpServerConfig } from '../types.js';

/** Timeout for server validation in milliseconds */
const VALIDATION_TIMEOUT_MS = 15000;

/**
 * Information about a single tool exposed by an MCP server
 */
export interface ToolInfo {
    name: string;
    description?: string;
}

/**
 * Result of validating a single MCP server
 */
export interface ValidationResult {
    serverName: string;
    success: boolean;
    tools?: ToolInfo[];
    error?: string;
}

/**
 * Validate a single MCP server by connecting and listing its tools
 */
export async function validateMcpServer(
    serverName: string,
    config: McpServerConfig
): Promise<ValidationResult> {
    const isStdio = config.command || config.type === 'stdio';

    try {
        if (isStdio) {
            return await validateStdioServer(serverName, config);
        } else {
            return await validateRemoteServer(serverName, config);
        }
    } catch (err) {
        return {
            serverName,
            success: false,
            error: err instanceof Error ? err.message : 'Unknown error',
        };
    }
}

/**
 * Auto-execute flags for common package runners
 * Maps command names to their auto-execute flags
 *
 * Runners that auto-run by default (no flag needed):
 * - bunx: auto-runs without prompt
 * - uvx: auto-runs without prompt (Python uv package runner)
 * - yarn dlx: auto-runs without prompt
 * - deno: auto-installs npm packages without prompt
 */
const AUTO_EXECUTE_FLAGS: Record<string, string[]> = {
    npx: ['-y'],
    pnpx: ['-y'], // pnpm's package runner
};

/**
 * Ensure auto-execute flags are present for package runners during validation.
 * This prevents interactive prompts that would cause validation to hang.
 * @returns Modified args array with auto-execute flags if applicable
 */
function ensureAutoExecuteFlags(command: string, args?: string[]): string[] | undefined {
    const commandName = command.split('/').pop()?.toLowerCase();
    const flags = commandName ? AUTO_EXECUTE_FLAGS[commandName] : undefined;

    if (!flags || flags.length === 0) {
        return args;
    }

    const currentArgs = args ?? [];

    // Check if any of the auto-execute flags are already present
    const hasAutoFlag = flags.some((flag) =>
        currentArgs.some((arg) => arg === flag || arg.startsWith(`${flag}=`))
    );

    if (hasAutoFlag) {
        return currentArgs;
    }

    // Prepend auto-execute flags to args
    return [...flags, ...currentArgs];
}

/**
 * Validate a stdio-based MCP server
 */
async function validateStdioServer(
    serverName: string,
    config: McpServerConfig
): Promise<ValidationResult> {
    if (!config.command) {
        return {
            serverName,
            success: false,
            error: 'No command specified for stdio server',
        };
    }

    // Flatten env values to strings
    const env: Record<string, string> = {};
    if (config.env) {
        for (const [key, value] of Object.entries(config.env)) {
            if (typeof value === 'string') {
                env[key] = value;
            } else if (value && typeof value === 'object' && 'value' in value && value.value) {
                env[key] = value.value;
            }
        }
    }

    // Build environment with process.env filtered to string-only values
    const processEnvFiltered: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
        if (value !== undefined) {
            processEnvFiltered[key] = value;
        }
    }

    // Ensure auto-execute flags are present for validation
    const validationArgs = ensureAutoExecuteFlags(config.command, config.args);

    const transport = new StdioClientTransport({
        command: config.command,
        args: validationArgs,
        env: { ...processEnvFiltered, ...env },
    });

    const client = new Client(
        { name: 'mcpm-validator', version: '1.0.0' },
        { capabilities: {} }
    );

    try {
        // Connect with timeout
        await Promise.race([
            client.connect(transport),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Connection timeout')), VALIDATION_TIMEOUT_MS)
            ),
        ]);

        // List tools
        const toolsResult = await Promise.race([
            client.listTools(),
            new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error('listTools timeout')), VALIDATION_TIMEOUT_MS)
            ),
        ]);

        const tools: ToolInfo[] = toolsResult.tools.map((t) => ({
            name: t.name,
            description: t.description,
        }));

        await client.close();

        return {
            serverName,
            success: true,
            tools,
        };
    } catch (err) {
        try {
            await client.close();
        } catch {
            // Ignore close errors
        }
        throw err;
    }
}

/**
 * Validate a remote (HTTP/SSE) MCP server
 */
async function validateRemoteServer(
    serverName: string,
    config: McpServerConfig
): Promise<ValidationResult> {
    if (!config.url) {
        return {
            serverName,
            success: false,
            error: 'No URL specified for remote server',
        };
    }

    // Flatten headers to strings
    const headers: Record<string, string> = {};
    if (config.headers) {
        for (const [key, value] of Object.entries(config.headers)) {
            if (typeof value === 'string') {
                headers[key] = value;
            } else if (value && typeof value === 'object' && 'value' in value && value.value) {
                headers[key] = value.value;
            }
        }
    }

    // Use SSE transport for now (most common for remote MCP servers)
    const transport = new SSEClientTransport(new URL(config.url), {
        requestInit: {
            headers,
        },
    });

    const client = new Client(
        { name: 'mcpm-validator', version: '1.0.0' },
        { capabilities: {} }
    );

    try {
        // Connect with timeout
        await Promise.race([
            client.connect(transport),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Connection timeout')), VALIDATION_TIMEOUT_MS)
            ),
        ]);

        // List tools
        const toolsResult = await Promise.race([
            client.listTools(),
            new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error('listTools timeout')), VALIDATION_TIMEOUT_MS)
            ),
        ]);

        const tools: ToolInfo[] = toolsResult.tools.map((t) => ({
            name: t.name,
            description: t.description,
        }));

        await client.close();

        return {
            serverName,
            success: true,
            tools,
        };
    } catch (err) {
        try {
            await client.close();
        } catch {
            // Ignore close errors
        }
        throw err;
    }
}

/**
 * Validate all MCP servers in parallel
 */
export async function validateAllServers(
    servers: Record<string, McpServerConfig>
): Promise<ValidationResult[]> {
    const entries = Object.entries(servers);

    // Run validations in parallel with individual error handling
    const results = await Promise.all(
        entries.map(([name, config]) => validateMcpServer(name, config))
    );

    return results;
}
