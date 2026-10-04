import { GoogleGenAI } from '@google/genai';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SECRET_KEY;
const geminiKey = process.env.GEMINI_API_KEY;
if (!supabaseUrl || !supabaseKey || !geminiKey) throw new Error('SUPABASE_URL, SUPABASE_SECRET_KEY and GEMINI_API_KEY are required.');

const sb = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false, autoRefreshToken: false } });
const ai = new GoogleGenAI({ apiKey: geminiKey });
const bucket = 'photo-corpus';
const model = 'gemini-embedding-2';

// Recover rows left in processing state by a previously interrupted run.
await sb.from('photo_catalog').update({ embedding_status: 'pending' }).eq('embedding_status', 'processing');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function embedImage(bytes) {
  let lastError;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const response = await ai.models.embedContent({
        model,
        contents: [{ inlineData: { mimeType: 'image/jpeg', data: Buffer.from(bytes).toString('base64') } }],
        config: { outputDimensionality: 768 }
      });
      const vector = response.embeddings?.[0]?.values;
      if (!vector?.length) throw new Error('No embedding returned.');
      return vector;
    } catch (err) {
      lastError = err;
      if (attempt === 4) break;
      await sleep(1200 * (attempt + 1));
    }
  }
  throw lastError || new Error('Embedding request failed.');
}

let from = 0;
const pageSize = 25;
let done = 0;
while (true) {
  const { data: rows, error } = await sb.from('photo_catalog')
    .select('id,storage_path')
    .eq('active', true)
    .eq('embedding_status', 'pending')
    .order('id')
    .range(from, from + pageSize - 1);
  if (error) throw error;
  if (!rows?.length) break;
  for (const row of rows) {
    await sb.from('photo_catalog').update({ embedding_status: 'processing' }).eq('id', row.id);
    try {
      const { data: file, error: dlErr } = await sb.storage.from(bucket).download(row.storage_path);
      if (dlErr) throw dlErr;
      const vector = await embedImage(await file.arrayBuffer());
      const { error: upErr } = await sb.from('photo_embeddings').upsert({
        id: row.id,
        embedding: vector,
        metadata: { source: 'openverse', corpus_version: process.env.CORPUS_VERSION || 'v2' },
        embedding_model: model,
        embedded_at: new Date().toISOString()
      }, { onConflict: 'id' });
      if (upErr) throw upErr;
      const { error: statusErr } = await sb.from('photo_catalog').update({ embedding_status: 'ready', embedding_model: model, embedded_at: new Date().toISOString() }).eq('id', row.id);
      if (statusErr) throw statusErr;
      done++;
      if (done % 10 === 0) console.log(`Embedding progress: ${done}`);
    } catch (e) {
      console.error(`Embedding failed for ${row.id}:`, e?.message || e);
      await sb.from('photo_catalog').update({ embedding_status: 'failed' }).eq('id', row.id);
    }
    await sleep(250);
  }
  // Re-query pending rows from the beginning because statuses are changing.
  from = 0;
}
console.log(`Embedding pass complete. Newly embedded: ${done}`);
