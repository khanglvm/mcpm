// GitLab Provider (including self-hosted)

import type { GitProvider } from '../types.js';

// Matches gitlab.com and self-hosted GitLab instances
const GITLAB_URL_REGEX = /^https?:\/\/([^\/]+)\/(.+?)\/([^\/]+?)(?:\.git)?(?:\/.*)?$/;

export const GitLabProvider: GitProvider = {
    name: 'GitLab',

    matchUrl(url: string): boolean {
        // Check for gitlab.com or common GitLab URL patterns
        if (url.includes('gitlab.com')) return true;
        if (url.includes('gitlab.')) return true;
        // Self-hosted detection: has /-/ pattern or ends with .git
        if (url.includes('/-/')) return true;
        return false;
    },

    parseUrl(url: string): { owner: string; repo: string } | null {
        // Handle gitlab.com/owner/group/repo or gitlab.com/owner/repo
        const match = url.match(GITLAB_URL_REGEX);
        if (!match) return null;

        const pathParts = url.split('/').slice(3).filter(p => p && !p.startsWith('-') && !p.startsWith('?') && !p.startsWith('#'));
        if (pathParts.length < 2) return null;

        // Last part is repo, rest is owner (supports nested groups)
        const repo = pathParts[pathParts.length - 1].replace(/\.git$/, '');
        const owner = pathParts.slice(0, -1).join('/');

        return { owner, repo };
    },

    getRawFileUrl(owner: string, repo: string, branch: string, path: string): string {
        // Default to gitlab.com, but this works for self-hosted too
        const domain = 'gitlab.com';
        return `https://${domain}/${owner}/${repo}/-/raw/${branch}/${path}`;
    },

    defaultBranches: ['main', 'master'],
};

/**
 * Create a self-hosted GitLab provider for a specific domain
 */
export function createSelfHostedGitLab(domain: string): GitProvider {
    return {
        ...GitLabProvider,
        name: `GitLab (${domain})`,

        matchUrl(url: string): boolean {
            return url.includes(domain);
        },

        getRawFileUrl(owner: string, repo: string, branch: string, path: string): string {
            return `https://${domain}/${owner}/${repo}/-/raw/${branch}/${path}`;
        },
    };
}
