import Anthropic from '@anthropic-ai/sdk'
import { prisma } from './prisma'

export const client = new Anthropic({ timeout: 180000 })

const MODEL_PRICES: Record<string, { input: number; output: number }> = {
  'claude-sonnet-4-5-20250929': { input: 3, output: 15 },
  'claude-sonnet-4-5': { input: 3, output: 15 },
  'claude-haiku-4-5-20251001': { input: 0.8, output: 4 },
  'claude-haiku-4-5': { input: 0.8, output: 4 },
  'claude-opus-4-7': { input: 15, output: 75 },
  'claude-opus-4-5': { input: 15, output: 75 },
}

const DEFAULT_PRICE = { input: 3, output: 15 }

function priceFor(model: string) {
  return MODEL_PRICES[model] ?? DEFAULT_PRICE
}

function computeCost(
  model: string,
  inputTokens: number,
  cacheWriteTokens: number,
  cacheReadTokens: number,
  outputTokens: number,
): number {
  const p = priceFor(model)
  return (
    (inputTokens * p.input +
      cacheWriteTokens * p.input * 1.25 +
      cacheReadTokens * p.input * 0.1 +
      outputTokens * p.output) /
    1_000_000
  )
}

type CreateMessageParams = Anthropic.Messages.MessageCreateParamsNonStreaming & {
  companyId: string
  action: string
}

export async function createMessage(
  params: CreateMessageParams,
): Promise<Anthropic.Messages.Message> {
  const { companyId, action, ...messageParams } = params
  const response = await client.messages.create(messageParams)

  const usage = response.usage
  const inputTokens = usage.input_tokens ?? 0
  const outputTokens = usage.output_tokens ?? 0
  const cacheWriteTokens = usage.cache_creation_input_tokens ?? 0
  const cacheReadTokens = usage.cache_read_input_tokens ?? 0
  const costUsd = computeCost(
    messageParams.model,
    inputTokens,
    cacheWriteTokens,
    cacheReadTokens,
    outputTokens,
  )

  prisma.usageLog
    .create({
      data: {
        companyId,
        action,
        model: messageParams.model,
        inputTokens,
        cacheWriteTokens,
        cacheReadTokens,
        outputTokens,
        costUsd,
      },
    })
    .catch((err) => {
      console.error('[usage-log] persist failed:', err)
    })

  return response
}
