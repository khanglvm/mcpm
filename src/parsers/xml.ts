/**
 * XML Parser for JetBrains AI Assistant
 * Handles: llm.mcpServers.xml format
 *
 * XML Structure:
 * <application>
 *   <component name="McpApplicationServerCommands">
 *     <McpServerCommand>
 *       <option name="enabled" value="true" />
 *       <option name="name" value="ServerName" />
 *       <option name="programPath" value="npx" />
 *       <option name="arguments" value="-y @pkg/server" />
 *       <option name="workingDirectory" value="" />
 *       <envs>
 *         <env name="VAR" value="value" />
 *       </envs>
 *     </McpServerCommand>
 *   </component>
 * </application>
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync, readdirSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { homedir, platform } from 'node:os';
import type { AgentType, McpServerConfig } from '../types.js';
import type { AgentParser, AgentMcpConfig, WriteOptions } from './types.js';

// JetBrains IDE name patterns to detect
const JETBRAINS_IDE_PATTERNS = [
    'IntelliJIdea',
    'PyCharm',
    'WebStorm',
    'Rider',
    'GoLand',
    'CLion',
    'PhpStorm',
    'RubyMine',
    'DataGrip',
    'AppCode',
    'RustRover',
    'Aqua',
    'DataSpell',
    'Fleet',
];

/**
 * Get JetBrains config base directory by OS
 */
export function getJetBrainsConfigDir(): string {
    const home = homedir();
    const os = platform();

    switch (os) {
        case 'darwin':
            return join(home, 'Library/Application Support/JetBrains');
        case 'win32':
            return join(process.env.APPDATA || join(home, 'AppData/Roaming'), 'JetBrains');
        default: // linux
            return join(process.env.XDG_CONFIG_HOME || join(home, '.config'), 'JetBrains');
    }
}

/**
 * Detect installed JetBrains IDEs
 * Returns array of { name, version, configPath }
 */
export interface JetBrainsIDE {
    name: string;      // e.g., "WebStorm"
    version: string;   // e.g., "2025.1"
    dirName: string;   // e.g., "WebStorm2025.1"
    configPath: string; // Full path to llm.mcpServers.xml
}

export function detectJetBrainsIDEs(): JetBrainsIDE[] {
    const baseDir = getJetBrainsConfigDir();
    const ides: JetBrainsIDE[] = [];

    if (!existsSync(baseDir)) {
        return ides;
    }

    try {
        const entries = readdirSync(baseDir, { withFileTypes: true });

        for (const entry of entries) {
            if (!entry.isDirectory()) continue;

            // Check if this matches a JetBrains IDE pattern
            for (const pattern of JETBRAINS_IDE_PATTERNS) {
                if (entry.name.startsWith(pattern)) {
                    // Extract version (e.g., "2025.1" from "WebStorm2025.1")
                    const version = entry.name.slice(pattern.length);
                    if (version && /^\d+\.\d+/.test(version)) {
                        const configPath = join(baseDir, entry.name, 'options', 'llm.mcpServers.xml');
                        ides.push({
                            name: pattern,
                            version,
                            dirName: entry.name,
                            configPath,
                        });
                    }
                }
            }
        }
    } catch {
        // Ignore read errors
    }

    // Sort by version descending (newest first)
    return ides.sort((a, b) => b.version.localeCompare(a.version));
}

/**
 * Parse option value from XML string
 */
function parseOptionValue(line: string, optionName: string): string | null {
    const regex = new RegExp(`<option\\s+name="${optionName}"\\s+value="([^"]*)"`, 'i');
    const match = line.match(regex);
    return match ? match[1] : null;
}

/**
 * Parse environment variables from <envs> block
 */
function parseEnvs(envsBlock: string): Record<string, string> {
    const envs: Record<string, string> = {};
    const envRegex = /<env\s+name="([^"]+)"\s+value="([^"]*)"\s*\/>/gi;
    let match;

    while ((match = envRegex.exec(envsBlock)) !== null) {
        envs[match[1]] = match[2];
    }

    return envs;
}

/**
 * Parse a single McpServerCommand block
 */
function parseMcpServerCommand(block: string): { name: string; server: McpServerConfig } | null {
    const name = parseOptionValue(block, 'name');
    const programPath = parseOptionValue(block, 'programPath');
    const arguments_ = parseOptionValue(block, 'arguments');

    if (!name || !programPath) return null;

    // Parse arguments string into array
    const args = arguments_ ? arguments_.split(/\s+/).filter(Boolean) : [];

    // Parse environment variables
    const envsMatch = block.match(/<envs>([\s\S]*?)<\/envs>/);
    const env = envsMatch ? parseEnvs(envsMatch[1]) : {};

    return {
        name,
        server: {
            command: programPath,
            args,
            env: Object.keys(env).length > 0 ? env : undefined,
        },
    };
}

/**
 * Create an XML parser for JetBrains AI Assistant
 */
export function createXmlParser(agentType: AgentType, configPath?: string): AgentParser {
    // Resolve path: use provided path, or detect from installed IDEs
    const getResolvedPath = (): string => {
        if (configPath) return configPath;
        const ides = detectJetBrainsIDEs();
        if (ides.length === 0) return '';
        // Return path to first IDE (even if file doesn't exist yet)
        return ides[0].configPath;
    };

    // Cache resolved path at creation time
    const resolvedPath = getResolvedPath();

    return {
        agent: agentType,
        format: 'xml',

        exists(): boolean {
            return resolvedPath !== '' && existsSync(resolvedPath);
        },

        async read(): Promise<AgentMcpConfig> {
            if (!existsSync(resolvedPath)) {
                return {
                    agent: agentType,
                    configPath: resolvedPath,
                    servers: {},
                };
            }

            try {
                const content = readFileSync(resolvedPath, 'utf-8');
                const servers: Record<string, McpServerConfig> = {};

                // Find all McpServerCommand blocks
                const serverBlocks = content.match(/<McpServerCommand>[\s\S]*?<\/McpServerCommand>/gi) || [];

                for (const block of serverBlocks) {
                    const parsed = parseMcpServerCommand(block);
                    if (parsed) {
                        servers[parsed.name] = parsed.server;
                    }
                }

                return {
                    agent: agentType,
                    configPath: resolvedPath,
                    servers,
                    rawConfig: content,
                };
            } catch {
                return {
                    agent: agentType,
                    configPath: resolvedPath,
                    servers: {},
                };
            }
        },

        async write(
            servers: Record<string, McpServerConfig>,
            options: WriteOptions = {}
        ): Promise<void> {
            const { createIfMissing = true, backup = true, merge = true } = options;

            // Check if we have a valid path
            if (!resolvedPath) {
                throw new Error('No JetBrains IDE found. Please install a JetBrains IDE (IntelliJ, PyCharm, WebStorm, etc.) first.');
            }

            // Ensure directory exists
            const dir = dirname(resolvedPath);
            if (!existsSync(dir)) {
                if (!createIfMissing) {
                    throw new Error(`Config directory does not exist: ${dir}`);
                }
                mkdirSync(dir, { recursive: true });
            }

            // Backup if needed
            if (backup && existsSync(resolvedPath)) {
                const backupDir = join(homedir(), '.mcpm', 'backups');
                if (!existsSync(backupDir)) {
                    mkdirSync(backupDir, { recursive: true });
                }
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                const backupPath = join(backupDir, `${agentType}-${timestamp}.xml`);
                copyFileSync(resolvedPath, backupPath);
            }

            // Read existing servers if merging
            let existingServers: Record<string, McpServerConfig> = {};
            if (merge && existsSync(resolvedPath)) {
                const existing = await this.read();
                existingServers = existing.servers;
            }

            // Merge servers
            const allServers = merge
                ? { ...existingServers, ...servers }
                : servers;

            // Generate XML content
            const xmlContent = generateXmlContent(allServers);
            writeFileSync(resolvedPath, xmlContent);
        },

        async getInstalledServerNames(): Promise<string[]> {
            const config = await this.read();
            return Object.keys(config.servers);
        },

        async removeServers(names: string[]): Promise<void> {
            if (!existsSync(resolvedPath)) return;

            try {
                const config = await this.read();
                const servers = { ...config.servers };

                for (const name of names) {
                    delete servers[name];
                }

                const xmlContent = generateXmlContent(servers);
                writeFileSync(resolvedPath, xmlContent);
            } catch {
                // Ignore errors
            }
        },
    };
}

/**
 * Generate XML content from servers
 */
function generateXmlContent(servers: Record<string, McpServerConfig>): string {
    const serverBlocks: string[] = [];

    for (const [name, server] of Object.entries(servers)) {
        const args = server.args?.join(' ') || '';
        const envEntries = server.env
            ? Object.entries(server.env)
                .map(([k, v]) => {
                    // Handle both simple string and EnvVarSchema
                    const value = typeof v === 'object' && v !== null && 'value' in v
                        ? (v.value ?? '')
                        : (v ?? '');
                    return `        <env name="${escapeXml(k)}" value="${escapeXml(value)}" />`;
                })
                .join('\n')
            : '';

        serverBlocks.push(`    <McpServerCommand>
      <option name="enabled" value="true" />
      <option name="name" value="${escapeXml(name)}" />
      <option name="programPath" value="${escapeXml(server.command || '')}" />
      <option name="arguments" value="${escapeXml(args)}" />
      <option name="workingDirectory" value="" />
      <envs${envEntries ? '>\n' + envEntries + '\n      </envs>' : ' />'} 
    </McpServerCommand>`);
    }

    return `<application>
  <component name="McpApplicationServerCommands">
${serverBlocks.join('\n')}
  </component>
</application>
`;
}

/**
 * Escape special XML characters
 */
function escapeXml(str: string): string {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}
