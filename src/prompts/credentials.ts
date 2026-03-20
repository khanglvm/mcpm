import * as p from '@clack/prompts';
import pc from 'picocolors';
import type { ParsedMcpConfig, EnvVarSchema, McpServerConfig } from '../types.js';
import { storeSecret, isKeychainAvailable } from '../registry/keychain.js';

/**
 * Patterns for detecting secrets in credential NAMES (env vars or headers)
 */
const SECRET_NAME_PATTERNS = [
    /api[_-]?key/i,
    /secret/i,
    /token/i,
    /password/i,
    /passwd/i,
    /credential/i,
    /auth/i,
    /private[_-]?key/i,
    /access[_-]?key/i,
    /client[_-]?secret/i,
    /bearer/i,
    /oauth/i,
    /jwt/i,
    /signing[_-]?key/i,
    /encryption[_-]?key/i,
    /ssh[_-]?key/i,
    // HTTP header specific
    /^authorization$/i,
    /^x-api-key$/i,
    /^x-auth-token$/i,
];

/**
 * Regex patterns for detecting API key VALUES by provider
 * Based on GitLeaks/TruffleHog patterns
 */
const SECRET_VALUE_PATTERNS: { name: string; pattern: RegExp }[] = [
    // OpenAI
    { name: 'OpenAI', pattern: /^sk-[a-zA-Z0-9]{32,}$/ },
    // Anthropic
    { name: 'Anthropic', pattern: /^sk-ant-[a-zA-Z0-9-_]{32,}$/ },
    // AWS Access Key
    { name: 'AWS', pattern: /^AKIA[0-9A-Z]{16}$/ },
    // AWS Secret Key
    { name: 'AWS Secret', pattern: /^[A-Za-z0-9/+=]{40}$/ },
    // GitHub Token
    { name: 'GitHub', pattern: /^gh[pousr]_[A-Za-z0-9]{36,}$/ },
    // GitLab Token
    { name: 'GitLab', pattern: /^glpat-[A-Za-z0-9\-_]{20,}$/ },
    // Stripe
    { name: 'Stripe', pattern: /^sk_(live|test)_[A-Za-z0-9]{24,}$/ },
    // Twilio
    { name: 'Twilio', pattern: /^SK[a-z0-9]{32}$/ },
    // SendGrid
    { name: 'SendGrid', pattern: /^SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/ },
    // Slack
    { name: 'Slack', pattern: /^xox[baprs]-[0-9]{10,}-[A-Za-z0-9]{24,}$/ },
    // Google API Key
    { name: 'Google', pattern: /^AIza[A-Za-z0-9_-]{35}$/ },
    // Firebase
    { name: 'Firebase', pattern: /^[A-Za-z0-9]{40}$/ },
    // Supabase
    { name: 'Supabase', pattern: /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/ },
    // Generic JWT / Bearer token
    { name: 'JWT', pattern: /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/ },
    { name: 'Bearer', pattern: /^Bearer\s+\S+$/i },
    // Private Key (PEM format)
    { name: 'Private Key', pattern: /^-+BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-+/ },
    // Generic long hex strings (likely secrets)
    { name: 'Hex Secret', pattern: /^[a-f0-9]{32,}$/i },
    // Generic base64 (40+ chars, likely a key)
    { name: 'Base64 Secret', pattern: /^[A-Za-z0-9+/=]{40,}$/ },
];

/**
 * Check if credential name looks like a secret
 */
function isSecretName(name: string): boolean {
    return SECRET_NAME_PATTERNS.some(pattern => pattern.test(name));
}

/**
 * Check if value looks like a known API key pattern
 */
function detectSecretValue(value: string): { isSecret: boolean; provider?: string } {
    for (const { name, pattern } of SECRET_VALUE_PATTERNS) {
        if (pattern.test(value)) {
            return { isSecret: true, provider: name };
        }
    }
    return { isSecret: false };
}

/**
 * Detect if a server config uses HTTP transport
 */
function isHttpTransport(server: McpServerConfig): boolean {
    return !server.command && (
        !!server.url ||
        server.type === 'http' ||
        server.type === 'sse'
    );
}

/**
 * Prompt for credential entries (shared logic for env and headers)
 */
async function promptForCredentials(
    serverName: string,
    entries: Record<string, string | null | EnvVarSchema>,
    credentialType: 'env' | 'headers',
    keychainAvailable: boolean,
    preconfiguredKeys?: Set<string>
): Promise<Record<string, string> | null> {
    const result: Record<string, string> = {};
    const missingEntries: [string, unknown][] = [];

    // Separate pre-filled and missing
    for (const [key, schema] of Object.entries(entries)) {
        const isExtended = typeof schema === 'object' && schema !== null && 'value' in schema;

        let existingValue: string | null = null;
        if (typeof schema === 'string') {
            existingValue = schema;
        } else if (isExtended && (schema as EnvVarSchema).value !== null) {
            existingValue = String((schema as EnvVarSchema).value);
        }

        if (existingValue) {
            result[key] = existingValue;
        } else {
            missingEntries.push([key, schema]);
        }
    }

    if (missingEntries.length === 0) {
        return result;
    }

    // Show prompt header
    const typeLabel = credentialType === 'headers' ? 'HTTP headers' : 'environment';
    p.log.info(`Configure ${serverName} ${typeLabel} (${missingEntries.length} missing value${missingEntries.length > 1 ? 's' : ''}):`);

    for (const [key, schema] of missingEntries) {
        const isExtended = typeof schema === 'object' && schema !== null && 'value' in schema;
        const description = isExtended ? (schema as EnvVarSchema).description : undefined;
        const note = isExtended ? (schema as EnvVarSchema).note : undefined;

        // Smart detection: check name patterns
        const nameHint = isSecretName(key);
        // If extended schema has explicit hidden value, use it; otherwise fall back to auto-detection
        const isHidden = isExtended
            ? ((schema as EnvVarSchema).hidden ?? nameHint)
            : nameHint;

        // Show description if available
        if (description) {
            p.log.info(`  ${description}`);
        }

        // Show per-variable note
        if (note) {
            p.log.info(`  Note: ${note}`);
        }

        let value: string | symbol;

        if (isHidden) {
            value = await p.password({
                message: `${key}:`,
                validate(v) {
                    if (!v) return `${key} is required`;
                },
            });
        } else {
            value = await p.text({
                message: `${key}:`,
                placeholder: 'Enter value...',
                validate(v) {
                    if (!v) return `${key} is required`;
                },
            });
        }

        if (p.isCancel(value)) {
            p.log.info('Cancelled');
            return null;
        }

        // Check if entered value looks like a secret
        const valueCheck = detectSecretValue(value);

        // If name or value indicates a secret and keychain available
        if ((nameHint || valueCheck.isSecret) && keychainAvailable) {
            const providerHint = valueCheck.provider ? ` (detected: ${valueCheck.provider})` : '';

            const storeInKeychain = await p.confirm({
                message: `Store in keychain?${providerHint}`,
                initialValue: true,
            });

            if (!p.isCancel(storeInKeychain) && storeInKeychain) {
                await storeSecret(serverName, key, value);
                result[key] = `keychain:${serverName}.${key}`;
                p.log.success(`${key} stored in keychain`);
            } else {
                result[key] = value;
            }
        } else {
            result[key] = value;
        }
    }

    return result;
}

/**
 * Prompt for all credentials (env or headers based on transport type)
 * @param preconfiguredKeys - Set of keys that were pre-configured from CLI
 */
export async function showCredentialPrompts(
    config: ParsedMcpConfig,
    preconfiguredKeys?: Set<string>
): Promise<ParsedMcpConfig | null> {
    const result = { ...config, servers: { ...config.servers } };
    const keychainAvailable = await isKeychainAvailable();

    for (const [serverName, serverConfig] of Object.entries(config.servers)) {
        const isHttp = isHttpTransport(serverConfig);

        if (isHttp) {
            // HTTP/SSE transport: prompt for headers
            if (serverConfig.headers && Object.keys(serverConfig.headers).length > 0) {
                const newHeaders = await promptForCredentials(
                    serverName,
                    serverConfig.headers,
                    'headers',
                    keychainAvailable,
                    preconfiguredKeys
                );

                if (newHeaders === null) return null;

                result.servers[serverName] = {
                    ...serverConfig,
                    headers: newHeaders,
                };
            }
        } else {
            // stdio transport: prompt for env
            if (serverConfig.env && Object.keys(serverConfig.env).length > 0) {
                const newEnv = await promptForCredentials(
                    serverName,
                    serverConfig.env,
                    'env',
                    keychainAvailable,
                    preconfiguredKeys
                );

                if (newEnv === null) return null;

                result.servers[serverName] = {
                    ...serverConfig,
                    env: newEnv,
                };
            }
        }
    }

    return result;
}

// Re-export legacy function for backward compatibility
export { showCredentialPrompts as showEnvPrompts };
