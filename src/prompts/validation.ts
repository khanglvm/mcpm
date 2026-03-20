/**
 * MCP Server Validation Screen
 * Shows validation results with tools listing
 */

import * as p from '@clack/prompts';
import pc from 'picocolors';
import type { ParsedMcpConfig } from '../types.js';
import { validateAllServers, type ValidationResult } from '../core/validator.js';
import { plural } from './shared.js';

/**
 * Result of the validation screen
 */
export interface ValidationScreenResult {
    /** Whether all servers passed validation */
    allPassed: boolean;
    /** Individual validation results */
    results: ValidationResult[];
}

/**
 * Show validation screen with spinner and results
 */
export async function showValidationScreen(
    config: ParsedMcpConfig
): Promise<ValidationScreenResult> {
    const serverNames = Object.keys(config.servers);

    const s = p.spinner();
    s.start(`Validating ${plural(serverNames.length, 'MCP server')}...`);

    try {
        const results = await validateAllServers(config.servers);

        const passed = results.filter((r) => r.success);
        const failed = results.filter((r) => !r.success);

        if (failed.length === 0) {
            s.stop(pc.green(`✓ All ${plural(serverNames.length, 'server')} validated successfully`));
        } else if (passed.length === 0) {
            s.stop(pc.red(`✗ All ${plural(serverNames.length, 'server')} failed validation`));
        } else {
            s.stop(pc.yellow(`⚠ ${passed.length}/${serverNames.length} servers validated`));
        }

        // Show results for each server
        for (const result of results) {
            if (result.success && result.tools) {
                // Success: show server name and tool count
                const toolCount = result.tools.length;
                const toolText = toolCount === 0
                    ? pc.dim('No tools exposed')
                    : pc.green(`${toolCount} tool${toolCount !== 1 ? 's' : ''} available`);
                p.log.success(`${pc.cyan(result.serverName)} — ${toolText}`);
            } else {
                // Failure: show server name and error
                p.log.error(`${pc.cyan(result.serverName)}`);
                p.log.message(`  ${pc.red(result.error || 'Unknown error')}`);
            }
        }

        return {
            allPassed: failed.length === 0,
            results,
        };
    } catch (err) {
        s.stop(pc.red('Validation failed'));
        p.log.error(err instanceof Error ? err.message : 'Unknown error');

        return {
            allPassed: false,
            results: [],
        };
    }
}

/**
 * Show confirmation prompt after validation
 */
export async function showValidationConfirmation(
    validationResult: ValidationScreenResult
): Promise<'install' | 'back' | 'cancel'> {
    if (!validationResult.allPassed) {
        const failedCount = validationResult.results.filter((r) => !r.success).length;

        const action = await p.select({
            message: `${failedCount} server(s) failed validation. What would you like to do?`,
            options: [
                { value: 'back', label: 'Go back and edit configuration' },
                { value: 'install', label: pc.yellow('Install anyway (not recommended)') },
                { value: 'cancel', label: 'Cancel' },
            ],
        });

        if (p.isCancel(action)) {
            return 'cancel';
        }

        return action as 'install' | 'back' | 'cancel';
    }

    // All passed - simple confirmation
    const confirmed = await p.confirm({
        message: 'Proceed with installation?',
        initialValue: true,
    });

    if (p.isCancel(confirmed) || !confirmed) {
        return 'cancel';
    }

    return 'install';
}
