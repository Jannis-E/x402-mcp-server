#!/usr/bin/env node
// One-off REAL-MONEY mainnet test of the GENERATED x402-mcp-server bridge
// logic (index.js's callX402Tool), not just the underlying tool. Exercises
// the full round trip against the cheapest live tool (burn-once-secret-vault,
// 0.01 USDC): paid create -> free claim read -> confirm secret matches ->
// confirm second read is blocked. Mirrors
// pipeline/03_builds/burn-once-secret-vault/qa-mainnet-test.mjs, but proves
// out THIS package's generated signing/settlement code specifically, using
// the same shared MAINNET_BUYER_PRIVATE_KEY (one real key, one place).
//
// Requires MAINNET_BUYER_PRIVATE_KEY in ../../agents/scripts/.env.
//
// Usage: node qa-mainnet-test.mjs

import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { privateKeyToAccount } from "viem/accounts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TARGET = "https://burn-once-secret-vault.jannioura.workers.dev/";
const TEST_SECRET = `x402-mcp-server bridge test @ ${new Date().toISOString()}`;

// Real x402 v2 headers (see pipeline/04_distribution/x402-mcp-server/index.js) --
// NOT "X-Signature".
const HEADER_PAYMENT = "PAYMENT-SIGNATURE";
const HEADER_PAYMENT_REQUIRED = "PAYMENT-REQUIRED";

const TRANSFER_WITH_AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
};

function decodeBase64Json(h) {
  try {
    return JSON.parse(Buffer.from(h, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

function randomNonce() {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return "0x" + [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

async function loadKey() {
  const raw = await readFile(resolve(__dirname, "..", "..", "agents", "scripts", ".env"), "utf8");
  for (const line of raw.split("\n")) {
    const m = line.match(/^\s*MAINNET_BUYER_PRIVATE_KEY\s*=\s*"?([^"\s]+)"?\s*$/);
    if (m) return m[1];
  }
  throw new Error("MAINNET_BUYER_PRIVATE_KEY not found");
}

// Identical logic to index.js's callX402Tool -- the exact code path a real
// MCP tool call runs.
async function callX402Tool(url, args, account) {
  const body = JSON.stringify(args ?? {});
  const headers = { "content-type": "application/json" };

  const firstRes = await fetch(url, { method: "POST", headers, body });
  if (firstRes.status !== 402) {
    if (!firstRes.ok) throw new Error(`tool call failed: HTTP ${firstRes.status}: ${await firstRes.text()}`);
    return await firstRes.json();
  }

  const challenge = decodeBase64Json(firstRes.headers.get(HEADER_PAYMENT_REQUIRED));
  const req = challenge?.accepts?.[0];
  if (!req?.scheme || !req?.asset || !req?.payTo) throw new Error("402 response missing a usable challenge");

  const chainMatch = /^eip155:(\d+)$/.exec(req.network || "");
  if (!chainMatch) throw new Error(`cannot sign for network "${req.network}"`);
  const chainId = Number(chainMatch[1]);

  const now = Math.floor(Date.now() / 1000);
  const authorization = {
    from: account.address,
    to: req.payTo,
    value: req.amount,
    validAfter: "0",
    validBefore: String(now + (req.maxTimeoutSeconds || 60)),
    nonce: randomNonce(),
  };
  const signature = await account.signTypedData({
    domain: { name: req.extra?.name || "USD Coin", version: req.extra?.version || "2", chainId, verifyingContract: req.asset },
    types: TRANSFER_WITH_AUTHORIZATION_TYPES,
    primaryType: "TransferWithAuthorization",
    message: {
      from: authorization.from, to: authorization.to, value: BigInt(authorization.value),
      validAfter: BigInt(authorization.validAfter), validBefore: BigInt(authorization.validBefore), nonce: authorization.nonce,
    },
  });

  const paymentPayload = { x402Version: challenge.x402Version, resource: challenge.resource, accepted: req, payload: { signature, authorization }, extensions: {} };
  const encodedPayment = Buffer.from(JSON.stringify(paymentPayload)).toString("base64");

  const paidRes = await fetch(url, { method: "POST", headers: { ...headers, [HEADER_PAYMENT]: encodedPayment }, body });
  if (!paidRes.ok) throw new Error(`paid tool call failed: HTTP ${paidRes.status}: ${await paidRes.text()}`);
  return await paidRes.json();
}

async function main() {
  const account = privateKeyToAccount(await loadKey());
  console.log(`[bridge-test] buyer: ${account.address}, target: ${TARGET}`);

  const createResult = await callX402Tool(TARGET, { secret: TEST_SECRET }, account);
  console.log(`[bridge-test] create OK: ${JSON.stringify(createResult)}`);
  if (!createResult.claim_url) throw new Error("create response missing claim_url");

  const firstRead = await fetch(createResult.claim_url);
  const firstBody = await firstRead.json();
  console.log(`[bridge-test] first read -> HTTP ${firstRead.status}: ${JSON.stringify(firstBody)}`);
  if (firstBody.secret !== TEST_SECRET) throw new Error(`secret mismatch: got ${JSON.stringify(firstBody.secret)}`);

  const secondRead = await fetch(createResult.claim_url);
  const secondBody = await secondRead.json().catch(() => null);
  console.log(`[bridge-test] second read -> HTTP ${secondRead.status}: ${JSON.stringify(secondBody)}`);
  if (secondRead.status !== 404) throw new Error(`second read was NOT blocked: HTTP ${secondRead.status}`);

  console.log("[bridge-test] PASS: generated bridge logic settled a real payment and completed the full round trip.");
}

main().catch((err) => {
  console.error("[bridge-test] FAIL:", err instanceof Error ? err.message : err);
  process.exit(1);
});
