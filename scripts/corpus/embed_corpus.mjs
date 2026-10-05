import { GoogleGenAI } from '@google/genai';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SECRET_KEY;
const geminiKey = process.env.GEMINI_API_KEY;

if (!supabaseUrl || !supabaseKey || !geminiKey) {
  throw new Error('SUPABASE_URL, SUPABASE_SECRET_KEY and GEMINI_API_KEY are required.');
}

const sb = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const ai = new GoogleGenAI({ apiKey: geminiKey });

const bucket = 'photo-corpus';
const model = 'gemini-embedding-2';
const outputDimensionality = 768;

const BATCH_SIZE = 6;
const MAX_GEMINI_RETRIES = 3;
const MAX_DB_RETRIES = 3;
const RETRY_BASE_MS = 2000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function errorText(err) {
  try {
    return JSON.stringify(err);
  } catch {
    return String(err?.message || err || '');
  }
}

function isDailyQuotaError(err) {
  const text = errorText(err).toLowerCase();

  return (
    text.includes('requestsperday') ||
    text.includes('perdayperuserperprojectpermodelfreetier') ||
    (text.includes('quota exceeded') && (
      text.includes('resource_exhausted') ||
      text.includes('429') ||
      text.includes('daily') ||
      text.includes('per day')
    ))
  );
}

class DailyQuotaError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'DailyQuotaError';
    this.cause = cause;
  }
}

async function withDbRetry(operation, label) {
  let lastError;

  for (let attempt = 1; attempt <= MAX_DB_RETRIES; attempt++) {
    try {
      return await operation();
    } catch (err) {
      lastError = err;

      console.error(
        `${label} failed (attempt ${attempt}/${MAX_DB_RETRIES}):`,
        err?.message || err
      );

      if (attempt < MAX_DB_RETRIES) {
        await sleep(RETRY_BASE_MS * attempt);
      }
    }
  }

  throw lastError || new Error(`${label} failed.`);
}

async function validateSchema() {
  console.log('Validating Supabase schema before any Gemini request...');

  const photoEmbeddingsCheck = await sb
    .from('photo_embeddings')
    .select('id,embedding,embedding_model,embedded_at')
    .limit(1);

  if (photoEmbeddingsCheck.error) {
    throw new Error(
      `Schema validation failed for photo_embeddings: ${photoEmbeddingsCheck.error.message}`
    );
  }

  const photoCatalogCheck = await sb
    .from('photo_catalog')
    .select('id,storage_path,embedding_status,embedding_model,embedded_at')
    .limit(1);

  if (photoCatalogCheck.error) {
    throw new Error(
      `Schema validation failed for photo_catalog: ${photoCatalogCheck.error.message}`
    );
  }

  console.log('Supabase schema validation passed.');
}

async function resetInterruptedProcessing() {
  const { error } = await sb
    .from('photo_catalog')
    .update({ embedding_status: 'pending' })
    .eq('embedding_status', 'processing');

  if (error) {
    throw new Error(
      `Could not reset interrupted processing rows: ${error.message}`
    );
  }
}

async function reconcileExistingEmbeddings() {
  const { data, error } = await sb
    .from('photo_embeddings')
    .select('id,embedding_model')
    .eq('embedding_model', model);

  if (error) {
    throw new Error(
      `Could not reconcile existing embeddings: ${error.message}`
    );
  }

  const ids = (data || []).map((row) => row.id);

  if (!ids.length) {
    return;
  }

  console.log(
    `Reconciling ${ids.length} existing ${model} embeddings with photo_catalog...`
  );

  for (let start = 0; start < ids.length; start += 500) {
    const chunk = ids.slice(start, start + 500);

    const { error: updateError } = await sb
      .from('photo_catalog')
      .update({
        embedding_status: 'ready',
        embedding_model: model,
        embedded_at: new Date().toISOString(),
      })
      .in('id', chunk);

    if (updateError) {
      throw new Error(
        `Could not reconcile photo_catalog embeddings: ${updateError.message}`
      );
    }
  }
}

async function embedImages(items) {
  let lastError;

  for (let attempt = 1; attempt <= MAX_GEMINI_RETRIES; attempt++) {
    try {
      const contents = items.map((item) => ({
        parts: [{
          inlineData: {
            mimeType: 'image/jpeg',
            data: item.base64,
          },
        }],
      }));

      const response = await ai.models.embedContent({
        model,
        contents,
        config: { outputDimensionality },
      });

      const embeddings = response.embeddings ?? [];

      if (embeddings.length !== items.length) {
        throw new Error(
          `Expected ${items.length} embeddings but received ${embeddings.length}.`
        );
      }

      return embeddings.map((embedding, index) => {
        const values = embedding?.values;

        if (!values?.length) {
          throw new Error(`No embedding returned for ${items[index].id}.`);
        }

        return values;
      });
    } catch (err) {
      lastError = err;

      if (isDailyQuotaError(err)) {
        throw new DailyQuotaError(
          `Gemini daily embedding quota is exhausted. Stopping instead of retrying for hours. Original error: ${err?.message || err}`,
          err
        );
      }

      console.error(
        `Gemini embedding request failed (attempt ${attempt}/${MAX_GEMINI_RETRIES}):`,
        err?.message || err
      );

      if (attempt < MAX_GEMINI_RETRIES) {
        await sleep(RETRY_BASE_MS * Math.pow(2, attempt - 1));
      }
    }
  }

  throw lastError || new Error('Gemini embedding request failed.');
}

async function downloadRow(row) {
  const { data: file, error } = await sb.storage
    .from(bucket)
    .download(row.storage_path);

  if (error) {
    throw error;
  }

  const bytes = Buffer.from(await file.arrayBuffer());

  return {
    id: row.id,
    storage_path: row.storage_path,
    base64: bytes.toString('base64'),
  };
}

async function resetRowsToPending(ids) {
  if (!ids.length) {
    return;
  }

  const { error } = await sb
    .from('photo_catalog')
    .update({ embedding_status: 'pending' })
    .in('id', ids);

  if (error) {
    console.error(
      'Warning: failed to reset rows to pending:',
      error.message
    );
  }
}

async function persistBatch(successfulDownloads, vectors, now) {
  const embeddingRows = successfulDownloads.map((item, index) => ({
    id: item.id,
    embedding: vectors[index],
    metadata: {
      source: 'wikimedia_commons',
      corpus_version: process.env.CORPUS_VERSION || 'v3',
    },
    embedding_model: model,
    embedded_at: now,
  }));

  /*
   * IMPORTANT:
   * Gemini has already succeeded here.
   * From this point onward, retries are ONLY Supabase retries.
   * We never call Gemini again for this batch if the database fails.
   */
  await withDbRetry(
    async () => {
      const { error } = await sb
        .from('photo_embeddings')
        .upsert(embeddingRows, { onConflict: 'id' });

      if (error) {
        throw error;
      }
    },
    'Supabase photo_embeddings upsert'
  );

  const ids = successfulDownloads.map((item) => item.id);

  await withDbRetry(
    async () => {
      const { error } = await sb
        .from('photo_catalog')
        .update({
          embedding_status: 'ready',
          embedding_model: model,
          embedded_at: now,
        })
        .in('id', ids);

      if (error) {
        throw error;
      }
    },
    'Supabase photo_catalog status update'
  );

  return ids;
}

let done = 0;
let failed = 0;

try {
  // MUST happen before any Gemini API request.
  await validateSchema();

  await resetInterruptedProcessing();

  /*
   * Protect against a previous run where Gemini succeeded and the
   * Supabase catalog update failed. Existing embeddings are reconciled
   * before selecting new pending rows, preventing duplicate Gemini calls.
   */
  await reconcileExistingEmbeddings();

  while (true) {
    const { data: rows, error } = await sb
      .from('photo_catalog')
      .select('id,storage_path')
      .eq('active', true)
      .eq('embedding_status', 'pending')
      .order('id')
      .limit(BATCH_SIZE);

    if (error) {
      throw new Error(`Could not fetch pending corpus rows: ${error.message}`);
    }

    if (!rows?.length) {
      break;
    }

    const claimedRows = [];

    for (const row of rows) {
      const { error: claimError } = await sb
        .from('photo_catalog')
        .update({ embedding_status: 'processing' })
        .eq('id', row.id)
        .eq('embedding_status', 'pending');

      if (claimError) {
        throw new Error(
          `Could not claim row ${row.id}: ${claimError.message}`
        );
      }

      claimedRows.push(row);
    }

    const successfulDownloads = [];

    for (const row of claimedRows) {
      try {
        successfulDownloads.push(await downloadRow(row));
      } catch (err) {
        console.error(
          `Download failed for ${row.id}:`,
          err?.message || err
        );

        await sb
          .from('photo_catalog')
          .update({ embedding_status: 'failed' })
          .eq('id', row.id);

        failed++;
      }
    }

    if (!successfulDownloads.length) {
      continue;
    }

    const processingIds = successfulDownloads.map((item) => item.id);

    try {
      // Gemini is called exactly once per batch, subject only to bounded API retries.
      const vectors = await embedImages(successfulDownloads);

      const now = new Date().toISOString();

      // After this succeeds, DB retries happen without re-calling Gemini.
      const ids = await persistBatch(
        successfulDownloads,
        vectors,
        now
      );

      done += ids.length;

      console.log(
        `Embedding progress: ${done} ready, ${failed} failed`
      );
    } catch (err) {
      await resetRowsToPending(processingIds);

      if (err instanceof DailyQuotaError) {
        console.error(err.message);
        process.exitCode = 2;
        break;
      }

      console.error(
        'Embedding batch failed after bounded retries:',
        err?.message || err
      );

      /*
       * Stop the workflow rather than immediately trying another batch.
       * The pending rows remain resumable for the next run.
       */
      process.exitCode = 1;
      break;
    }

    await sleep(250);
  }

  console.log(
    `Embedding pass complete. Ready: ${done}; failed: ${failed}.`
  );
} catch (err) {
  console.error(
    'Embedding workflow failed:',
    err?.message || err
  );
  process.exitCode = 1;
}
