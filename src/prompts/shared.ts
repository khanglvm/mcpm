/**
 * Shared prompt utilities
 */

import * as p from '@clack/prompts';

/**
 * Pluralize a word based on count
 * @example plural(1, 'server') => '1 server'
 * @example plural(2, 'server') => '2 servers'
 */
export function plural(count: number, word: string, pluralWord?: string): string {
    const form = count === 1 ? word : (pluralWord || `${word}s`);
    return `${count} ${form}`;
}
interface SelectItem {
    value: string;
    label: string;
    hint?: string;
}

/**
 * Multi-select with instructions for toggle all.
 * 
 * Built-in keyboard shortcuts (from @clack/core):
 * - Press 'a' to toggle all items
 * - Press 'i' to invert selection
 * - Space to toggle current item
 * - Enter to submit
 */
export async function multiselectWithAll(opts: {
    message: string;
    items: SelectItem[];
    required?: boolean;
}): Promise<string[] | null> {
    const { message, items, required = true } = opts;

    if (items.length === 0) {
        return [];
    }

    // Show hint about keyboard shortcuts (available in @clack/core 1.0.0+)
    const messageWithHint = `${message} (press 'space' to toggle, 'a' to select all)`;

    const selected = await p.multiselect({
        message: messageWithHint,
        options: items,
        required,
    });

    if (p.isCancel(selected)) {
        return null;
    }

    return selected as string[];
}
