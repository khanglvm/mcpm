// Git Provider Types

import type { ParsedMcpConfig } from '../types.js';

/**
 * Git provider interface for fetching MCP configs from repositories
 */
export interface GitProvider {
    /** Provider display name */
    name: string;

    /** Check if URL matches this provider */
    matchUrl(url: string): boolean;

    /** Parse URL to extract owner/repo */
    parseUrl(url: string): { owner: string; repo: string } | null;

    /** Get raw file URL for a given path */
    getRawFileUrl(owner: string, repo: string, branch: string, path: string): string;

    /** Default branches to try */
    defaultBranches: string[];
}

/**
 * Result of URL detection
 */
export interface DetectedProvider {
    provider: GitProvider;
    owner: string;
    repo: string;
}
