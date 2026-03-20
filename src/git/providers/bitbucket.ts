// Bitbucket Provider

import type { GitProvider } from '../types.js';

const BITBUCKET_URL_REGEX = /^https?:\/\/(?:www\.)?bitbucket\.org\/([^\/]+)\/([^\/]+)/;

export const BitbucketProvider: GitProvider = {
    name: 'Bitbucket',

    matchUrl(url: string): boolean {
        return BITBUCKET_URL_REGEX.test(url);
    },

    parseUrl(url: string): { owner: string; repo: string } | null {
        const match = url.match(BITBUCKET_URL_REGEX);
        if (!match) return null;

        return {
            owner: match[1],
            repo: match[2].replace(/\.git$/, '').split('/')[0].split('#')[0].split('?')[0],
        };
    },

    getRawFileUrl(owner: string, repo: string, branch: string, path: string): string {
        return `https://bitbucket.org/${owner}/${repo}/raw/${branch}/${path}`;
    },

    defaultBranches: ['main', 'master'],
};
