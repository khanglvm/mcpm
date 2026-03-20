import * as p from '@clack/prompts';
import type { ParsedMcpConfig } from '../types.js';
import { parseConfig } from '../parsers/detect.js';

/**
 * GitHub URL patterns
 */
const GITHUB_URL_REGEX = /^https?:\/\/(?:www\.)?github\.com\/([^\/]+)\/([^\/]+)/;

/**
 * Parse GitHub URL to extract owner and repo
 */
export function parseGitHubUrl(url: string): { owner: string; repo: string } | null {
    const match = url.match(GITHUB_URL_REGEX);
    if (!match) return null;

    return {
        owner: match[1],
        repo: match[2].replace(/\.git$/, '').split('/')[0].split('#')[0].split('?')[0],
    };
}

/**
 * Fetch MCP configuration from a GitHub repository
 */
export async function fetchFromGitHub(url: string): Promise<ParsedMcpConfig | null> {
    const parsed = parseGitHubUrl(url);
    if (!parsed) {
        throw new Error('Invalid GitHub URL');
    }

    const { owner, repo } = parsed;

    // Try to fetch mcp.json first
    const mcpJsonUrl = `https://raw.githubusercontent.com/${owner}/${repo}/main/mcp.json`;
    const mcpJsonAlt = `https://raw.githubusercontent.com/${owner}/${repo}/master/mcp.json`;

    let config = await tryFetchConfig(mcpJsonUrl);
    if (!config) {
        config = await tryFetchConfig(mcpJsonAlt);
    }

    if (config) {
        return config;
    }

    // Try to extract from README.md
    const readmeUrl = `https://raw.githubusercontent.com/${owner}/${repo}/main/README.md`;
    const readmeAlt = `https://raw.githubusercontent.com/${owner}/${repo}/master/README.md`;

    let readmeConfig = await tryExtractFromReadme(readmeUrl);
    if (!readmeConfig) {
        readmeConfig = await tryExtractFromReadme(readmeAlt);
    }

    return readmeConfig;
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

        // Check if it looks like MCP config (JSON or YAML)
        if (
            content.includes('mcpServers') ||
            content.includes('mcp_servers') ||
            (content.startsWith('{') && (content.includes('"command"') || content.includes('"url"')))
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

