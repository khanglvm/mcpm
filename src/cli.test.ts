import { describe, it, expect } from 'vitest';

/**
 * Helper function extracted from cli.ts for testing
 * Parses credential arguments like --env:KEY=VALUE::modifiers or --header:KEY=VALUE::modifiers
 */
interface CliEnvConfig {
    value: string | null;
    description?: string;
    note?: string;
    required?: boolean;
    hidden?: boolean;
}

function parseCredentialArg(
    arg: string,
    prefix: string
): { key: string; config: string | CliEnvConfig } | null {
    if (!arg.startsWith(prefix)) return null;

    const part = arg.slice(prefix.length);
    const segments = part.split('::');
    const keyValuePart = segments[0];
    const modifiers = segments.slice(1);

    const eqIndex = keyValuePart.indexOf('=');
    if (eqIndex <= 0) return null;

    const key = keyValuePart.slice(0, eqIndex);
    const value = keyValuePart.slice(eqIndex + 1) || null;

    // If no modifiers, use simple string value
    if (modifiers.length === 0) {
        return { key, config: value ?? '' };
    }

    // Parse modifiers into CliEnvConfig
    const config: CliEnvConfig = { value };

    for (const mod of modifiers) {
        if (mod === 'hidden') {
            config.hidden = true;
        } else if (mod === 'optional') {
            config.required = false;
        } else if (mod.startsWith('description=')) {
            config.description = mod.slice(12).replace(/^["']|["']$/g, '');
        } else if (mod.startsWith('note=')) {
            config.note = mod.slice(5).replace(/^["']|["']$/g, '');
        }
    }

    return { key, config };
}

describe('CLI Credential Argument Parsing', () => {
    describe('--env:KEY=VALUE parsing', () => {
        it('parses simple key=value', () => {
            const result = parseCredentialArg('--env:API_KEY=sk-test123', '--env:');
            expect(result).toEqual({ key: 'API_KEY', config: 'sk-test123' });
        });

        it('parses value with equals sign', () => {
            const result = parseCredentialArg('--env:TOKEN=abc=def', '--env:');
            expect(result).toEqual({ key: 'TOKEN', config: 'abc=def' });
        });

        it('parses empty value as prompt trigger', () => {
            const result = parseCredentialArg('--env:SECRET=', '--env:');
            expect(result).toEqual({ key: 'SECRET', config: '' });
        });

        it('returns null for missing equals sign', () => {
            const result = parseCredentialArg('--env:KEY', '--env:');
            expect(result).toBeNull();
        });

        it('returns null for wrong prefix', () => {
            const result = parseCredentialArg('--wrong:KEY=VALUE', '--env:');
            expect(result).toBeNull();
        });
    });

    describe('--header:KEY=VALUE parsing', () => {
        it('parses Authorization header', () => {
            const result = parseCredentialArg('--header:Authorization=Bearer token123', '--header:');
            expect(result).toEqual({ key: 'Authorization', config: 'Bearer token123' });
        });

        it('parses x-api-key header', () => {
            const result = parseCredentialArg('--header:x-api-key=abc123', '--header:');
            expect(result).toEqual({ key: 'x-api-key', config: 'abc123' });
        });

        it('parses empty header for prompting', () => {
            const result = parseCredentialArg('--header:Authorization=', '--header:');
            expect(result).toEqual({ key: 'Authorization', config: '' });
        });
    });

    describe('::modifiers parsing', () => {
        it('parses ::hidden modifier', () => {
            const result = parseCredentialArg('--env:API_KEY=::hidden', '--env:');
            expect(result).toEqual({
                key: 'API_KEY',
                config: { value: null, hidden: true },
            });
        });

        it('parses ::optional modifier', () => {
            const result = parseCredentialArg('--env:OPTIONAL_KEY=default::optional', '--env:');
            expect(result).toEqual({
                key: 'OPTIONAL_KEY',
                config: { value: 'default', required: false },
            });
        });

        it('parses ::description= modifier', () => {
            const result = parseCredentialArg('--env:KEY=::description="Your API key"', '--env:');
            expect(result).toEqual({
                key: 'KEY',
                config: { value: null, description: 'Your API key' },
            });
        });

        it('parses ::note= modifier', () => {
            const result = parseCredentialArg('--env:KEY=::note="Get your API key from dashboard"', '--env:');
            expect(result).toEqual({
                key: 'KEY',
                config: { value: null, note: 'Get your API key from dashboard' },
            });
        });

        it('parses multiple modifiers combined', () => {
            const result = parseCredentialArg(
                '--header:Authorization=::hidden::description="Bearer token"::note="Get token from developer portal"',
                '--header:'
            );
            expect(result).toEqual({
                key: 'Authorization',
                config: {
                    value: null,
                    hidden: true,
                    description: 'Bearer token',
                    note: 'Get token from developer portal',
                },
            });
        });

        it('parses modifiers with value present', () => {
            const result = parseCredentialArg('--env:KEY=preset-value::hidden::optional', '--env:');
            expect(result).toEqual({
                key: 'KEY',
                config: { value: 'preset-value', hidden: true, required: false },
            });
        });
    });
});

import { getAllAgentTypes, isValidAgentType } from './agents.js';

describe('CLI --agent: Argument Parsing', () => {
    /**
     * Helper to parse --agent:<name> args from a list of CLI arguments
     */
    function parseAgentArgs(args: string[]): string[] {
        const preAgents: string[] = [];
        for (const arg of args) {
            if (arg.startsWith('--agent:')) {
                const agentName = arg.slice('--agent:'.length);
                if (isValidAgentType(agentName)) {
                    if (!preAgents.includes(agentName)) {
                        preAgents.push(agentName);
                    }
                }
            }
        }
        return preAgents;
    }

    it('parses single --agent:cursor', () => {
        const result = parseAgentArgs(['--agent:cursor']);
        expect(result).toEqual(['cursor']);
    });

    it('parses multiple agents', () => {
        const result = parseAgentArgs(['--agent:cursor', '--agent:claude-code', '--agent:windsurf']);
        expect(result).toEqual(['cursor', 'claude-code', 'windsurf']);
    });

    it('deduplicates repeated agents', () => {
        const result = parseAgentArgs(['--agent:cursor', '--agent:cursor']);
        expect(result).toEqual(['cursor']);
    });

    it('ignores invalid agent names', () => {
        const result = parseAgentArgs(['--agent:cursor', '--agent:invalid-agent', '--agent:claude-code']);
        expect(result).toEqual(['cursor', 'claude-code']);
    });

    it('returns empty array when no --agent: args', () => {
        const result = parseAgentArgs(['--env:KEY=value', '--note:test']);
        expect(result).toEqual([]);
    });

    it('handles mixed args correctly', () => {
        const result = parseAgentArgs([
            '--env:API_KEY=test',
            '--agent:cursor',
            '--header:Auth=token',
            '--agent:antigravity',
            '--note:install note',
        ]);
        expect(result).toEqual(['cursor', 'antigravity']);
    });

    it('validates all known agent types', () => {
        expect(isValidAgentType('cursor')).toBe(true);
        expect(isValidAgentType('claude-code')).toBe(true);
        expect(isValidAgentType('windsurf')).toBe(true);
        expect(isValidAgentType('antigravity')).toBe(true);
        expect(isValidAgentType('jetbrains-ai')).toBe(true);
        expect(isValidAgentType('unknown-agent')).toBe(false);
        expect(isValidAgentType('')).toBe(false);
    });
});

describe('CLI -y and --scope: Argument Parsing', () => {
    /**
     * Helper to parse auto mode and scope args from a list of CLI arguments
     */
    function parseAutoAndScope(args: string[]): { auto: boolean; scope: 'global' | 'project' } {
        let auto = false;
        let scope: 'global' | 'project' = 'global';

        for (const arg of args) {
            if (arg === '-y' || arg === '--yes') {
                auto = true;
            } else if (arg.startsWith('--scope:')) {
                const scopeValue = arg.slice('--scope:'.length);
                if (scopeValue === 'global' || scopeValue === 'project') {
                    scope = scopeValue;
                }
            }
        }

        return { auto, scope };
    }

    it('parses -y flag', () => {
        const result = parseAutoAndScope(['-y']);
        expect(result).toEqual({ auto: true, scope: 'global' });
    });

    it('parses --yes flag', () => {
        const result = parseAutoAndScope(['--yes']);
        expect(result).toEqual({ auto: true, scope: 'global' });
    });

    it('parses --scope:global', () => {
        const result = parseAutoAndScope(['--scope:global']);
        expect(result).toEqual({ auto: false, scope: 'global' });
    });

    it('parses --scope:project', () => {
        const result = parseAutoAndScope(['--scope:project']);
        expect(result).toEqual({ auto: false, scope: 'project' });
    });

    it('ignores invalid scope values (defaults to global)', () => {
        const result = parseAutoAndScope(['--scope:invalid']);
        expect(result).toEqual({ auto: false, scope: 'global' });
    });

    it('parses combined -y and --scope:project', () => {
        const result = parseAutoAndScope(['-y', '--scope:project']);
        expect(result).toEqual({ auto: true, scope: 'project' });
    });

    it('parses -y with other args', () => {
        const result = parseAutoAndScope([
            '--env:API_KEY=test',
            '-y',
            '--scope:global',
            '--agent:cursor',
            '--note:test',
        ]);
        expect(result).toEqual({ auto: true, scope: 'global' });
    });

    it('returns defaults when no -y or scope args', () => {
        const result = parseAutoAndScope(['--env:KEY=value', '--agent:cursor']);
        expect(result).toEqual({ auto: false, scope: 'global' });
    });
});

describe('CLI --agent:all and -a Argument Parsing', () => {
    /**
     * Helper to parse --agent:all and -a flags from CLI arguments
     */
    function parseAgentAllFlags(args: string[]): { autoSelectAll: boolean; specificAgents: string[] } {
        let autoSelectAll = false;
        const specificAgents: string[] = [];

        for (const arg of args) {
            if (arg === '-a') {
                autoSelectAll = true;
            } else if (arg.startsWith('--agent:')) {
                const agentName = arg.slice('--agent:'.length);
                if (agentName === 'all') {
                    autoSelectAll = true;
                } else if (isValidAgentType(agentName) && !specificAgents.includes(agentName)) {
                    specificAgents.push(agentName);
                }
            }
        }

        return { autoSelectAll, specificAgents };
    }

    it('parses --agent:all flag', () => {
        const result = parseAgentAllFlags(['--agent:all']);
        expect(result).toEqual({ autoSelectAll: true, specificAgents: [] });
    });

    it('parses -a short flag', () => {
        const result = parseAgentAllFlags(['-a']);
        expect(result).toEqual({ autoSelectAll: true, specificAgents: [] });
    });

    it('combines -a with specific agents', () => {
        const result = parseAgentAllFlags(['-a', '--agent:cursor', '--agent:claude-code']);
        // When -a is used, specificAgents are still collected but autoSelectAll takes precedence
        expect(result).toEqual({ autoSelectAll: true, specificAgents: ['cursor', 'claude-code'] });
    });

    it('combines --agent:all with -y flag', () => {
        // Note: This test focuses on the agent:all parsing, -y is handled separately
        const result = parseAgentAllFlags(['--agent:all', '-y']);
        expect(result).toEqual({ autoSelectAll: true, specificAgents: [] });
    });

    it('handles mixed args correctly', () => {
        const result = parseAgentAllFlags([
            '--env:API_KEY=test',
            '-a',
            '--header:Auth=token',
            '--scope:project',
        ]);
        expect(result).toEqual({ autoSelectAll: true, specificAgents: [] });
    });

    it('returns false when no -a or --agent:all', () => {
        const result = parseAgentAllFlags(['--agent:cursor', '--agent:windsurf']);
        expect(result).toEqual({ autoSelectAll: false, specificAgents: ['cursor', 'windsurf'] });
    });
});

