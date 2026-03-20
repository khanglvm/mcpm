import * as p from '@clack/prompts';
import pc from 'picocolors';
import type { AgentType, ParsedMcpConfig, AutoOptions } from '../types.js';
import { parseConfig } from '../parsers/detect.js';
import { showEnvPrompts } from './credentials.js';
import { showToolSelector } from './tools.js';
import { plural } from './shared.js';
import { showValidationScreen, showValidationConfirmation } from './validation.js';
import { checkAutoConditions, runAutoInstall } from './yolo.js';

/**
 * Handle direct JSON/YAML/TOML MCP config data passed as CLI argument
 * @param installedAgents - List of detected agents
 * @param configData - Raw config string (JSON, YAML, or TOML)
 * @param autoOptions - Optional auto mode options for automated installation
 * @returns true if flow completed, false if cancelled
 */
export async function showDirectConfigPrompt(
    installedAgents: AgentType[],
    configData: string,
    autoOptions?: AutoOptions
): Promise<boolean> {
    const s = p.spinner();
    s.start('Parsing configuration...');

    let config: ParsedMcpConfig;
    try {
        config = parseConfig(configData);
        const serverNames = Object.keys(config.servers);
        s.stop(`Found ${plural(serverNames.length, 'server')} (${config.sourceFormat.toUpperCase()}): ${serverNames.join(', ')}`);
    } catch (err) {
        s.stop('Failed to parse configuration');
        p.log.error(err instanceof Error ? err.message : 'Unknown error');
        p.log.info('Supported formats: JSON, YAML, TOML');
        return false;
    }

    // Auto mode (-y): check conditions and run automated install if possible
    if (autoOptions?.enabled) {
        const autoCheck = checkAutoConditions(config, installedAgents, autoOptions.scope);
        if (autoCheck.canRun) {
            return await runAutoInstall(
                config,
                installedAgents,
                autoOptions.scope,
                autoOptions.preAgents,
                autoOptions.autoSelectAll
            );
        }
        // Conditions not met, fall through to normal flow
    }

    // Prompt for env vars if any have null values
    const configWithEnv = await showEnvPrompts(config);

    // If user cancelled during env prompts, exit
    if (!configWithEnv) {
        return false;
    }

    // Validate MCP server(s) and show available tools
    const validationResult = await showValidationScreen(configWithEnv);

    // If validation failed, ask user what to do
    if (!validationResult.allPassed) {
        const decision = await showValidationConfirmation(validationResult);

        if (decision === 'cancel') {
            p.log.info('Cancelled');
            return false;
        }

        if (decision === 'back') {
            // Re-prompt for env vars and try again
            p.log.info('Going back to edit configuration...');
            return await showDirectConfigPrompt(installedAgents, configData, autoOptions);
        }
        // decision === 'install' - proceed anyway
    }

    // Select agents and install
    await showToolSelector(installedAgents, configWithEnv, undefined, autoOptions?.autoSelectAll);
    return true;
}
