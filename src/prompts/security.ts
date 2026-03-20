import * as p from '@clack/prompts';
import pc from 'picocolors';
import type { ParsedMcpConfig } from '../types.js';
import { plural } from './shared.js';

/**
 * Show security warning before installation
 */
export async function showSecurityWarning(config: ParsedMcpConfig): Promise<boolean> {
    const serverNames = Object.keys(config.servers);

    p.log.warn(pc.bold('⚠️  Security Notice'));
    p.log.message('');
    p.log.message(`You are installing ${plural(serverNames.length, 'MCP server')}: ${pc.cyan(serverNames.join(', '))}`);
    p.log.message('');
    p.log.message('MCP servers can:');
    p.log.message(`  ${pc.yellow('•')} Execute commands on your system`);
    p.log.message(`  ${pc.yellow('•')} Access files on your filesystem`);
    p.log.message(`  ${pc.yellow('•')} Make network requests`);
    p.log.message('');
    p.log.message(pc.dim('Only install from sources you trust.'));

    const confirmed = await p.confirm({
        message: 'Install MCP server?',
    });

    if (p.isCancel(confirmed)) {
        return false;
    }

    return confirmed;
}
