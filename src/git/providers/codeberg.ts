// Gitea/Codeberg Provider

import type { GitProvider } from '../types.js';

// Matches codeberg.org and Gitea instances
const CODEBERG_URL_REGEX = /^https?:\/\/(?:www\.)?codeberg\.org\/([^\/]+)\/([^\/]+)/;

export const CodebergProvider: GitProvider = {
    name: 'Codeberg',

    matchUrl(url: string): boolean {
        return CODEBERG_URL_REGEX.test(url);
    },

    parseUrl(url: string): { owner: string; repo: string } | null {
        const match = url.match(CODEBERG_URL_REGEX);
        if (!match) return null;

        return {
            owner: match[1],
            repo: match[2].replace(/\.git$/, '').split('/')[0].split('#')[0].split('?')[0],
        };
    },

    getRawFileUrl(owner: string, repo: string, branch: string, path: string): string {
        return `https://codeberg.org/${owner}/${repo}/raw/branch/${branch}/${path}`;
    },

    defaultBranches: ['main', 'master'],
};

/**
 * Create a Gitea provider for a specific domain
 */
export function createGiteaProvider(domain: string, name?: string): GitProvider {
    const regex = new RegExp(`^https?:\\/\\/(?:www\\.)?${domain.replace('.', '\\.')}\\/([^\\/]+)\\/([^\\/]+)`);

    return {
        name: name || `Gitea (${domain})`,

        matchUrl(url: string): boolean {
            return regex.test(url);
        },

        parseUrl(url: string): { owner: string; repo: string } | null {
            const match = url.match(regex);
            if (!match) return null;

            return {
                owner: match[1],
                repo: match[2].replace(/\.git$/, '').split('/')[0].split('#')[0].split('?')[0],
            };
        },

        getRawFileUrl(owner: string, repo: string, branch: string, path: string): string {
            return `https://${domain}/${owner}/${repo}/raw/branch/${branch}/${path}`;
        },

        defaultBranches: ['main', 'master'],
    };
}
