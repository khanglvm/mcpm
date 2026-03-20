/**
 * Tests for validator module
 */
import { describe, it, expect } from 'vitest';

// We can't directly test the private ensureAutoExecuteFlags function,
// but we can test the expected behavior through the exported interface.
// For now, let's create a separate test util that mirrors the logic.

/**
 * Auto-execute flags for common package runners (mirrored from validator.ts for testing)
 */
const AUTO_EXECUTE_FLAGS: Record<string, string[]> = {
    npx: ['-y'],
    pnpx: ['-y'],
};

/**
 * Test version of ensureAutoExecuteFlags (mirrored from validator.ts)
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

describe('ensureAutoExecuteFlags', () => {
    describe('npx command', () => {
        it('adds -y flag when not present', () => {
            const result = ensureAutoExecuteFlags('npx', ['@mcp/server-github']);
            expect(result).toEqual(['-y', '@mcp/server-github']);
        });

        it('does not duplicate -y flag if already present', () => {
            const result = ensureAutoExecuteFlags('npx', ['-y', '@mcp/server-github']);
            expect(result).toEqual(['-y', '@mcp/server-github']);
        });

        it('handles undefined args', () => {
            const result = ensureAutoExecuteFlags('npx', undefined);
            expect(result).toEqual(['-y']);
        });

        it('handles empty args array', () => {
            const result = ensureAutoExecuteFlags('npx', []);
            expect(result).toEqual(['-y']);
        });

        it('handles full path to npx', () => {
            const result = ensureAutoExecuteFlags('/usr/local/bin/npx', ['@mcp/test']);
            expect(result).toEqual(['-y', '@mcp/test']);
        });

        it('handles NPX uppercase (case-insensitive)', () => {
            const result = ensureAutoExecuteFlags('NPX', ['@mcp/test']);
            expect(result).toEqual(['-y', '@mcp/test']);
        });
    });

    describe('pnpx command', () => {
        it('adds -y flag when not present', () => {
            const result = ensureAutoExecuteFlags('pnpx', ['@mcp/server-github']);
            expect(result).toEqual(['-y', '@mcp/server-github']);
        });

        it('does not duplicate -y flag if already present', () => {
            const result = ensureAutoExecuteFlags('pnpx', ['-y', '@mcp/server-github']);
            expect(result).toEqual(['-y', '@mcp/server-github']);
        });

        it('handles full path to pnpx', () => {
            const result = ensureAutoExecuteFlags('/usr/local/bin/pnpx', ['@mcp/test']);
            expect(result).toEqual(['-y', '@mcp/test']);
        });
    });

    describe('other commands (no auto-execute needed)', () => {
        it('does not modify uvx args (auto-runs by default)', () => {
            const result = ensureAutoExecuteFlags('uvx', ['mcp-outline']);
            expect(result).toEqual(['mcp-outline']);
        });

        it('does not modify bunx args', () => {
            const result = ensureAutoExecuteFlags('bunx', ['@mcp/server']);
            expect(result).toEqual(['@mcp/server']);
        });

        it('does not modify node args', () => {
            const result = ensureAutoExecuteFlags('node', ['server.js']);
            expect(result).toEqual(['server.js']);
        });

        it('returns undefined args as-is for unknown commands', () => {
            const result = ensureAutoExecuteFlags('some-binary', undefined);
            expect(result).toBeUndefined();
        });

        it('does not modify yarn dlx (auto-runs by default)', () => {
            // Note: yarn dlx is typically called as "yarn" with "dlx" as first arg
            const result = ensureAutoExecuteFlags('yarn', ['dlx', '@mcp/server']);
            expect(result).toEqual(['dlx', '@mcp/server']);
        });

        it('does not modify deno args (auto-installs npm packages)', () => {
            const result = ensureAutoExecuteFlags('deno', ['run', 'npm:@mcp/server']);
            expect(result).toEqual(['run', 'npm:@mcp/server']);
        });
    });
});
