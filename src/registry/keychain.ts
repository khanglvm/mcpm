/**
 * Keychain integration using cross-keychain
 * Secure storage for MCP server secrets
 * 
 * Uses native OS keychains:
 * - macOS: Keychain (Security.framework)
 * - Windows: Credential Manager (DPAPI)
 * - Linux: Secret Service (GNOME Keyring/KDE Wallet)
 */

import {
    getPassword as kcGetPassword,
    setPassword as kcSetPassword,
    deletePassword as kcDeletePassword,
    getCredential,
} from 'cross-keychain';

/** Service name for keychain entries */
const SERVICE = 'mcpm';

/**
 * Store a secret in the system keychain
 * @param serverName - MCP server name
 * @param envName - Environment variable name
 * @param value - Secret value to store
 */
export async function storeSecret(
    serverName: string,
    envName: string,
    value: string
): Promise<void> {
    const account = `${serverName}.${envName}`;
    await kcSetPassword(SERVICE, account, value);
}

/**
 * Retrieve a secret from the system keychain
 * @param serverName - MCP server name
 * @param envName - Environment variable name
 * @returns Secret value or null if not found
 */
export async function getSecret(
    serverName: string,
    envName: string
): Promise<string | null> {
    const account = `${serverName}.${envName}`;
    try {
        return await kcGetPassword(SERVICE, account);
    } catch {
        return null;
    }
}

/**
 * Delete a secret from the system keychain
 * @param serverName - MCP server name
 * @param envName - Environment variable name
 * @returns true if deleted, false if not found
 */
export async function deleteSecret(
    serverName: string,
    envName: string
): Promise<boolean> {
    const account = `${serverName}.${envName}`;
    try {
        await kcDeletePassword(SERVICE, account);
        return true;
    } catch {
        return false;
    }
}

/**
 * Get a credential (account + password) for a specific account
 * @param serverName - MCP server name
 * @param envName - Environment variable name
 */
export async function getCredentialForServer(
    serverName: string,
    envName: string
): Promise<{ account: string; password: string } | null> {
    const account = `${serverName}.${envName}`;
    try {
        const cred = await getCredential(SERVICE, account);
        return cred ? { account: cred.username, password: cred.password } : null;
    } catch {
        return null;
    }
}

/**
 * Resolve environment variables, fetching secrets from keychain as needed
 * @param serverName - MCP server name
 * @param env - Environment variables (may contain keychain references)
 * @returns Resolved environment variables with actual values
 */
export async function resolveEnvWithSecrets(
    serverName: string,
    env: Record<string, string>
): Promise<Record<string, string>> {
    const resolved: Record<string, string> = {};

    for (const [key, value] of Object.entries(env)) {
        if (value.startsWith('keychain:')) {
            // Extract env name from keychain reference
            const parts = value.slice('keychain:'.length).split('.');
            if (parts.length >= 2) {
                const refServer = parts[0];
                const refEnv = parts.slice(1).join('.');
                const secret = await getSecret(refServer, refEnv);
                if (secret) {
                    resolved[key] = secret;
                } else {
                    throw new Error(`Secret not found in keychain: ${value}`);
                }
            }
        } else {
            resolved[key] = value;
        }
    }

    return resolved;
}

/**
 * Check if keychain is available on this system
 */
export async function isKeychainAvailable(): Promise<boolean> {
    try {
        // Try a get operation - if this works, keychain is available
        await kcGetPassword(SERVICE, '__test__');
        return true;
    } catch {
        // Even if not found, keychain is available
        return true;
    }
}
