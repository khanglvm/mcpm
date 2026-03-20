/**
 * Schema extraction and blank config utilities
 * For reconfiguring MCP servers with full credential options
 */

import type { EnvVarSchema } from '../types.js';
import type { CredentialSchema, RegistryServer } from './types.js';

/**
 * Value type for headers in McpServerConfig
 */
type HeaderValue = string | null | { value: string | null; description?: string; note?: string; required?: boolean; hidden?: boolean };

/**
 * Extract schema from env variables (strip values, keep metadata)
 */
export function extractEnvSchema(
    env?: Record<string, string | null | EnvVarSchema>
): Record<string, CredentialSchema> | undefined {
    if (!env || Object.keys(env).length === 0) return undefined;

    const schema: Record<string, CredentialSchema> = {};

    for (const [key, value] of Object.entries(env)) {
        if (typeof value === 'string' || value === null) {
            // Plain string or null - no metadata
            schema[key] = {};
        } else {
            // EnvVarSchema object - extract metadata
            schema[key] = {
                description: value.description,
                note: value.note,
                required: value.required,
                hidden: value.hidden,
            };
        }
    }

    return schema;
}

/**
 * Extract schema from headers (strip values, keep metadata)
 */
export function extractHeaderSchema(
    headers?: Record<string, HeaderValue>
): Record<string, CredentialSchema> | undefined {
    if (!headers || Object.keys(headers).length === 0) return undefined;

    const schema: Record<string, CredentialSchema> = {};

    for (const [key, value] of Object.entries(headers)) {
        if (typeof value === 'string' || value === null) {
            // Plain string or null - no metadata
            schema[key] = {};
        } else {
            // Extended header object - extract metadata
            schema[key] = {
                description: value.description,
                note: value.note,
                required: value.required,
                hidden: value.hidden,
            };
        }
    }

    return schema;
}

/**
 * Create blank env/header config from schema
 * All values set to null, sorted with required fields first
 */
export function createBlankConfigFromSchema(
    schema: RegistryServer['schema']
): {
    env?: Record<string, EnvVarSchema>;
    headers?: Record<string, EnvVarSchema>;
} {
    const result: {
        env?: Record<string, EnvVarSchema>;
        headers?: Record<string, EnvVarSchema>;
    } = {};

    if (schema?.env) {
        result.env = createBlankCredentials(schema.env);
    }

    if (schema?.headers) {
        result.headers = createBlankCredentials(schema.headers);
    }

    return result;
}

/**
 * Create blank credentials from schema, sorted with required first
 */
function createBlankCredentials(
    schema: Record<string, CredentialSchema>
): Record<string, EnvVarSchema> {
    const entries = Object.entries(schema);

    // Sort: required first, then alphabetically
    entries.sort(([aKey, a], [bKey, b]) => {
        const aRequired = a.required !== false; // Default true
        const bRequired = b.required !== false;
        if (aRequired !== bRequired) return aRequired ? -1 : 1;
        return aKey.localeCompare(bKey);
    });

    const result: Record<string, EnvVarSchema> = {};

    for (const [key, meta] of entries) {
        result[key] = {
            value: null,
            description: meta.description,
            note: meta.note,
            required: meta.required,
            hidden: meta.hidden,
        };
    }

    return result;
}

/**
 * Check if a server has schema stored for reconfiguration
 */
export function hasSchema(server: RegistryServer): boolean {
    return !!(server.schema?.env || server.schema?.headers);
}
