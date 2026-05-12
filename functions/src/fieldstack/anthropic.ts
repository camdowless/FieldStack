/**
 * Anthropic Claude API wrapper with usage logging.
 * Every Claude call is logged to companies/{companyId}/usageLogs for cost tracking.
 */

import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { logger } from "../logger";

const db = admin.firestore();

// Cost per million tokens (USD) — update as Anthropic pricing changes
const MODEL_PRICES: Record<string, { input: number; output: number }> = {
  "claude-sonnet-4-5-20250929": { input: 3, output: 15 },
  "claude-sonnet-4-5": { input: 3, output: 15 },
  "claude-haiku-4-5-20251001": { input: 0.8, output: 4 },
  "claude-haiku-4-5": { input: 0.8, output: 4 },
  "claude-opus-4-7": { input: 15, output: 75 },
  "claude-opus-4-5": { input: 15, output: 75 },
};

const DEFAULT_PRICE = { input: 3, output: 15 };

function computeCost(
  model: string,
  inputTokens: number,
  cacheWriteTokens: number,
  cacheReadTokens: number,
  outputTokens: number
): number {
  const p = MODEL_PRICES[model] ?? DEFAULT_PRICE;
  return (
    (inputTokens * p.input +
      cacheWriteTokens * p.input * 1.25 +
      cacheReadTokens * p.input * 0.1 +
      outputTokens * p.output) /
    1_000_000
  );
}

export interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | object[];
}

export interface CreateMessageParams {
  companyId: string;
  action: string;
  model: string;
  max_tokens: number;
  system?: string;
  messages: AnthropicMessage[];
  tools?: object[];
}

export interface AnthropicResponse {
  id: string;
  type: string;
  role: string;
  content: Array<{ type: string; text?: string; id?: string; name?: string; input?: object }>;
  model: string;
  stop_reason: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

/**
 * Call Claude API and log usage to Firestore.
 */
export async function createMessage(params: CreateMessageParams): Promise<AnthropicResponse> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not configured");
  }

  const { companyId, action, ...messageParams } = params;

  const body: Record<string, unknown> = {
    model: messageParams.model,
    max_tokens: messageParams.max_tokens,
    messages: messageParams.messages,
  };
  if (messageParams.system) body.system = messageParams.system;
  if (messageParams.tools) body.tools = messageParams.tools;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "prompt-caching-2024-07-31",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${err}`);
  }

  const data = (await response.json()) as AnthropicResponse;

  // Log usage asynchronously — don't block the response
  const usage = data.usage;
  const inputTokens = usage.input_tokens ?? 0;
  const outputTokens = usage.output_tokens ?? 0;
  const cacheWriteTokens = usage.cache_creation_input_tokens ?? 0;
  const cacheReadTokens = usage.cache_read_input_tokens ?? 0;
  const costUsd = computeCost(messageParams.model, inputTokens, cacheWriteTokens, cacheReadTokens, outputTokens);

  const logRef = db.collection(`companies/${companyId}/usageLogs`).doc();
  logRef
    .set({
      id: logRef.id,
      companyId,
      action,
      model: messageParams.model,
      inputTokens,
      cacheWriteTokens,
      cacheReadTokens,
      outputTokens,
      costUsd,
      createdAt: FieldValue.serverTimestamp(),
    })
    .catch((err) => logger.error("usage log persist failed", { error: String(err) }));

  return data;
}
