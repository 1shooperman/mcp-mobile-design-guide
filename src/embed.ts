import { VoyageAIClient } from 'voyageai';
import { config } from './config';

const BATCH_SIZE = 8;
const RPM_DELAY_MS = 21_000;
const BACKOFF_MS = 65_000;

let _client: VoyageAIClient | null = null;

function getClient(): VoyageAIClient {
  if (!_client) {
    if (!config.voyageApiKey) throw new Error('VOYAGE_API_KEY not set');
    _client = new VoyageAIClient({ apiKey: config.voyageApiKey });
  }
  return _client;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function embed(
  texts: string[],
  inputType: 'document' | 'query' = 'document',
): Promise<number[][]> {
  const client = getClient();
  const all: number[][] = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    let attempts = 0;

    while (true) {
      try {
        const result = await client.embed({
          input: batch,
          model: config.embedModel,
          inputType: inputType as 'document' | 'query',
        });
        all.push(...(result.data?.map((d) => d.embedding ?? []) ?? []));
        break;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.toLowerCase().includes('rate') && attempts < 3) {
          attempts++;
          console.error(`[embed] rate limit, backing off ${BACKOFF_MS / 1000}s…`);
          await sleep(BACKOFF_MS);
        } else {
          throw err;
        }
      }
    }

    if (i + BATCH_SIZE < texts.length) {
      await sleep(RPM_DELAY_MS);
    }
  }

  return all;
}

export async function embedQuery(text: string): Promise<number[]> {
  const results = await embed([text], 'query');
  return results[0];
}
