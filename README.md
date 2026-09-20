# x402-mcp-server

Headless Chromium scraping, DOM-to-markdown extraction, and ephemeral secret vaults on **Base Mainnet** via [x402](https://github.com/coinbase/x402) micro-payments — no API keys, no signup, pay per call in USDC.

This MCP server exposes a small catalog of x402-paywalled HTTP tools as native MCP tools. Every tool call pays for itself automatically: the server POSTs the request, catches the real x402 v2 `402 PAYMENT-REQUIRED` challenge, signs an EIP-3009 `TransferWithAuthorization` with [viem](https://viem.sh) using a local wallet, and resubmits with the `PAYMENT-SIGNATURE` header. No human signature prompt at call time — the agent just calls the tool.

## Tools

| Tool | Cost (USDC) | Description | Key input parameters |
|---|---|---|---|
| `spa-dom-to-md` | 0.03 | Renders JavaScript-heavy SPA pages in real headless Chromium (Cloudflare Browser Rendering), waits for network-idle/selector-ready, strips nav/footer/script chrome, and serializes the fully-rendered DOM into clean, LLM-ready Markdown. | `url` (string, required) |
| `markdown-extractor` | 0.01 | Fetches a public URL and returns clean, token-efficient markdown. For static/server-rendered pages. | `url` (string, required) |
| `burn-once-secret-vault` | 0.01 | Stores a secret (API key, webhook payload, signed URL) encrypted with AES-256-GCM and returns a claim URL that yields the secret exactly once, with an Ed25519-signed burn attestation. The recipient's claim read is free. | `secret` (string, required) |
| `svg-bar-chart-renderer` | 0.015 | Deterministic, paid-per-render SVG bar chart generator. Accepts labeled scalar data and layout options and returns schema-valid, byte-identical SVG for identical input. | `data` (array of `{label, value}`, required), layout options (optional) |

All tools run on Base Mainnet (`eip155:8453`), settled through the [x402.primer.systems](https://x402.primer.systems) facilitator. Exact request-body fields for each tool are also discoverable at runtime via `<tool-url>/openapi.json`.

## Quickstart

Add this to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "x402-mcp-server": {
      "command": "npx",
      "args": ["-y", "x402-mcp-server_by_milza"],
      "env": {
        "BASE_PRIVATE_KEY": "0xyour_base_mainnet_private_key"
      }
    }
  }
}
```

> **⚠️ Funding warning:** `BASE_PRIVATE_KEY` must be a **Base Mainnet** wallet private key funded with a small amount of **real USDC** (e.g. $0.50 is enough for dozens of calls at these prices). Every tool call spends real money from this wallet. Do not use a key that holds funds you're not prepared to spend through this server, and never commit this key to source control.

Once configured, restart Claude Desktop and the four tools above become available to the assistant automatically — no further setup, no dashboard, no API key registration.

## How payment works

`BASE_PRIVATE_KEY` is **your own** wallet — whoever installs this server sets their own key and pays for their own calls. Each call settles straight to the tool provider's wallet; your key never touches anyone else's funds and no one else's key ever touches yours. To set it up:

1. Use (or create) a Base Mainnet EVM wallet you're OK spending small amounts from.
2. Fund it with a bit of USDC on Base (e.g. $0.50).
3. Export its private key and set it as `BASE_PRIVATE_KEY` in your MCP client config, as shown above.

## Security

- `BASE_PRIVATE_KEY` never leaves your machine. It is read once from the local environment and used **only** to sign EIP-712 typed-data (EIP-3009 `TransferWithAuthorization`) payment authorizations locally with `viem`.
- No raw private key, seed phrase, or signature is ever sent over the network — only the resulting signed authorization, exactly as the x402 protocol requires to settle payment for the specific request being made.
- Payment terms (recipient, amount, network, asset contract, expiry) are read fresh from each live `402` challenge returned by the resource server, never trusted from a local cache, so a stale or tampered local catalog can't redirect funds.
- This package does not phone home, collect telemetry, or store your key anywhere on disk.

## Requirements

- Node.js 18+
- A Base Mainnet EVM wallet, funded with a small amount of USDC, whose private key you control

## License

MIT
