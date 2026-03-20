/**
 * Remove flow - remove servers from registry and/or agents
 */

import * as p from '@clack/prompts';
import pc from 'picocolors';
import type { AgentType, InstallScope } from '../types.js';
import { agents, getAgentConfig, detectInstalledAgents, getAgentsWithLocalSupport } from '../agents.js';
import { listServers, removeServer } from '../registry/store.js';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { multiselectWithAll } from './shared.js';

type FlowResult = 'back' | 'done';

/**
 * Run remove flow
 */
export async function runRemoveFlow(): Promise<FlowResult> {
    const servers = listServers();
    const installedAgents = detectInstalledAgents();
    const localSupportAgents = getAgentsWithLocalSupport();

    // Detect which agents have local configs in current directory
    const agentsWithLocalConfig = localSupportAgents.filter(type => {
        const config = getAgentConfig(type);
        return config.localConfigPath && existsSync(config.localConfigPath);
    });

    if (servers.length === 0 && agentsWithLocalConfig.length === 0) {
        p.log.warn('Registry is empty and no local configs found.');
        return 'done';
    }

    // Step 1: Select servers to remove (with Select All)
    const serverItems = servers.map(s => ({
        value: s.name,
        label: s.name,
        hint: s.transport === 'stdio' ? s.command : s.url,
    }));

    const selectedServers = await multiselectWithAll({
        message: 'Select servers to remove:',
        items: serverItems,
    });

    if (selectedServers === null) {
        return 'back';
    }

    if (selectedServers.length === 0) {
        p.log.warn('No servers selected.');
        return 'done';
    }

    // Step 2: Select removal scope
    const scopeItems: { value: string; label: string; hint?: string }[] = [
        { value: 'complete', label: 'Completely remove', hint: 'Registry + all agents + local' },
        { value: 'registry', label: 'Remove from registry only' },
    ];

    // Add project-scope option if local configs exist
    if (agentsWithLocalConfig.length > 0) {
        const localNames = agentsWithLocalConfig.map(a => agents[a].displayName).join(', ');
        scopeItems.push({
            value: 'project',
            label: 'Remove from project configs only',
            hint: localNames,
        });
    }

    // Add per-agent options
    scopeItems.push(
        ...installedAgents.map(type => ({
            value: `agent:${type}`,
            label: `Remove from ${agents[type].displayName}`,
        }))
    );

    const selectedScopes = await multiselectWithAll({
        message: 'Where to remove from:',
        items: scopeItems,
    });

    if (selectedScopes === null) {
        return 'back';
    }

    if (selectedScopes.length === 0) {
        p.log.warn('No scope selected.');
        return 'done';
    }

    // Show confirmation if removing from project but registry still has servers
    if (selectedScopes.includes('project') && !selectedScopes.includes('registry') && !selectedScopes.includes('complete')) {
        const confirm = await p.confirm({
            message: 'Registry will still contain these servers. Continue?',
            initialValue: true,
        });
        if (p.isCancel(confirm) || !confirm) {
            return 'back';
        }
    }

    // Step 3: Perform removal
    const s = p.spinner();
    s.start('Removing servers...');

    let removedFromRegistry = 0;
    let removedFromAgents = 0;
    let removedFromLocal = 0;

    // Handle complete removal
    if (selectedScopes.includes('complete')) {
        // Remove from registry
        for (const name of selectedServers) {
            if (removeServer(name)) {
                removedFromRegistry++;
            }
        }
        // Remove from all global agents
        for (const agentType of installedAgents) {
            const count = await removeFromAgent(agentType, selectedServers, 'global');
            removedFromAgents += count;
        }
        // Remove from all local configs
        for (const agentType of agentsWithLocalConfig) {
            const count = await removeFromAgent(agentType, selectedServers, 'project');
            removedFromLocal += count;
        }
    } else {
        // Handle selective removal
        if (selectedScopes.includes('registry')) {
            for (const name of selectedServers) {
                if (removeServer(name)) {
                    removedFromRegistry++;
                }
            }
        }

        // Handle project-scope removal
        if (selectedScopes.includes('project')) {
            for (const agentType of agentsWithLocalConfig) {
                const count = await removeFromAgent(agentType, selectedServers, 'project');
                removedFromLocal += count;
            }
        }

        // Handle per-agent removal
        for (const scope of selectedScopes) {
            if (scope.startsWith('agent:')) {
                const agentType = scope.slice('agent:'.length) as AgentType;
                const count = await removeFromAgent(agentType, selectedServers, 'global');
                removedFromAgents += count;
            }
        }
    }

    s.stop('Removal complete');

    // Show results
    if (removedFromRegistry > 0) {
        p.log.success(`Removed ${removedFromRegistry} server(s) from registry`);
    }
    if (removedFromAgents > 0) {
        p.log.success(`Removed ${removedFromAgents} server(s) from global configs`);
    }
    if (removedFromLocal > 0) {
        p.log.success(`Removed ${removedFromLocal} server(s) from project configs`);
    }

    return 'done';
}

/**
 * Remove servers from an agent's config
 */
async function removeFromAgent(
    agentType: AgentType,
    serverNames: string[],
    scope: InstallScope = 'global'
): Promise<number> {
    const config = getAgentConfig(agentType);

    // Determine config path based on scope
    const configPath = scope === 'project'
        ? config.localConfigPath
        : config.mcpConfigPath;

    if (!configPath || !existsSync(configPath)) {
        return 0;
    }

    try {
        const content = readFileSync(configPath, 'utf-8');
        const parsed = JSON.parse(content);
        const serversObj = parsed[config.wrapperKey] || {};

        let removed = 0;
        for (const name of serverNames) {
            // Check both exact name and mcpm-prefixed name
            if (serversObj[name]) {
                delete serversObj[name];
                removed++;
            }
            const mcpmName = `mcpm-${name}`;
            if (serversObj[mcpmName]) {
                delete serversObj[mcpmName];
                removed++;
            }
        }

        if (removed > 0) {
            parsed[config.wrapperKey] = serversObj;
            writeFileSync(
                configPath,
                JSON.stringify(parsed, null, 2) + '\n'
            );
        }

        return removed;
    } catch {
        return 0;
    }
}

