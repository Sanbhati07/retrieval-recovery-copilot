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
const BATCH_SIZE = 6; // Gemini Embedding 2 supports up to 6 images per request.
const MAX_RETRIES = 5;

// Recover rows left in processing state by an interrupted run.
const { error: resetError } = await sb
  .from('photo_catalog')
  .update({ embedding_status: 'pending' })
  .eq('embedding_status', 'processing');
if (resetError) throw resetError;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function embedImages(items) {
  let lastError;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
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
        throw new Error(`Expected ${items.length} embeddings but received ${embeddings.length}.`);
      }

      return embeddings.map((embedding, index) => {
        const values = embedding?.values;
        if (!values?.length) throw new Error(`No embedding returned for ${items[index].id}.`);
        return values;
      });
    } catch (err) {
      lastError = err;
      if (attempt === MAX_RETRIES - 1) break;
      await sleep(1500 * (attempt + 1));
    }
  }
  throw lastError || new Error('Embedding request failed.');
}

async function downloadRow(row) {
  const { data: file, error } = await sb.storage.from(bucket).download(row.storage_path);
  if (error) throw error;
  const bytes = Buffer.from(await file.arrayBuffer());
  return {
    id: row.id,
    storage_path: row.storage_path,
    base64: bytes.toString('base64'),
  };
}

let done = 0;
let failed = 0;

while (true) {
  const { data: rows, error } = await sb
    .from('photo_catalog')
    .select('id,storage_path')
    .eq('active', true)
    .eq('embedding_status', 'pending')
    .order('id')
    .limit(BATCH_SIZE);

  if (error) throw error;
  if (!rows?.length) break;

  // Claim the batch before external work so an interrupted run can be safely recovered.
  for (const row of rows) {
    const { error: claimError } = await sb
      .from('photo_catalog')
      .update({ embedding_status: 'processing' })
      .eq('id', row.id)
      .eq('embedding_status', 'pending');
    if (claimError) throw claimError;
  }

  const successfulDownloads = [];
  for (const row of rows) {
    try {
      successfulDownloads.push(await downloadRow(row));
    } catch (err) {
      console.error(`Download failed for ${row.id}:`, err?.message || err);
      await sb.from('photo_catalog').update({ embedding_status: 'failed' }).eq('id', row.id);
      failed++;
    }
  }

  if (successfulDownloads.length) {
    try {
      const vectors = await embedImages(successfulDownloads);
      const now = new Date().toISOString();

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

      const { error: upsertError } = await sb
        .from('photo_embeddings')
        .upsert(embeddingRows, { onConflict: 'id' });
      if (upsertError) throw upsertError;

      const ids = successfulDownloads.map((item) => item.id);
      const { error: statusError } = await sb
        .from('photo_catalog')
        .update({
          embedding_status: 'ready',
          embedding_model: model,
          embedded_at: now,
        })
        .in('id', ids);
      if (statusError) throw statusError;

      done += ids.length;
      console.log(`Embedding progress: ${done} ready, ${failed} failed`);
    } catch (err) {
      console.error(`Embedding batch failed:`, err?.message || err);
      for (const item of successfulDownloads) {
        await sb.from('photo_catalog').update({ embedding_status: 'pending' }).eq('id', item.id);
      }
      // Back off before the next retrying batch; pending rows remain safely resumable.
      await sleep(3000);
    }
  }

  await sleep(250);
}

console.log(`Embedding pass complete. Ready: ${done}; failed: ${failed}.`);
