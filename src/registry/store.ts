/**
 * Registry CRUD operations
 * Manages ~/.mcpm/registry.json
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import type { Registry, RegistryServer, TransportType } from './types.js';

/** Registry directory */
export const MCPM_DIR = join(homedir(), '.mcpm');

/** Registry file path */
export const REGISTRY_PATH = join(MCPM_DIR, 'registry.json');

/** Backups directory */
export const BACKUPS_DIR = join(MCPM_DIR, 'backups');

/**
 * Ensure mcpm directory exists
 */
export function ensureMcpmDir(): void {
    if (!existsSync(MCPM_DIR)) {
        mkdirSync(MCPM_DIR, { recursive: true });
    }
    if (!existsSync(BACKUPS_DIR)) {
        mkdirSync(BACKUPS_DIR, { recursive: true });
    }
}

/**
 * Load registry from disk
 * Creates empty registry if not exists
 */
export function loadRegistry(): Registry {
    ensureMcpmDir();

    if (!existsSync(REGISTRY_PATH)) {
        const empty: Registry = {
            version: '1.0',
            servers: {},
        };
        saveRegistry(empty);
        return empty;
    }

    try {
        const content = readFileSync(REGISTRY_PATH, 'utf-8');
        return JSON.parse(content) as Registry;
    } catch {
        // If parse fails, return empty
        const empty: Registry = {
            version: '1.0',
            servers: {},
        };
        return empty;
    }
}

/**
 * Save registry to disk
 */
export function saveRegistry(registry: Registry): void {
    ensureMcpmDir();

    registry.meta = {
        ...registry.meta,
        lastModified: new Date().toISOString(),
    };

    writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2) + '\n');
}

/**
 * Backup registry before changes
 */
export function backupRegistry(): void {
    if (!existsSync(REGISTRY_PATH)) return;

    ensureMcpmDir();

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = join(BACKUPS_DIR, `registry-${timestamp}.json`);

    const content = readFileSync(REGISTRY_PATH, 'utf-8');
    writeFileSync(backupPath, content);
}

/**
 * Add or update a server in the registry
 */
export function addServer(server: RegistryServer): void {
    const registry = loadRegistry();

    registry.servers[server.name] = {
        ...server,
        createdAt: registry.servers[server.name]?.createdAt || new Date().toISOString(),
    };

    saveRegistry(registry);
}

/**
 * Remove a server from the registry
 */
export function removeServer(name: string): boolean {
    const registry = loadRegistry();

    if (!(name in registry.servers)) {
        return false;
    }

    delete registry.servers[name];
    saveRegistry(registry);
    return true;
}

/**
 * Get a server by name
 */
export function getServer(name: string): RegistryServer | undefined {
    const registry = loadRegistry();
    return registry.servers[name];
}

/**
 * List all servers
 */
export function listServers(): RegistryServer[] {
    const registry = loadRegistry();
    return Object.values(registry.servers);
}

/**
 * Check if server exists
 */
export function serverExists(name: string): boolean {
    const registry = loadRegistry();
    return name in registry.servers;
}

/**
 * Get servers by transport type
 */
export function getServersByTransport(transport: TransportType): RegistryServer[] {
    return listServers().filter(s => s.transport === transport);
}
