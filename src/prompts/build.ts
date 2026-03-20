/**
 * Build mode - Interactive MCP server configuration
 * 
 * Flow:
 * 1. Server name
 * 2. Transport selection (Local command / Remote URL)
 * 3. For stdio: command + args
 * 4. For http/sse: URL + headers
 * 5. Environment variables loop (0-n)
 * 6. Optional: Verification
 * 7. Save to registry
 */

import * as p from '@clack/prompts';
import pc from 'picocolors';
import type { TransportType, RegistryServer } from '../registry/types.js';
import { addServer, serverExists, AGENT_TRANSPORT_SUPPORT } from '../registry/index.js';
import { storeSecret, isKeychainAvailable } from '../registry/keychain.js';
import { isCancel } from '@clack/prompts';

/**
 * Result from build mode
 */
export interface BuildResult {
    server: RegistryServer;
    stored: boolean;
}

/**
 * Run build mode to create a new MCP server configuration
 */
export async function runBuildMode(): Promise<BuildResult | null> {
    p.note('Build a new MCP server configuration from scratch.', 'Build Mode');

    // 1. Server name
    const name = await p.text({
        message: 'Server name',
        placeholder: 'github',
        validate: (value) => {
            if (!value || value.length < 2) {
                return 'Name must be at least 2 characters';
            }
            if (!/^[a-z0-9][a-z0-9_-]*$/.test(value)) {
                return 'Name must be lowercase, start with letter/number, use only a-z, 0-9, -, _';
            }
            if (serverExists(value)) {
                return `Server "${value}" already exists in registry`;
            }
            return undefined;
        },
    });

    if (isCancel(name)) {
        p.cancel('Build cancelled');
        return null;
    }

    // 2. Transport selection
    const transport = await p.select<TransportType>({
        message: 'How will you run this server?',
        options: [
            {
                value: 'stdio',
                label: 'Local command (npx, uvx, binary)',
                hint: 'Run a local package like `npx @mcp/server-github`',
            },
            {
                value: 'http',
                label: 'Remote URL (HTTP/SSE)',
                hint: 'Connect to a hosted server like `https://api.example.com/mcp`',
            },
        ],
    });

    if (isCancel(transport)) {
        p.cancel('Build cancelled');
        return null;
    }

    let command: string | undefined;
    let args: string[] | undefined;
    let url: string | undefined;
    let headers: Record<string, string> | undefined;

    // 3. Transport-specific prompts
    if (transport === 'stdio') {
        // Command
        const cmd = await p.text({
            message: 'Command to run',
            placeholder: 'npx',
            validate: (value) => {
                if (!value || value.length < 1) {
                    return 'Command is required';
                }
                return undefined;
            },
        });

        if (isCancel(cmd)) {
            p.cancel('Build cancelled');
            return null;
        }
        command = cmd;

        // Arguments
        const argsInput = await p.text({
            message: 'Arguments (space-separated)',
            placeholder: '-y @modelcontextprotocol/server-github',
        });

        if (isCancel(argsInput)) {
            p.cancel('Build cancelled');
            return null;
        }

        if (argsInput) {
            // Parse arguments, respecting quotes
            args = parseArgs(argsInput);
        }
    } else {
        // URL for http/sse
        const urlInput = await p.text({
            message: 'Server URL',
            placeholder: 'https://api.example.com/mcp',
            validate: (value) => {
                if (!value) return 'URL is required';
                try {
                    new URL(value);
                    return undefined;
                } catch {
                    return 'Invalid URL format';
                }
            },
        });

        if (isCancel(urlInput)) {
            p.cancel('Build cancelled');
            return null;
        }
        url = urlInput;

        // Optional headers
        const addHeaders = await p.confirm({
            message: 'Add custom headers?',
            initialValue: false,
        });

        if (isCancel(addHeaders)) {
            p.cancel('Build cancelled');
            return null;
        }

        if (addHeaders) {
            const collected = await collectHeaders();
            if (collected === null) return null;
            headers = collected;
        }
    }

    // 4. Environment variables loop
    const env = await collectEnvVariables(name);
    if (env === null) return null;

    // 5. Show incompatibility warnings
    showTransportWarnings(transport);

    // 6. Create server config
    const server: RegistryServer = {
        name,
        transport,
        ...(command && { command }),
        ...(args?.length && { args }),
        ...(url && { url }),
        ...(headers && { headers }),
        ...(Object.keys(env).length && { env }),
        createdAt: new Date().toISOString(),
    };

    // 7. Confirm and save
    const confirm = await p.confirm({
        message: 'Save to registry?',
        initialValue: true,
    });

    if (isCancel(confirm) || !confirm) {
        p.cancel('Build cancelled - server not saved');
        return null;
    }

    addServer(server);
    p.log.success(`Server "${name}" saved to registry`);

    return { server, stored: true };
}

/**
 * Parse space-separated arguments, respecting quotes
 */
function parseArgs(input: string): string[] {
    const args: string[] = [];
    let current = '';
    let inQuote = false;
    let quoteChar = '';

    for (const char of input) {
        if ((char === '"' || char === "'") && !inQuote) {
            inQuote = true;
            quoteChar = char;
        } else if (char === quoteChar && inQuote) {
            inQuote = false;
            quoteChar = '';
        } else if (char === ' ' && !inQuote) {
            if (current) {
                args.push(current);
                current = '';
            }
        } else {
            current += char;
        }
    }

    if (current) {
        args.push(current);
    }

    return args;
}

/**
 * Collect custom headers in a loop
 */
async function collectHeaders(): Promise<Record<string, string> | null> {
    const headers: Record<string, string> = {};

    while (true) {
        const headerName = await p.text({
            message: 'Header name (empty to finish)',
            placeholder: 'Authorization',
        });

        if (isCancel(headerName)) {
            p.cancel('Build cancelled');
            return null;
        }

        if (!headerName) break;

        const headerValue = await p.text({
            message: `Value for ${headerName}`,
            placeholder: 'Bearer <token>',
        });

        if (isCancel(headerValue)) {
            p.cancel('Build cancelled');
            return null;
        }

        headers[headerName] = headerValue || '';
    }

    return headers;
}

/**
 * Collect environment variables in a loop
 */
async function collectEnvVariables(serverName: string): Promise<Record<string, string> | null> {
    const env: Record<string, string> = {};
    const keychainAvailable = await isKeychainAvailable();

    const addEnv = await p.confirm({
        message: 'Add environment variables?',
        initialValue: false,
    });

    if (isCancel(addEnv)) {
        p.cancel('Build cancelled');
        return null;
    }

    if (!addEnv) return env;

    while (true) {
        const varName = await p.text({
            message: 'Variable name (empty to finish)',
            placeholder: 'GITHUB_TOKEN',
            validate: (value) => {
                if (!value) return undefined; // Allow empty to finish
                if (!/^[A-Z][A-Z0-9_]*$/.test(value)) {
                    return 'Variable name must be uppercase with underscores';
                }
                return undefined;
            },
        });

        if (isCancel(varName)) {
            p.cancel('Build cancelled');
            return null;
        }

        if (!varName) break;

        // Is this a secret?
        const isSecret = await p.confirm({
            message: 'Is this a secret (like a token or password)?',
            initialValue: varName.includes('TOKEN') ||
                varName.includes('SECRET') ||
                varName.includes('KEY') ||
                varName.includes('PASSWORD'),
        });

        if (isCancel(isSecret)) {
            p.cancel('Build cancelled');
            return null;
        }

        if (isSecret && keychainAvailable) {
            // Store in keychain
            const storeInKeychain = await p.confirm({
                message: 'Store in system keychain? (recommended)',
                initialValue: true,
            });

            if (isCancel(storeInKeychain)) {
                p.cancel('Build cancelled');
                return null;
            }

            const value = await p.password({
                message: `Value for ${varName}`,
                mask: '*',
            });

            if (isCancel(value)) {
                p.cancel('Build cancelled');
                return null;
            }

            if (storeInKeychain) {
                await storeSecret(serverName, varName, value);
                env[varName] = `keychain:${serverName}.${varName}`;
                p.log.info(`${varName} stored in keychain`);
            } else {
                env[varName] = value;
            }
        } else {
            // Regular value
            const value = isSecret
                ? await p.password({ message: `Value for ${varName}`, mask: '*' })
                : await p.text({ message: `Value for ${varName}` });

            if (isCancel(value)) {
                p.cancel('Build cancelled');
                return null;
            }

            env[varName] = value || '';
        }

        // Another variable?
        const another = await p.confirm({
            message: 'Add another variable?',
            initialValue: false,
        });

        if (isCancel(another) || !another) break;
    }

    return env;
}

/**
 * Show warnings for agents that don't support this transport
 */
function showTransportWarnings(transport: TransportType): void {
    const unsupported: string[] = [];

    for (const [agent, support] of Object.entries(AGENT_TRANSPORT_SUPPORT)) {
        if (!support[transport]) {
            unsupported.push(agent);
        }
    }

    if (unsupported.length > 0) {
        p.log.warn(
            `${pc.yellow('Note:')} ${transport} transport not supported by: ` +
            unsupported.join(', ')
        );
    }
}
