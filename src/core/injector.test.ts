import { describe, it, expect } from 'vitest';
import type { McpServerConfig } from '../types.js';

/**
 * Flatten headers from extended schema to plain strings.
 * Extracted from injector.ts for testing.
 */
function flattenHeaders(
    headers: McpServerConfig['headers']
): Record<string, string> | undefined {
    if (!headers) return undefined;

    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
        if (typeof value === 'string') {
            result[key] = value;
        } else if (value && typeof value === 'object' && 'value' in value && value.value !== null) {
            result[key] = String(value.value);
        }
        // Skip null values (not yet configured)
    }
    return Object.keys(result).length > 0 ? result : undefined;
}

describe('flattenHeaders', () => {
    it('returns undefined for undefined input', () => {
        expect(flattenHeaders(undefined)).toBeUndefined();
    });

    it('returns undefined for empty headers', () => {
        expect(flattenHeaders({})).toBeUndefined();
    });

    it('preserves plain string headers', () => {
        const headers = {
            'x-api-key': 'abc123',
            'Authorization': 'Bearer token',
        };
        expect(flattenHeaders(headers)).toEqual({
            'x-api-key': 'abc123',
            'Authorization': 'Bearer token',
        });
    });

    it('flattens extended schema to string', () => {
        const headers = {
            'Authorization': {
                value: 'Bearer my-token',
                description: 'API Token',
                hidden: true,
            },
        };
        expect(flattenHeaders(headers)).toEqual({
            'Authorization': 'Bearer my-token',
        });
    });

    it('handles mixed plain and extended headers', () => {
        const headers = {
            'x-static': 'static-value',
            'Authorization': {
                value: 'Bearer token123',
                description: 'Auth header',
            },
        };
        expect(flattenHeaders(headers)).toEqual({
            'x-static': 'static-value',
            'Authorization': 'Bearer token123',
        });
    });

    it('skips null values (unconfigured)', () => {
        const headers = {
            'configured': 'value',
            'unconfigured': null,
        };
        expect(flattenHeaders(headers)).toEqual({
            'configured': 'value',
        });
    });

    it('skips extended schema with null value', () => {
        const headers = {
            'configured': 'value',
            'unconfigured': {
                value: null,
                description: 'Needs to be set',
            },
        };
        expect(flattenHeaders(headers)).toEqual({
            'configured': 'value',
        });
    });

    it('returns undefined when all headers are unconfigured', () => {
        const headers = {
            'header1': null,
            'header2': { value: null, description: 'Not set' },
        };
        expect(flattenHeaders(headers)).toBeUndefined();
    });
});
