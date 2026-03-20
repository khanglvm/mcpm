# @khanglvm/mcpm

MCP Manager — Centralized MCP server configuration for AI coding agents.

## Features

- Auto-detects AI coding agents
- Paste JSON/YAML/TOML MCP configs from READMEs
- Install from **GitHub, GitLab, Bitbucket, Codeberg**
- Keychain storage for secrets
- Sync registry to multiple agents at once
- Import existing servers from your agents

## Core Concepts

| Term | Description |
|------|-------------|
| **Registry** | Central store for all MCP server configs (`~/.mcpm/registry.json`) |
| **Agents** | AI coding tools (Claude Code, Cursor, Windsurf, etc.) that use MCP servers |
| **Sync** | Push configs from registry → agent config files |
| **Import** | Pull existing configs from agent config files → registry |

---

## For MCP Users

Manage MCP server configurations across your AI coding agents.

### Quick Start

```bash
# Interactive mode (recommended)
npx @khanglvm/mcpm

# Or paste configuration
npx @khanglvm/mcpm --paste
```

### CLI Commands

```bash
npx @khanglvm/mcpm                   # Interactive menu
npx @khanglvm/mcpm --paste           # Paste JSON/YAML/TOML configuration
npx @khanglvm/mcpm --build           # Build configuration step-by-step
npx @khanglvm/mcpm list              # List saved servers from registry
npx @khanglvm/mcpm add               # Add server interactively
npx @khanglvm/mcpm add <git-url>     # Add from Git URL
npx @khanglvm/mcpm sync              # Sync MCP servers from registry to agents
npx @khanglvm/mcpm import            # Import MCP configs from agents to registry
npx @khanglvm/mcpm status            # Check sync status
npx @khanglvm/mcpm remove <name>     # Remove MCP server
```

---

## For MCP Developers

Help users install your MCP server with zero friction. Share one-liner install commands.

### Option 1: Add `mcp.json` to Your Repository

Create `mcp.json` at your repository root. Users install with:
```bash
npx @khanglvm/mcpm https://github.com/you/my-server
```

**Simple format** — prompts user for all null values:
```jsonc
// mcp.json
{
  "mcpServers": {
    "my-server": {
      "command": "npx",
      "args": ["-y", "@scope/my-server"],
      "env": {
        "API_KEY": null,           // → prompts user (masked, stored in keychain)
        "API_URL": null            // → prompts user
      }
    }
  }
}
```

**Extended format** — with descriptions, help links, and validation:
```jsonc
// mcp.json
{
  "mcpServers": {
    "my-server": {
      "command": "npx",
      "args": ["-y", "@scope/my-server"],
      "env": {
        "API_KEY": {
          "value": null,
          "description": "Your API key from the dashboard",
          "note": "Get your API key at https://example.com/api-keys",
          "required": true,
          "hidden": true
        },
        "API_URL": {
          "value": "https://api.example.com",
          "description": "API endpoint (optional)",
          "required": false
        }
      }
    }
  }
}
```

| Property | Type | Description |
|----------|------|-------------|
| `value` | `string \| null` | Default value, or `null` to prompt user |
| `description` | `string` | Hint displayed during setup |
| `note` | `string` | Developer note shown during setup (prefixed with "Note:") |
| `required` | `boolean` | Required field (default: `true`) |
| `hidden` | `boolean` | Mask input (auto-detected for `key`, `secret`, `token`, `password`) |

**HTTP/SSE transport** — for remote MCP servers:
```jsonc
// mcp.json
{
  "mcpServers": {
    "remote-api": {
      "url": "https://mcp.example.com/sse",
      "headers": {
        "Authorization": {
          "value": null,
          "description": "Bearer token from dashboard",
          "note": "Get your token at https://example.com/tokens",
          "hidden": true
        },
        "x-api-version": "2024-01"
      }
    }
  }
}
```

---

### Option 2: Share a One-Liner Install Command

Extend the `mcp.json` config with CLI arguments — perfect for docs, READMEs, or Slack:

```bash
npx @khanglvm/mcpm https://github.com/you/my-server \
  --env:API_KEY=::description="Your API key"::note="Get from https://example.com/api-keys"::hidden \
  --env:API_URL=https://api.example.com::optional \
  --note:"Get API key at https://example.com/settings"
```

| Modifier | Description |
|----------|-------------|
| `--env:KEY=VALUE` | Pre-fill env var (overrides `mcp.json`) |
| `--header:KEY=VALUE` | Pre-fill header (for HTTP/SSE servers) |
| `--agent:<name>` | Pre-select agent(s) for installation |
| `--scope:global` / `--scope:project` | Pre-select installation scope (default: global) |
| `-y` / `--yes` | Automated install (validate, show tools, install to all agents) |
| `::description="..."` | Show hint during setup |
| `::note="..."` | Per-variable developer note (prefixed with "Note:") |
| `::hidden` | Mask input field |
| `::optional` | Allow empty value |
| `--note:"..."` | Display message to user |

> **Auto mode (`-y`)**: Automatically validates MCP servers and installs to all compatible agents without prompts. Falls back to interactive mode if required credentials are missing.

> All modifiers are optional. `--env` applies to stdio servers, `--header` applies to HTTP/SSE servers. `--agent` can be repeated (e.g., `--agent:cursor --agent:claude-code`).

---

### Option 3: Share Inline Config (No Repository Needed)

Share a one-liner with embedded config — no `mcp.json` or repo required:

**Simple (prompts for credentials):**
```bash
npx @khanglvm/mcpm '{"github":{"command":"npx","args":["-y","@modelcontextprotocol/server-github"],"env":{"GITHUB_TOKEN":null}}}'
```

**With helper text:**
```bash
npx @khanglvm/mcpm '{"github":{"command":"npx","args":["-y","@modelcontextprotocol/server-github"],"env":{"GITHUB_TOKEN":{"value":null,"description":"Personal Access Token","note":"Create at https://github.com/settings/tokens"}}}}'
```

**Auto-install (no prompts):**
```bash
npx @khanglvm/mcpm '{"fetch":{"command":"uvx","args":["mcp-server-fetch"]}}' -y
```

**From raw URL:**
```bash
npx @khanglvm/mcpm https://raw.githubusercontent.com/you/repo/main/mcp.json
```

---

### What Users See → Final Config

When a user runs either method:

1. **Prompts** for missing values (with descriptions/hints)
2. **Masks** sensitive fields (`API_KEY`)
3. **Offers keychain** storage for secrets
4. **Saves** to their AI agent's config:

```json
{
  "mcpServers": {
    "my-server": {
      "command": "npx",
      "args": ["-y", "@scope/my-server"],
      "env": {
        "API_KEY": "sk-abc123...",
        "API_URL": "https://api.example.com"
      }
    }
  }
}
```

## Registry

All servers are stored in `~/.mcpm/registry.json` and can be synced to any agent.

| Location | Purpose |
|----------|---------|
| `~/.mcpm/registry.json` | Central server store |
| `~/.mcpm/backups/` | Automatic backups |

## Supported Agents

| Agent | Transport | Format |
|-------|-----------|--------|
| Amazon Q Developer | stdio | JSON |
| Amp | stdio | JSON |
| Antigravity | stdio, http, sse | JSON |
| Claude Code | stdio, http, sse | JSON |
| Claude Desktop | stdio | JSON |
| Cline | stdio, http, sse | JSON |
| Codex (CLI / Desktop) | stdio | TOML |
| Continue | stdio, http | YAML |
| Cursor | stdio, http, sse | JSON |
| Factory Droid | stdio, http | JSON |
| Gemini CLI | stdio, http, sse | JSON |
| GitHub Copilot CLI | stdio, http | JSON |
| Goose | stdio, http | YAML |
| GitHub Copilot for JetBrains IDE | stdio, http | JSON |
| JetBrains AI Assistant | stdio | XML |
| OpenCode | stdio, http | YAML |
| Roo Code | stdio, http, sse | JSON |
| Sourcegraph Cody | stdio | JSON |
| VS Code + Copilot | stdio, http | JSON |
| Windsurf | stdio, http, sse | JSON |
| Zed | stdio | JSON |

## Changelog

**v1.1.2**
- `fix`: Sanitize server names containing spaces or special characters to valid identifiers (e.g., "Framelink MCP for Figma" → "Framelink_MCP_for_Figma").

**v1.1.1**
- `fix`: Support auto install flags (`-a`, `-y`) in inline config mode.
- `docs`: Add specific instruction to verify package name in README.

**v1.1.0**
- `feat`: Support `--agent:all` and `-a` flags for automated installation to all compatible agents.
- `feat`: Intelligent agent filtering based on transport (stdio/http/sse) and installation scope.

**v1.0.2**
- `feat`: Schema preservation in registry for credential reconfiguration.
- `feat`: "Reconfigure" option in sync flow to re-enter credentials from saved schema.
- `refactor`: Simplified credential prompt messages and note display.

**v1.0.1**
- `feat`: Direct JSON/YAML/TOML config data input support (paste config as CLI argument).
- `feat`: TOML format parsing for input configurations and README extraction.
- `feat`: Raw config URL support (fetch config directly from URLs like raw.githubusercontent.com).
- `fix`: Extended env schema now falls back to auto-detection for hidden field when not explicitly set.

**v1.0.0**
- `feat`: Format-aware centralized injector with native JSON, YAML, and TOML support.
- `feat`: Automatic OS keychain secret resolution during config injection.
- `feat`: Pre-install MCP server validation with available tools preview.
- `feat`: Consistent `mcpm_` prefix enforcement across all agent configurations.
- `feat`: `--agent:` CLI argument for pre-selecting target agents.
- `feat`: `-y` / `--yes` auto-install mode with concise error summaries.
- `refactor`: Unified credential handling for stdio (env) and HTTP/SSE (headers) transports.

**v0.1.7**
- `feat`: Auto-inject `-y` flag for `npx`/`pnpx` commands during validation to prevent interactive prompts.
- `test`: Add unit tests for auto-execute flag injection.

**v0.1.6**
- `feat`: Add extended CLI arguments support (`--env:KEY=VALUE`, `::hidden`, `::optional`) for one-liner installations.
- `docs`: Comprehensive documentation updates for one-liner install commands.

**v0.1.5**
- `feat`: Add JetBrains AI Assistant support.
- `style`: Improve installation output formatting with grouped success messages.

**v0.1.4**
- `feat`: Add confirmation/edit step before installation.
- `feat`: Per-agent dynamic filtering for remote vs local transport.
- `feat`: Improved environment variable preview with smart masking.

**v0.1.3**
- `fix`: Ensure servers are saved to registry before agent injection.
- `chore`: Rename package to `@khanglvm/mcpm`.

**v0.1.2**
- `feat`: UX improvements (main menu loop, multiline paste).
- `feat`: Smart secret detection for environment variables.

**v0.1.1**
- `feat`: Initial release of `mcpget` (now `mcpm`).

## License

MIT
