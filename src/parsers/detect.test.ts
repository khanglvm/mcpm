import { describe, it, expect } from 'vitest';
import { parseConfig } from './detect.js';

describe('parseConfig', () => {
    describe('JSON with mcpServers wrapper', () => {
        it('parses object with mcpServers key', () => {
            const input = JSON.stringify({
                mcpServers: {
                    github: {
                        command: 'npx',
                        args: ['-y', '@modelcontextprotocol/server-github'],
                    },
                },
            });

            const result = parseConfig(input);

            expect(result.sourceFormat).toBe('json');
            expect(result.sourceWrapperKey).toBe('mcpServers');
            expect(result.servers).toHaveProperty('github');
            expect(result.servers.github.command).toBe('npx');
            expect(result.servers.github.args).toEqual(['-y', '@modelcontextprotocol/server-github']);
        });

        it('parses mcpServers with type: STDIO (uppercase)', () => {
            const input = JSON.stringify({
                mcpServers: {
                    'mcp-outline': {
                        type: 'STDIO',
                        command: 'uvx',
                        args: ['mcp-outline'],
                        env: {
                            MCP_PORT: '6061',
                            OUTLINE_API_KEY: 'test-key',
                        },
                    },
                },
            });

            const result = parseConfig(input);

            expect(result.servers['mcp-outline'].type).toBe('stdio');
            expect(result.servers['mcp-outline'].command).toBe('uvx');
            expect(result.servers['mcp-outline'].args).toEqual(['mcp-outline']);
            expect(result.servers['mcp-outline'].env).toEqual({
                MCP_PORT: '6061',
                OUTLINE_API_KEY: 'test-key',
            });
        });

        it('parses multiple servers', () => {
            const input = JSON.stringify({
                mcpServers: {
                    github: { command: 'npx', args: ['-y', '@mcp/github'] },
                    filesystem: { command: 'npx', args: ['-y', '@mcp/filesystem'] },
                },
            });

            const result = parseConfig(input);

            expect(Object.keys(result.servers)).toEqual(['github', 'filesystem']);
        });
    });

    describe('JSON with other wrapper keys', () => {
        it('parses servers wrapper', () => {
            const input = JSON.stringify({
                servers: {
                    test: { command: 'npx', args: ['test'] },
                },
            });

            const result = parseConfig(input);
            expect(result.sourceWrapperKey).toBe('servers');
            expect(result.servers).toHaveProperty('test');
        });

        it('parses context_servers wrapper (Continue.dev)', () => {
            const input = JSON.stringify({
                context_servers: {
                    test: { command: 'npx', args: ['test'] },
                },
            });

            const result = parseConfig(input);
            expect(result.sourceWrapperKey).toBe('context_servers');
        });
    });

    describe('JSON direct server config', () => {
        it('parses direct server config without wrapper', () => {
            const input = JSON.stringify({
                github: { command: 'npx', args: ['-y', '@mcp/github'] },
            });

            const result = parseConfig(input);
            expect(result.sourceWrapperKey).toBe('direct');
            expect(result.servers).toHaveProperty('github');
        });
    });

    describe('Transport type normalization', () => {
        it('normalizes STDIO to stdio', () => {
            const input = JSON.stringify({
                mcpServers: { test: { type: 'STDIO', command: 'test' } },
            });
            expect(parseConfig(input).servers.test.type).toBe('stdio');
        });

        it('normalizes HTTP to http', () => {
            const input = JSON.stringify({
                mcpServers: { test: { type: 'HTTP', url: 'http://test.com' } },
            });
            expect(parseConfig(input).servers.test.type).toBe('http');
        });

        it('normalizes SSE to sse', () => {
            const input = JSON.stringify({
                mcpServers: { test: { type: 'SSE', url: 'http://test.com' } },
            });
            expect(parseConfig(input).servers.test.type).toBe('sse');
        });

        it('handles lowercase types', () => {
            const input = JSON.stringify({
                mcpServers: { test: { type: 'stdio', command: 'test' } },
            });
            expect(parseConfig(input).servers.test.type).toBe('stdio');
        });

        it('returns undefined for invalid type', () => {
            const input = JSON.stringify({
                mcpServers: { test: { type: 'invalid', command: 'test' } },
            });
            expect(parseConfig(input).servers.test.type).toBeUndefined();
        });
    });

    describe('OpenCode format (command as array)', () => {
        it('parses command array format', () => {
            const input = JSON.stringify({
                mcpServers: {
                    test: {
                        command: ['npx', '-y', '@mcp/test'],
                        environment: { TOKEN: 'abc' },
                    },
                },
            });

            const result = parseConfig(input);
            expect(result.servers.test.command).toBe('npx');
            expect(result.servers.test.args).toEqual(['-y', '@mcp/test']);
            expect(result.servers.test.env).toEqual({ TOKEN: 'abc' });
        });
    });

    describe('YAML parsing', () => {
        it('parses YAML with mcpServers', () => {
            const input = `
mcpServers:
  github:
    command: npx
    args:
      - -y
      - "@mcp/github"
`;
            const result = parseConfig(input);
            expect(result.sourceFormat).toBe('yaml');
            expect(result.servers.github.command).toBe('npx');
        });
    });

    describe('Error handling', () => {
        it('throws on invalid JSON', () => {
            expect(() => parseConfig('{ invalid }')).toThrow('Invalid JSON');
        });

        it('throws on unknown wrapper key', () => {
            const input = JSON.stringify({ unknownKey: { test: 123 } });
            expect(() => parseConfig(input)).toThrow('Could not detect MCP configuration format');
        });

        it('throws on invalid server config', () => {
            const input = JSON.stringify({ mcpServers: { test: 'not an object' } });
            expect(() => parseConfig(input)).toThrow('Invalid server config');
        });
    });

    describe('HTTP/SSE transport', () => {
        it('parses HTTP transport with url', () => {
            const input = JSON.stringify({
                mcpServers: {
                    api: {
                        type: 'http',
                        url: 'https://api.example.com/mcp',
                        headers: { Authorization: 'Bearer token' },
                    },
                },
            });

            const result = parseConfig(input);
            expect(result.servers.api.url).toBe('https://api.example.com/mcp');
            expect(result.servers.api.headers).toEqual({ Authorization: 'Bearer token' });
        });

        it('parses headers with extended schema', () => {
            const input = JSON.stringify({
                mcpServers: {
                    api: {
                        url: 'https://api.example.com/mcp',
                        headers: {
                            Authorization: {
                                value: null,
                                description: 'Bearer token',
                                hidden: true
                            }
                        }
                    }
                }
            });

            const result = parseConfig(input);
            expect(result.servers.api.headers?.Authorization).toEqual({
                value: null,
                description: 'Bearer token',
                hidden: true
            });
        });

        it('preserves plain string headers', () => {
            const input = JSON.stringify({
                mcpServers: {
                    api: {
                        url: 'https://api.example.com/mcp',
                        headers: { 'x-static': 'value' }
                    }
                }
            });

            const result = parseConfig(input);
            expect(result.servers.api.headers?.['x-static']).toBe('value');
        });

        it('supports mixed header formats', () => {
            const input = JSON.stringify({
                mcpServers: {
                    api: {
                        url: 'https://api.example.com/mcp',
                        headers: {
                            'x-static': 'plain-value',
                            Authorization: {
                                value: null,
                                description: 'API Key',
                                note: 'Get your API key from dashboard'
                            }
                        }
                    }
                }
            });

            const result = parseConfig(input);
            expect(result.servers.api.headers?.['x-static']).toBe('plain-value');
            expect(result.servers.api.headers?.Authorization).toEqual({
                value: null,
                description: 'API Key',
                note: 'Get your API key from dashboard'
            });
        });
    });

    describe('TOML parsing', () => {
        it('parses TOML with mcpServers section', () => {
            const input = `
[mcpServers.github]
command = "npx"
args = ["-y", "@mcp/github"]
`;
            const result = parseConfig(input);
            expect(result.sourceFormat).toBe('toml');
            expect(result.servers.github.command).toBe('npx');
            expect(result.servers.github.args).toEqual(['-y', '@mcp/github']);
        });

        it('parses TOML with mcp_servers section (Codex format)', () => {
            const input = `
[mcp_servers.test]
command = "echo"
args = ["hello"]
`;
            const result = parseConfig(input);
            expect(result.sourceFormat).toBe('toml');
            expect(result.sourceWrapperKey).toBe('mcp_servers');
            expect(result.servers.test.command).toBe('echo');
        });

        it('parses TOML with environment variables', () => {
            const input = `
[mcpServers.api]
command = "npx"
args = ["-y", "@mcp/api"]

[mcpServers.api.env]
API_KEY = "secret-key"
DEBUG = "true"
`;
            const result = parseConfig(input);
            expect(result.servers.api.env).toEqual({
                API_KEY: 'secret-key',
                DEBUG: 'true',
            });
        });

        it('parses TOML with HTTP transport', () => {
            const input = `
[mcpServers.remote]
url = "https://api.example.com/mcp"
type = "http"
`;
            const result = parseConfig(input);
            expect(result.servers.remote.url).toBe('https://api.example.com/mcp');
            expect(result.servers.remote.type).toBe('http');
        });

        it('throws on invalid TOML', () => {
            expect(() => parseConfig('[invalid')).toThrow('Invalid TOML');
        });
    });
});

