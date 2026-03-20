// GitHub Provider

import type { GitProvider } from '../types.js';

const GITHUB_URL_REGEX = /^https?:\/\/(?:www\.)?github\.com\/([^\/]+)\/([^\/]+)/;

export const GitHubProvider: GitProvider = {
    name: 'GitHub',

    matchUrl(url: string): boolean {
        return GITHUB_URL_REGEX.test(url);
    },

    parseUrl(url: string): { owner: string; repo: string } | null {
        const match = url.match(GITHUB_URL_REGEX);
        if (!match) return null;

        return {
            owner: match[1],
            repo: match[2].replace(/\.git$/, '').split('/')[0].split('#')[0].split('?')[0],
        };
    },

    getRawFileUrl(owner: string, repo: string, branch: string, path: string): string {
        return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`;
    },

    defaultBranches: ['main', 'master'],
};
