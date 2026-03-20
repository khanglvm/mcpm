/**
 * Edit flow - edit servers in registry
 */

import * as p from '@clack/prompts';
import pc from 'picocolors';
import { listServers, loadRegistry, saveRegistry } from '../registry/store.js';
import type { RegistryServer } from '../registry/types.js';

type FlowResult = 'back' | 'done';

/**
 * Run edit flow
 */
export async function runEditFlow(): Promise<FlowResult> {
    while (true) {
        const servers = listServers();

        if (servers.length === 0) {
            p.log.warn('Registry is empty. Add servers first.');
            return 'done';
        }

        // Step 1: Select server to edit
        const serverOptions = servers.map(s => ({
            value: s.name,
            label: s.name,
            hint: s.transport === 'stdio' ? s.command : s.url,
        }));

        serverOptions.push({
            value: '__back__',
            label: 'Back to menu',
            hint: undefined,
        });

        const selectedServer = await p.select({
            message: 'Select server to edit:',
            options: serverOptions,
        });

        if (p.isCancel(selectedServer) || selectedServer === '__back__') {
            return 'back';
        }

        const server = servers.find(s => s.name === selectedServer);
        if (!server) continue;

        // Step 2: Show edit menu for this server
        const result = await editServerMenu(server);
        if (result === 'deleted') {
            // Server was deleted, continue loop
            continue;
        }
        // Otherwise continue editing or go back
    }
}

/**
 * Edit menu for a single server
 */
async function editServerMenu(server: RegistryServer): Promise<'back' | 'deleted'> {
    while (true) {
        // Show current config
        p.log.info(`Editing: ${pc.cyan(server.name)}`);

        if (server.transport === 'stdio') {
            p.log.message(`  Command: ${server.command}`);
            if (server.args?.length) {
                p.log.message(`  Args: ${server.args.join(' ')}`);
            }
            if (server.env && Object.keys(server.env).length) {
                p.log.message(`  Env: ${Object.keys(server.env).join(', ')}`);
            }
        } else {
            p.log.message(`  URL: ${server.url}`);
            p.log.message(`  Transport: ${server.transport}`);
        }

        const action = await p.select({
            message: 'What to edit?',
            options: [
                { value: 'name', label: 'Rename server' },
                ...(server.transport === 'stdio' ? [
                    { value: 'command', label: 'Edit command' },
                    { value: 'args', label: 'Edit args' },
                    { value: 'env', label: 'Edit environment variables' },
                ] : [
                    { value: 'url', label: 'Edit URL' },
                ]),
                { value: 'delete', label: pc.red('Delete server') },
                { value: 'back', label: 'Back' },
            ],
        });

        if (p.isCancel(action) || action === 'back') {
            return 'back';
        }

        if (action === 'delete') {
            const confirm = await p.confirm({
                message: pc.red(`Delete "${server.name}"?`),
                initialValue: false,
            });

            if (p.isCancel(confirm) || !confirm) {
                continue;
            }

            // Remove from registry
            const registry = loadRegistry();
            delete registry.servers[server.name];
            saveRegistry(registry);
            p.log.success(`Deleted ${server.name}`);
            return 'deleted';
        }

        // Handle edits
        const registry = loadRegistry();
        const serverRef = registry.servers[server.name];

        if (!serverRef) {
            p.log.error('Server not found');
            return 'back';
        }

        switch (action) {
            case 'name': {
                const newName = await p.text({
                    message: 'New name:',
                    defaultValue: server.name,
                    validate: (val) => {
                        if (!val?.trim()) return 'Name required';
                        if (val !== server.name && registry.servers[val]) {
                            return 'Name already exists';
                        }
                        return undefined;
                    },
                });

                if (p.isCancel(newName)) continue;

                if (newName !== server.name) {
                    delete registry.servers[server.name];
                    serverRef.name = newName;
                    registry.servers[newName] = serverRef;
                    server.name = newName;
                    saveRegistry(registry);
                    p.log.success(`Renamed to ${newName}`);
                }
                break;
            }

            case 'command': {
                if (serverRef.transport !== 'stdio') break;
                const newCmd = await p.text({
                    message: 'Command:',
                    defaultValue: serverRef.command,
                    validate: (val) => val?.trim() ? undefined : 'Command required',
                });

                if (p.isCancel(newCmd)) continue;

                serverRef.command = newCmd;
                saveRegistry(registry);
                server.command = newCmd;
                p.log.success('Command updated');
                break;
            }

            case 'args': {
                if (serverRef.transport !== 'stdio') break;
                const currentArgs = serverRef.args?.join(' ') || '';
                const newArgs = await p.text({
                    message: 'Args (space-separated):',
                    defaultValue: currentArgs,
                });

                if (p.isCancel(newArgs)) continue;

                serverRef.args = newArgs.trim() ? newArgs.trim().split(/\s+/) : undefined;
                saveRegistry(registry);
                server.args = serverRef.args;
                p.log.success('Args updated');
                break;
            }

            case 'env': {
                if (serverRef.transport !== 'stdio') break;
                await editEnvVars(serverRef as RegistryServer & { transport: 'stdio' });
                saveRegistry(registry);
                break;
            }

            case 'url': {
                if (serverRef.transport === 'stdio') break;
                const newUrl = await p.text({
                    message: 'URL:',
                    defaultValue: serverRef.url,
                    validate: (val) => val?.trim() ? undefined : 'URL required',
                });

                if (p.isCancel(newUrl)) continue;

                serverRef.url = newUrl;
                saveRegistry(registry);
                server.url = newUrl;
                p.log.success('URL updated');
                break;
            }
        }
    }
}

/**
 * Edit environment variables submenu
 */
async function editEnvVars(server: RegistryServer & { transport: 'stdio' }): Promise<void> {
    while (true) {
        const env = server.env || {};
        const keys = Object.keys(env);

        const options = [
            { value: '__add__', label: 'Add new variable' },
            ...keys.map(k => ({
                value: k,
                label: k,
                hint: env[k].startsWith('keychain:') ? '(keychain)' : undefined,
            })),
            { value: '__back__', label: 'Back' },
        ];

        const selected = await p.select({
            message: 'Environment variables:',
            options,
        });

        if (p.isCancel(selected) || selected === '__back__') {
            return;
        }

        if (selected === '__add__') {
            const key = await p.text({
                message: 'Variable name:',
                validate: (val) => val?.trim() ? undefined : 'Name required',
            });

            if (p.isCancel(key)) continue;

            const value = await p.text({
                message: `Value for ${key}:`,
            });

            if (p.isCancel(value)) continue;

            if (!server.env) server.env = {};
            server.env[key] = value;
            p.log.success(`Added ${key}`);
        } else {
            // Edit existing
            const action = await p.select({
                message: `${selected}:`,
                options: [
                    { value: 'edit', label: 'Edit value' },
                    { value: 'delete', label: pc.red('Delete') },
                    { value: 'back', label: 'Back' },
                ],
            });

            if (p.isCancel(action) || action === 'back') continue;

            if (action === 'delete') {
                delete env[selected];
                server.env = Object.keys(env).length ? env : undefined;
                p.log.success(`Deleted ${selected}`);
            } else {
                const newValue = await p.text({
                    message: `New value for ${selected}:`,
                    defaultValue: env[selected],
                });

                if (p.isCancel(newValue)) continue;

                env[selected] = newValue;
                p.log.success(`Updated ${selected}`);
            }
        }
    }
}
