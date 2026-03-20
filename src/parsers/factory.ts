/**
 * Parser factory - creates the right parser for each agent
 */

import type { AgentType } from '../types.js';
import type { AgentParser } from './types.js';
import { getAgentConfig } from '../agents.js';
import { createJsonParser } from './json.js';
import { createYamlParser } from './yaml.js';
import { createTomlParser } from './toml.js';
import { createXmlParser } from './xml.js';

/**
 * Create a parser for a specific agent
 */
export function createParser(agentType: AgentType): AgentParser {
    const agentConfig = getAgentConfig(agentType);

    switch (agentConfig.configFormat) {
        case 'yaml':
            return createYamlParser(agentType);
        case 'toml':
            return createTomlParser(agentType);
        case 'xml':
            return createXmlParser(agentType);
        default:
            return createJsonParser(agentType);
    }
}

/**
 * Create parsers for multiple agents
 */
export function createParsers(agentTypes: AgentType[]): Map<AgentType, AgentParser> {
    const parsers = new Map<AgentType, AgentParser>();

    for (const agentType of agentTypes) {
        parsers.set(agentType, createParser(agentType));
    }

    return parsers;
}

/**
 * Get all parsers for installed agents
 */
export async function getInstalledParsers(): Promise<AgentParser[]> {
    const { detectInstalledAgents } = await import('../agents.js');
    const installed = detectInstalledAgents();
    return installed.map(agent => createParser(agent));
}
