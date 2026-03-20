/**
 * Server naming utilities
 * Handles mcpm prefix for installed servers
 */

import type { AgentType } from '../types.js';

/** Prefix for mcpm-managed servers in snake_case agents */
export const MCPM_PREFIX_SNAKE = 'mcpm_';

/** Prefix for mcpm-managed servers in camelCase agents */
export const MCPM_PREFIX_CAMEL = 'mcpm';

/**
 * Agents that use camelCase for server names
 */
const CAMEL_CASE_AGENTS: Set<AgentType> = new Set([
    // Most agents use snake_case, but some newer ones use camelCase
    // This can be expanded as needed based on research
]);

/**
 * Check if agent uses camelCase naming
 */
export function usesCamelCase(agent: AgentType): boolean {
    return CAMEL_CASE_AGENTS.has(agent);
}

/**
 * Sanitize a server name to match the pattern ^[a-zA-Z0-9_-]+$
 * - Replaces spaces and invalid characters with underscores
 * - Removes consecutive underscores
 * - Removes leading/trailing underscores
 * 
 * Examples:
 * - "Framelink MCP for Figma" -> "Framelink_MCP_for_Figma"
 * - "my-server" -> "my-server"
 * - "server@v2!" -> "server_v2"
 */
export function sanitizeName(name: string): string {
    return name
        // Replace any character that's not alphanumeric, underscore, or hyphen with underscore
        .replace(/[^a-zA-Z0-9_-]/g, '_')
        // Replace consecutive underscores with single underscore
        .replace(/_+/g, '_')
        // Remove leading/trailing underscores
        .replace(/^_+|_+$/g, '');
}

/**
 * Add mcpm prefix to a server name for a specific agent
 */
export function addPrefix(name: string, agent: AgentType): string {
    const sanitized = sanitizeName(name);
    if (usesCamelCase(agent)) {
        // camelCase: mcpmGithub
        return MCPM_PREFIX_CAMEL + sanitized.charAt(0).toUpperCase() + sanitized.slice(1);
    }
    // snake_case: mcpm_github
    return MCPM_PREFIX_SNAKE + sanitized;
}

/**
 * Remove mcpm prefix from a server name
 */
export function removePrefix(prefixedName: string): string {
    if (prefixedName.startsWith(MCPM_PREFIX_SNAKE)) {
        return prefixedName.slice(MCPM_PREFIX_SNAKE.length);
    }
    if (prefixedName.startsWith(MCPM_PREFIX_CAMEL)) {
        const rest = prefixedName.slice(MCPM_PREFIX_CAMEL.length);
        // Convert first char back to lowercase
        return rest.charAt(0).toLowerCase() + rest.slice(1);
    }
    return prefixedName;
}

/**
 * Check if a server name has mcpm prefix
 */
export function hasPrefix(name: string): boolean {
    return name.startsWith(MCPM_PREFIX_SNAKE) || name.startsWith(MCPM_PREFIX_CAMEL);
}

/**
 * Get the clean registry name from an installed server name
 */
export function toRegistryName(installedName: string): string {
    return hasPrefix(installedName) ? removePrefix(installedName) : installedName;
}

/**
 * Get the installed name from a registry name for a specific agent
 */
export function toInstalledName(registryName: string, agent: AgentType): string {
    return addPrefix(registryName, agent);
}
