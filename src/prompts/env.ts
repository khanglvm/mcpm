import * as p from '@clack/prompts';
import pc from 'picocolors';
import type { ParsedMcpConfig, EnvVarSchema } from '../types.js';
import { storeSecret, isKeychainAvailable } from '../registry/keychain.js';

/**
 * Patterns for detecting secrets in env var NAMES
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
    // Generic JWT
    { name: 'JWT', pattern: /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/ },
    // Private Key (PEM format)
    { name: 'Private Key', pattern: /^-+BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-+/ },
    // Generic long hex strings (likely secrets)
    { name: 'Hex Secret', pattern: /^[a-f0-9]{32,}$/i },
    // Generic base64 (40+ chars, likely a key)
    { name: 'Base64 Secret', pattern: /^[A-Za-z0-9+/=]{40,}$/ },
];

/**
 * Check if env var name looks like a secret
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
 * Prompt for all env variables, pre-filling existing values for editing
 * @param preconfiguredKeys - Set of keys that were pre-configured from CLI
 */
export async function showEnvPrompts(
    config: ParsedMcpConfig,
    preconfiguredKeys?: Set<string>
): Promise<ParsedMcpConfig | null> {
    const result = { ...config, servers: { ...config.servers } };
    const keychainAvailable = await isKeychainAvailable();

    for (const [serverName, serverConfig] of Object.entries(config.servers)) {
        if (!serverConfig.env) continue;

        const envEntries = Object.entries(serverConfig.env);
        if (envEntries.length === 0) continue;

        const newEnv: Record<string, string> = {};

        // Separate entries into pre-filled and missing
        const missingEntries: [string, unknown][] = [];

        for (const [key, schema] of envEntries) {
            const isExtended = typeof schema === 'object' && schema !== null && 'value' in schema;

            // Get existing value
            let existingValue: string | null = null;
            if (typeof schema === 'string') {
                existingValue = schema;
            } else if (isExtended && (schema as EnvVarSchema).value !== null) {
                existingValue = String((schema as EnvVarSchema).value);
            }

            if (existingValue) {
                // Pre-filled: keep as-is
                newEnv[key] = existingValue;
            } else {
                // Missing: need to prompt
                missingEntries.push([key, schema]);
            }
        }

        // Only show prompt header if there are missing values
        if (missingEntries.length > 0) {
            p.log.info(`Configure ${serverName} environment (${missingEntries.length} missing value${missingEntries.length > 1 ? 's' : ''}):`);
        }

        for (const [key, schema] of missingEntries) {
            const isExtended = typeof schema === 'object' && schema !== null && 'value' in schema;
            const description = isExtended ? (schema as EnvVarSchema).description : undefined;
            const note = isExtended ? (schema as EnvVarSchema).note : undefined;

            // Smart detection: check name patterns
            const nameHint = isSecretName(key);
            const isHidden = isExtended
                ? (schema as EnvVarSchema).hidden
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
                    newEnv[key] = `keychain:${serverName}.${key}`;
                    p.log.success(`${key} stored in keychain`);
                } else {
                    newEnv[key] = value;
                }
            } else {
                newEnv[key] = value;
            }
        }

        result.servers[serverName] = {
            ...serverConfig,
            env: newEnv,
        };
    }

    return result;
}
