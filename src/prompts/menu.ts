/**
 * Main menu with flattened structure and ESC-back navigation
 */

import * as p from '@clack/prompts';
import type { AgentType } from '../types.js';
import { listServers } from '../registry/store.js';
import { showPastePrompt } from './paste.js';
import { showGitPrompt } from './github.js';
import { runBuildMode } from './build.js';
import { runSyncFlow } from './sync.js';
import { runRemoveFlow } from './remove.js';
import { runImportFlow } from './import.js';
import { runEditFlow } from './edit.js';

/**
 * Show interactive menu when run without arguments
 */
export async function showMenu(installedAgents: AgentType[]) {
    while (true) {
        const shouldExit = await showRootMenu(installedAgents);
        if (shouldExit) break;
    }
}

/**
 * Root menu - flattened structure
 * ESC = exit prompt (at root level only)
 */
async function showRootMenu(installedAgents: AgentType[]): Promise<boolean> {
    const servers = listServers();
    const hasServers = servers.length > 0;

    // Build options based on registry state
    type MenuOption = 'add' | 'sync' | 'remove' | 'import' | 'edit' | 'exit';

    const options: { value: MenuOption; label: string; hint?: string }[] = [
        {
            value: 'add',
            label: 'Add MCP Server',
            hint: 'Paste, build, or from repository',
        },
    ];

    // Only show Sync, Remove, Edit if registry has servers
    if (hasServers) {
        options.push({
            value: 'sync',
            label: 'Sync to Agents',
            hint: `Push ${servers.length} server(s) to agents`,
        });
    }

    if (hasServers) {
        options.push({
            value: 'remove',
            label: 'Remove MCP Server',
            hint: 'Remove from registry/agents',
        });
    }

    options.push({
        value: 'import',
        label: 'Import from Agent',
        hint: 'Pull existing configs into registry',
    });

    if (hasServers) {
        options.push({
            value: 'edit',
            label: 'Edit MCP Server',
            hint: 'Modify server configurations',
        });
    }

    options.push({
        value: 'exit',
        label: 'Exit',
    });

    const choice = await p.select<MenuOption>({
        message: 'What would you like to do?',
        options,
    });

    // ESC at root level = exit
    if (p.isCancel(choice)) {
        return true;
    }

    if (choice === 'exit') {
        return true;
    }

    // Handle each menu option
    switch (choice) {
        case 'add':
            await runAddFlow(installedAgents);
            break;
        case 'sync':
            await runSyncFlow();
            break;
        case 'remove':
            await runRemoveFlow();
            break;
        case 'import':
            await runImportFlow();
            break;
        case 'edit':
            await runEditFlow();
            break;
    }

    return false;
}

/**
 * Add server submenu
 */
async function runAddFlow(installedAgents: AgentType[]): Promise<void> {
    type AddSource = 'paste' | 'build' | 'git';

    const source = await p.select<AddSource | 'back'>({
        message: 'How would you like to add?',
        options: [
            {
                value: 'paste',
                label: 'Paste JSON/YAML',
                hint: 'Copy from README or docs',
            },
            {
                value: 'build',
                label: 'Build step-by-step',
                hint: 'Create from scratch',
            },
            {
                value: 'git',
                label: 'Git repository',
                hint: 'GitHub, GitLab, Bitbucket, etc.',
            },
            {
                value: 'back',
                label: 'Back',
            },
        ],
    });

    // ESC = go back
    if (p.isCancel(source) || source === 'back') {
        return;
    }

    try {
        switch (source) {
            case 'paste':
                await showPastePrompt(installedAgents);
                break;
            case 'build':
                await runBuildMode();
                break;
            case 'git':
                await showGitPrompt(installedAgents);
                break;
        }
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        p.log.error(`Failed: ${msg}`);
    }
}
