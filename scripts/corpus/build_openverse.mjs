import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';

const target = Number(process.env.CORPUS_TARGET || 1000);
const version = process.env.CORPUS_VERSION || 'v3';
const pageSize = Math.min(50, Math.max(10, Number(process.env.OPENVERSE_PAGE_SIZE || 50)));
const maxPagesPerQuery = Math.max(1, Number(process.env.OPENVERSE_MAX_PAGES || 6));
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SECRET_KEY;

if (!supabaseUrl || !supabaseKey) throw new Error('SUPABASE_URL and SUPABASE_SECRET_KEY are required.');

const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false, autoRefreshToken: false } });
const bucket = 'photo-corpus';
const outDir = path.resolve('data/real-corpus');
await fs.mkdir(outDir, { recursive: true });

const queries = [
  'motorcycle mountain','motorcycle road','car repair','dog walking','dog park',
  'family gathering','birthday cake','wedding family','coffee laptop','office laptop',
  'city street','beach trip','hiking river','backpack travel','snow mountain',
  'restaurant dinner','flowers celebration','phone screenshot','work documents','everyday home scene'
];

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const sha1 = (buf) => crypto.createHash('sha1').update(buf).digest('hex');

async function openverse(q, page) {
  const params = new URLSearchParams({
    q,
    page: String(page),
    page_size: String(pageSize),
    license: 'by,cc0,pdm',
    category: 'photograph',
    extension: 'jpg,jpeg',
    filter_dead: 'true',
    mature: 'false',
    size: 'medium'
  });
  let lastError;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch(`https://api.openverse.org/v1/images/?${params}`, { headers: { 'User-Agent': 'RetrievalRecoveryCopilot/1.0 (education prototype)' } });
      if (res.ok) return res.json();
      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable) throw new Error(`Openverse ${res.status} for ${q} page ${page}`);
      const retryAfter = Number(res.headers.get('retry-after') || 0);
      await sleep(Math.max(1000, Math.min(10000, retryAfter * 1000 || 1200 * (attempt + 1))));
      lastError = new Error(`Openverse ${res.status} for ${q} page ${page}`);
    } catch (err) {
      lastError = err;
      if (attempt === 4) break;
      await sleep(1000 * (attempt + 1));
    }
  }
  throw lastError || new Error(`Openverse request failed for ${q} page ${page}`);
}

const seen = new Set();
const manifest = [];

for (const q of queries) {
  for (let page = 1; page <= maxPagesPerQuery && manifest.length < target; page++) {
    const data = await openverse(q, page);
    for (const item of data.results || []) {
      if (manifest.length >= target) break;
      if (!item.url || !item.foreign_landing_url || !item.license || !item.license_url) continue;
      if (!['by','cc0','pdm'].includes(item.license)) continue;
      if (item.watermarked === true) continue;
      const key = item.identifier || item.url;
      if (seen.has(key)) continue;

      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 20000);
        const r = await fetch(item.url, { signal: controller.signal });
        clearTimeout(timeout);
        if (!r.ok) continue;
        const raw = Buffer.from(await r.arrayBuffer());
        if (raw.length < 20_000 || raw.length > 8_000_000) continue;
        const image = sharp(raw, { failOn: 'warning' });
        const meta = await image.metadata();
        if (!meta.width || !meta.height || Math.min(meta.width, meta.height) < 160) continue;
        const processed = await image.rotate().resize({ width: 1280, height: 960, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 78, mozjpeg: true }).toBuffer();
        if (processed.length > 900_000) continue;

        const hash = sha1(processed);
        const id = `ov_${hash.slice(0, 20)}`;
        if (seen.has(id)) continue;
        seen.add(key); seen.add(id);
        const storagePath = `${version}/${id}.jpg`;
        const { error: upErr } = await supabase.storage.from(bucket).upload(storagePath, processed, { contentType: 'image/jpeg', upsert: false });
        if (upErr) continue;
        const publicUrl = `${supabaseUrl.replace(/\/$/, '')}/storage/v1/object/public/${bucket}/${storagePath}`;
        const attribution = item.attribution || `${item.creator || 'Unknown creator'} — ${item.license?.toUpperCase() || 'OPEN LICENSE'}`;
        const record = {
          id,
          storage_path: storagePath,
          public_url: publicUrl,
          title: item.title || null,
          creator: item.creator || null,
          creator_url: item.creator_url || null,
          license: item.license,
          license_version: item.license_version || null,
          license_url: item.license_url,
          attribution,
          provider: item.provider || null,
          source: item.source || null,
          source_id: item.identifier || null,
          source_url: item.foreign_landing_url,
          original_url: item.url,
          width: meta.width || null,
          height: meta.height || null,
          tags: item.tags || [],
          retrieval_metadata: {
            queryTerms: q.split(/\s+/).filter(Boolean),
            description: item.description || item.title || null
          },
          source_metadata: {
            query: q,
            openverse_detail_url: item.detail_url || null,
            fetched_at: new Date().toISOString(),
            modified_for_web: true,
            modification_note: 'Resized and converted to JPEG for web delivery.'
          },
          embedding_status: 'pending',
          active: true
        };
        const { error: dbErr } = await supabase.from('photo_catalog').upsert(record, { onConflict: 'id' });
        if (dbErr) {
          await supabase.storage.from(bucket).remove([storagePath]);
          continue;
        }
        manifest.push(record);
        if (manifest.length % 25 === 0) console.log(`Corpus progress: ${manifest.length}/${target}`);
      } catch {
        // skip broken/blocked upstream files
      }
      await sleep(120);
    }
    if (!data.page_count || page >= data.page_count) break;
    await sleep(300);
  }
}

await fs.writeFile(path.join(outDir, `manifest-${version}.json`), JSON.stringify({ version, count: manifest.length, records: manifest }, null, 2));
console.log(`Done. Added ${manifest.length} real photos.`);
if (manifest.length < target) process.exitCode = 2;
