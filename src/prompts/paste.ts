import * as p from '@clack/prompts';
import * as readline from 'node:readline';
import pc from 'picocolors';
import type { AgentType, ParsedMcpConfig, McpServerConfig } from '../types.js';
import { parseConfig } from '../parsers/detect.js';
import { showToolSelector } from './tools.js';
import { showEnvPrompts } from './credentials.js';
import { showValidationScreen, showValidationConfirmation } from './validation.js';

/**
 * Drain any buffered stdin input
 */
function drainStdin(): Promise<void> {
    return new Promise((resolve) => {
        if (process.stdin.readable) {
            process.stdin.resume();
            // Read and discard any buffered data
            const drain = () => {
                while (process.stdin.read() !== null) {
                    // Discard
                }
            };
            drain();
            // Small delay to ensure buffer is clear
            setTimeout(() => {
                drain();
                resolve();
            }, 100);
        } else {
            resolve();
        }
    });
}

/**
 * Read multiline input until empty line or complete JSON
 */
async function readMultilineInput(): Promise<string | null> {
    return new Promise((resolve) => {
        const lines: string[] = [];
        let emptyLineCount = 0;

        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
            terminal: true,
            prompt: '',
        });

        console.log('  Paste your config (press Enter twice when done):');
        console.log('');

        const checkComplete = (): boolean => {
            const text = lines.join('\n').trim();
            if (!text) return false;

            // Count braces to detect complete JSON
            let braceCount = 0;
            for (const char of text) {
                if (char === '{') braceCount++;
                if (char === '}') braceCount--;
            }

            return braceCount === 0 && text.length > 0 && text.startsWith('{');
        };

        rl.on('line', (line) => {
            if (line === '') {
                emptyLineCount++;
                if (emptyLineCount >= 2) {
                    rl.close();
                    resolve(lines.join('\n').trim() || null);
                    return;
                }
            } else {
                emptyLineCount = 0;
            }

            lines.push(line);

            // Auto-complete if JSON looks complete
            if (checkComplete()) {
                rl.close();
                resolve(lines.join('\n').trim());
            }
        });

        rl.on('close', () => {
            resolve(lines.join('\n').trim() || null);
        });

        rl.on('SIGINT', () => {
            rl.close();
            resolve(null);
        });
    });
}

/**
 * Show formatted config preview for a server
 */
function showServerPreview(name: string, config: McpServerConfig): void {
    p.log.info(`${pc.cyan(pc.bold(name))}`);

    // Transport type
    const transport = config.type || (config.command ? 'stdio' : config.url ? 'sse' : 'unknown');
    p.log.message(`  Transport: ${pc.dim(transport)}`);

    if (config.command) {
        p.log.message(`  Command: ${pc.dim(config.command)}`);
        if (config.args?.length) {
            p.log.message(`  Args: ${pc.dim(config.args.join(' '))}`);
        }
    }

    if (config.url) {
        p.log.message(`  URL: ${pc.dim(config.url)}`);
    }

    if (config.env && Object.keys(config.env).length > 0) {
        const envEntries = Object.entries(config.env);
        p.log.message(`  Env: ${pc.dim(`${envEntries.length} variable(s):`)}`);
        for (const [key, value] of envEntries) {
            // Mask potentially sensitive values (API keys, tokens, secrets)
            const isSensitive = /key|token|secret|password|auth/i.test(key);
            const displayValue = isSensitive && value
                ? String(value).slice(0, 8) + '...'
                : String(value ?? '(not set)');
            p.log.message(`    ${pc.yellow(key)}: ${pc.dim(displayValue)}`);
        }
    }
}

/**
 * Edit a single server's configuration
 */
async function editServerConfig(
    name: string,
    config: McpServerConfig
): Promise<McpServerConfig | null> {
    let edited = { ...config };

    while (true) {
        // Determine current transport
        const currentTransport = edited.type || (edited.command ? 'stdio' : 'sse');

        // Build edit options based on transport
        const options = [
            { value: 'transport', label: `Transport (${currentTransport})` },
            ...(currentTransport === 'stdio' ? [
                { value: 'command', label: `Command${edited.command ? ` (${edited.command})` : ''}` },
                { value: 'args', label: `Args${edited.args?.length ? ` (${edited.args.length} items)` : ' (none)'}` },
            ] : [
                { value: 'url', label: `URL${edited.url ? ` (${edited.url})` : ''}` },
            ]),
            { value: 'env', label: `Environment (${Object.keys(edited.env || {}).length} vars)` },
            { value: 'done', label: 'Done editing' },
            { value: 'cancel', label: 'Cancel changes' },
        ];

        const action = await p.select({
            message: `Edit ${pc.cyan(name)}:`,
            options,
        });

        if (p.isCancel(action) || action === 'cancel') {
            return null;
        }

        if (action === 'done') {
            return edited;
        }

        switch (action) {
            case 'transport': {
                const newTransport = await p.select({
                    message: 'Select transport:',
                    options: [
                        { value: 'stdio', label: 'stdio (local command)' },
                        { value: 'sse', label: 'sse (server-sent events)' },
                        { value: 'http', label: 'http (streamable HTTP)' },
                    ],
                });

                if (!p.isCancel(newTransport)) {
                    edited.type = newTransport as 'stdio' | 'sse' | 'http';

                    // Reset fields based on new transport
                    if (newTransport === 'stdio') {
                        edited.url = undefined;
                        if (!edited.command) {
                            const cmd = await p.text({ message: 'Command:' });
                            if (!p.isCancel(cmd)) edited.command = cmd;
                        }
                    } else {
                        edited.command = undefined;
                        edited.args = undefined;
                        if (!edited.url) {
                            const url = await p.text({ message: 'URL:' });
                            if (!p.isCancel(url)) edited.url = url;
                        }
                    }
                }
                break;
            }

            case 'command': {
                const newCmd = await p.text({
                    message: 'Command:',
                    initialValue: edited.command || '',
                });
                if (!p.isCancel(newCmd)) {
                    edited.command = newCmd;
                }
                break;
            }

            case 'args': {
                const argsStr = await p.text({
                    message: 'Args (space-separated):',
                    initialValue: edited.args?.join(' ') || '',
                });
                if (!p.isCancel(argsStr)) {
                    edited.args = argsStr.trim() ? argsStr.trim().split(/\s+/) : [];
                }
                break;
            }

            case 'url': {
                const newUrl = await p.text({
                    message: 'URL:',
                    initialValue: edited.url || '',
                });
                if (!p.isCancel(newUrl)) {
                    edited.url = newUrl;
                }
                break;
            }

            case 'env': {
                // Edit environment variables
                const env = edited.env || {};
                const envKeys = Object.keys(env);

                const envOptions = [
                    ...envKeys.map(k => ({
                        value: `edit:${k}`,
                        label: `${k} = ${typeof env[k] === 'string' && env[k].length > 20 ? env[k].slice(0, 20) + '...' : env[k] ?? '(not set)'}`,
                    })),
                    { value: 'add', label: pc.green('+ Add new variable') },
                    { value: 'back', label: 'Back' },
                ];

                const envAction = await p.select({
                    message: 'Environment variables:',
                    options: envOptions,
                });

                if (!p.isCancel(envAction) && envAction !== 'back') {
                    if (envAction === 'add') {
                        const newKey = await p.text({ message: 'Variable name:' });
                        if (!p.isCancel(newKey) && newKey) {
                            const newVal = await p.text({ message: `Value for ${newKey}:` });
                            if (!p.isCancel(newVal)) {
                                edited.env = { ...env, [newKey]: newVal };
                            }
                        }
                    } else if (envAction.startsWith('edit:')) {
                        const keyToEdit = envAction.replace('edit:', '');
                        const editOrDelete = await p.select({
                            message: `${keyToEdit}:`,
                            options: [
                                { value: 'edit', label: 'Edit value' },
                                { value: 'delete', label: pc.red('Delete') },
                            ],
                        });

                        if (!p.isCancel(editOrDelete)) {
                            if (editOrDelete === 'edit') {
                                const newVal = await p.text({
                                    message: `New value for ${keyToEdit}:`,
                                    initialValue: String(env[keyToEdit] || ''),
                                });
                                if (!p.isCancel(newVal)) {
                                    edited.env = { ...env, [keyToEdit]: newVal };
                                }
                            } else {
                                const { [keyToEdit]: _, ...rest } = env;
                                edited.env = rest;
                            }
                        }
                    }
                }
                break;
            }
        }
    }
}

/**
 * Show confirmation prompt with preview, validation, and edit option
 * @param needsRevalidation - If true, show "Revalidate" instead of "Looks good"
 */
async function showConfigConfirmation(
    parsed: ParsedMcpConfig,
    needsRevalidation = false
): Promise<ParsedMcpConfig | null> {
    const serverNames = Object.keys(parsed.servers);

    // Show preview of all servers
    p.log.step('Configuration Preview:');
    for (const name of serverNames) {
        showServerPreview(name, parsed.servers[name]);
    }

    // Build confirmation options based on whether we need revalidation
    const confirmLabel = needsRevalidation
        ? pc.yellow('Revalidate configuration & install')
        : pc.green('Looks good! Validate & continue');

    // For multiple servers, let user select which to edit
    if (serverNames.length > 1) {
        const action = await p.select({
            message: 'Configuration looks correct?',
            options: [
                { value: 'confirm', label: confirmLabel },
                { value: 'edit', label: 'Edit a server' },
                { value: 'cancel', label: 'Cancel' },
            ],
        });

        if (p.isCancel(action) || action === 'cancel') {
            return null;
        }

        if (action === 'confirm') {
            // Run validation
            const validationResult = await showValidationScreen(parsed);
            const decision = await showValidationConfirmation(validationResult);

            if (decision === 'install') {
                return parsed;
            } else if (decision === 'back') {
                // Loop back with revalidation flag
                return showConfigConfirmation(parsed, true);
            } else {
                return null;
            }
        }

        // Edit flow - select which server
        const serverToEdit = await p.select({
            message: 'Which server to edit?',
            options: serverNames.map(n => ({ value: n, label: n })),
        });

        if (p.isCancel(serverToEdit)) {
            return showConfigConfirmation(parsed, needsRevalidation);
        }

        const edited = await editServerConfig(serverToEdit, parsed.servers[serverToEdit]);
        if (edited) {
            const updatedConfig = {
                ...parsed,
                servers: { ...parsed.servers, [serverToEdit]: edited },
            };
            // Return to confirmation with revalidation flag
            return showConfigConfirmation(updatedConfig, needsRevalidation);
        }

        // If cancelled edit, return to confirmation
        return showConfigConfirmation(parsed, needsRevalidation);
    } else {
        // Single server - simpler flow
        const action = await p.select({
            message: 'Configuration looks correct?',
            options: [
                { value: 'confirm', label: confirmLabel },
                { value: 'edit', label: 'Edit configuration' },
                { value: 'cancel', label: 'Cancel' },
            ],
        });

        if (p.isCancel(action) || action === 'cancel') {
            return null;
        }

        if (action === 'confirm') {
            // Run validation
            const validationResult = await showValidationScreen(parsed);
            const decision = await showValidationConfirmation(validationResult);

            if (decision === 'install') {
                return parsed;
            } else if (decision === 'back') {
                // Loop back with revalidation flag
                return showConfigConfirmation(parsed, true);
            } else {
                return null;
            }
        }

        // Edit the single server
        const [serverName] = serverNames;
        const edited = await editServerConfig(serverName, parsed.servers[serverName]);
        if (edited) {
            const updatedConfig = {
                ...parsed,
                servers: { ...parsed.servers, [serverName]: edited },
            };
            // Return to confirmation with revalidation flag
            return showConfigConfirmation(updatedConfig, needsRevalidation);
        }

        // If cancelled edit, return to confirmation
        return showConfigConfirmation(parsed, needsRevalidation);
    }
}

/**
 * Show paste configuration prompt with multiline support
 */
export async function showPastePrompt(installedAgents: AgentType[]) {
    p.log.info('Paste your MCP configuration (JSON or YAML)');

    const input = await readMultilineInput();

    if (!input) {
        p.log.info('Cancelled');
        return;
    }

    // Basic validation
    const trimmed = input.trim();
    if (!trimmed.startsWith('{') && !trimmed.includes(':')) {
        p.log.error('Invalid format. Must be JSON or YAML');
        return;
    }

    // Show spinner during parsing
    const s = p.spinner();
    s.start('Parsing configuration...');

    let parsed: ParsedMcpConfig;
    try {
        parsed = parseConfig(input);
        s.stop(`Found ${Object.keys(parsed.servers).length} server(s): ${Object.keys(parsed.servers).join(', ')}`);
    } catch (err) {
        s.stop('Failed to parse configuration');
        p.log.error(err instanceof Error ? err.message : 'Unknown error');
        return;
    }

    // Drain stdin buffer before showing next prompt
    await drainStdin();

    const serverNames = Object.keys(parsed.servers);

    // Prompt for env vars if any have null values (do this BEFORE confirmation
    // so the user can review complete config with actual values)
    const configWithEnv = await showEnvPrompts(parsed);

    // If user cancelled during env prompts, exit
    if (!configWithEnv) {
        p.log.info('Cancelled');
        return;
    }

    // Confirmation step with preview and edit option
    const confirmed = await showConfigConfirmation(configWithEnv);

    // If user cancelled, exit
    if (!confirmed) {
        p.log.info('Cancelled');
        return;
    }

    // Drain again before tool selector
    await drainStdin();

    // Select tools to install
    await showToolSelector(installedAgents, confirmed);
}
