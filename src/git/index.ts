// Unified Git Provider Fetcher

import type { ParsedMcpConfig } from '../types.js';
import type { GitProvider, DetectedProvider } from './types.js';
import { parseConfig } from '../parsers/detect.js';
import { GitHubProvider, GitLabProvider, BitbucketProvider, CodebergProvider } from './providers/index.js';

/**
 * All registered providers (order matters - first match wins)
 */
const providers: GitProvider[] = [
    GitHubProvider,
    GitLabProvider,
    BitbucketProvider,
    CodebergProvider,
];

/**
 * Detect which provider matches the URL
 */
export function detectProvider(url: string): DetectedProvider | null {
    for (const provider of providers) {
        if (provider.matchUrl(url)) {
            const parsed = provider.parseUrl(url);
            if (parsed) {
                return { provider, ...parsed };
            }
        }
    }
    return null;
}

/**
 * Parse any supported git URL
 */
export function parseGitUrl(url: string): { owner: string; repo: string; provider: string } | null {
    const detected = detectProvider(url);
    if (!detected) return null;

    return {
        owner: detected.owner,
        repo: detected.repo,
        provider: detected.provider.name,
    };
}

/**
 * Fetch MCP configuration from any supported git repository
 */
export async function fetchFromGit(url: string): Promise<ParsedMcpConfig | null> {
    const detected = detectProvider(url);
    if (!detected) {
        return null;
    }

    const { provider, owner, repo } = detected;

    // Try each default branch
    for (const branch of provider.defaultBranches) {
        // Try mcp.json first
        const mcpJsonUrl = provider.getRawFileUrl(owner, repo, branch, 'mcp.json');
        const config = await tryFetchConfig(mcpJsonUrl);
        if (config) return config;

        // Try README.md extraction
        const readmeUrl = provider.getRawFileUrl(owner, repo, branch, 'README.md');
        const readmeConfig = await tryExtractFromReadme(readmeUrl);
        if (readmeConfig) return readmeConfig;
    }

    return null;
}

/**
 * Try to fetch and parse a config file
 */
async function tryFetchConfig(url: string): Promise<ParsedMcpConfig | null> {
    try {
        const response = await fetch(url);
        if (!response.ok) return null;

        const text = await response.text();
        return parseConfig(text);
    } catch {
        return null;
    }
}

/**
 * Extract MCP config from README markdown
 */
async function tryExtractFromReadme(url: string): Promise<ParsedMcpConfig | null> {
    try {
        const response = await fetch(url);
        if (!response.ok) return null;

        const markdown = await response.text();
        return extractMcpFromMarkdown(markdown);
    } catch {
        return null;
    }
}

/**
 * Extract MCP configuration from markdown code blocks
 */
export function extractMcpFromMarkdown(markdown: string): ParsedMcpConfig | null {
    // Match any code block (with or without language label)
    const codeBlockRegex = /```(\w*)\s*\n([\s\S]*?)\n```/gi;

    let match;
    const candidates: { content: string; lang: string }[] = [];

    // Collect all potential MCP config blocks
    while ((match = codeBlockRegex.exec(markdown)) !== null) {
        const lang = match[1]?.toLowerCase() || '';
        const content = match[2].trim();

        // Check if it looks like MCP config (JSON, YAML, or TOML)
        if (
            content.includes('mcpServers') ||
            content.includes('mcp_servers') ||
            content.includes('[mcpServers') ||
            content.includes('[mcp_servers') ||
            (content.startsWith('{') && (content.includes('"command"') || content.includes('"url"'))) ||
            (content.startsWith('[') && (content.includes('command =') || content.includes('url =')))
        ) {
            candidates.push({ content, lang });
        }
    }

    // Try to parse candidates, preferring larger configs
    candidates.sort((a, b) => b.content.length - a.content.length);

    for (const { content } of candidates) {
        try {
            const parsed = parseConfig(content);
            if (Object.keys(parsed.servers).length > 0) {
                return parsed;
            }
        } catch {
            // Continue to next block
        }
    }

    return null;
}

// Re-export types
export type { GitProvider, DetectedProvider } from './types.js';
