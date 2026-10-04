import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';

const target = Number(process.env.CORPUS_TARGET || 1000);
const version = process.env.CORPUS_VERSION || 'v4';
const searchLimit = Math.min(50, Math.max(10, Number(process.env.COMMONS_SEARCH_LIMIT || 50)));
const maxOffsetsPerQuery = Math.max(1, Number(process.env.COMMONS_MAX_OFFSETS_PER_QUERY || 4));
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SECRET_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('SUPABASE_URL and SUPABASE_SECRET_KEY are required.');
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const bucket = 'photo-corpus';
const outDir = path.resolve('data/real-corpus');
await fs.mkdir(outDir, { recursive: true });

// Deliberately chosen around the retrieval scenarios uncovered in the Discovery Engine.
const queries = [
  'motorcycle mountain road photo',
  'motorcycle travel photo',
  'car engine repair photo',
  'garage car repair photo',
  'dog walking photo',
  'dog park photo',
  'family gathering photo',
  'family dinner photo',
  'birthday cake photo',
  'wedding family photo',
  'coffee laptop photo',
  'office laptop photo',
  'city street photo',
  'beach travel photo',
  'hiking river photo',
  'backpack travel photo',
  'snow mountain photo',
  'restaurant dinner photo',
  'flowers celebration photo',
  'portrait person photo',
  'mountain road person photo',
  'blue jacket person photo',
  'black jacket person photo',
  'road trip friends photo',
  'family home photo',
  'park motorcycle photo',
  'travel helmet photo',
  'repair tools photo',
  'birthday celebration photo',
  'street sign person photo',
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sha1 = (buf) => crypto.createHash('sha1').update(buf).digest('hex');
const stripHtml = (value = '') => String(value).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

function metaValue(ext, key) {
  return ext?.[key]?.value == null ? '' : stripHtml(ext[key].value);
}

function acceptedLicense(shortName, copyrightValue, usageTerms) {
  const s = String(shortName || '').trim().toLowerCase();
  const usage = String(usageTerms || '').trim().toLowerCase();
  const copyright = String(copyrightValue || '').trim().toLowerCase();

  if (s === 'cc0' || s.startsWith('cc0 ')) return true;
  if (s.includes('public domain') || s.includes('public-domain')) return true;
  if (s === 'pdm' || s.includes('public domain mark')) return true;
  if (/^cc by(?:\s|$)/i.test(shortName)) return true;
  if (/creativecommons\s+attribution/i.test(usage)) return true;
  if (copyright === 'false' && (s.includes('public domain') || usage.includes('public domain'))) return true;
  return false;
}

function isPhotoLike(info, ext) {
  const mime = String(info?.mime || '').toLowerCase();
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(mime)) return false;
  const title = stripHtml(info?.canonicaltitle || info?.descriptionurl || '').toLowerCase();
  const description = metaValue(ext, 'ImageDescription').toLowerCase();
  const categories = metaValue(ext, 'Categories').toLowerCase();
  const combined = `${title} ${description} ${categories}`;
  const rejectWords = [
    'map', 'logo', 'icon', 'diagram', 'chart', 'screenshot', 'drawing',
    'illustration', 'vector', 'coat of arms', 'flag of', 'poster', 'collage',
    'painting', 'artwork', 'scan of', 'comic'
  ];
  return !rejectWords.some((word) => combined.includes(word));
}

async function commonsSearch(query, offset) {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    list: 'search',
    srnamespace: '6',
    srsearch: query,
    srlimit: String(searchLimit),
    sroffset: String(offset),
  });
  const url = `https://commons.wikimedia.org/w/api.php?${params}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'RetrievalRecoveryCopilot/1.0 (https://github.com/Sanbhati07/retrieval-recovery-copilot)',
      'Api-User-Agent': 'RetrievalRecoveryCopilot/1.0 (https://github.com/Sanbhati07/retrieval-recovery-copilot)',
      Accept: 'application/json',
    },
  });
  if (!res.ok) throw new Error(`Wikimedia search ${res.status} for ${query} offset ${offset}`);
  return res.json();
}

async function imageInfo(titles) {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    prop: 'imageinfo',
    titles: titles.join('|'),
    iiprop: 'url|size|mime|extmetadata',
    iiurlwidth: '1280',
    iiextmetadatalanguage: 'en',
    iimetadataversion: 'latest',
    iiextmetadatafilter: [
      'ObjectName',
      'ImageDescription',
      'Artist',
      'Credit',
      'License',
      'LicenseShortName',
      'LicenseUrl',
      'UsageTerms',
      'Attribution',
      'AttributionRequired',
      'Copyrighted',
      'Restrictions',
      'Categories',
      'DateTimeOriginal',
      'GPSLatitude',
      'GPSLongitude',
    ].join('|'),
  });
  const url = `https://commons.wikimedia.org/w/api.php?${params}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'RetrievalRecoveryCopilot/1.0 (https://github.com/Sanbhati07/retrieval-recovery-copilot)',
      'Api-User-Agent': 'RetrievalRecoveryCopilot/1.0 (https://github.com/Sanbhati07/retrieval-recovery-copilot)',
      Accept: 'application/json',
    },
  });
  if (!res.ok) throw new Error(`Wikimedia imageinfo ${res.status}`);
  return res.json();
}

const seenSource = new Set();
const seenHash = new Set();
const manifest = [];

for (const query of queries) {
  if (manifest.length >= target) break;
  for (let offsetIndex = 0; offsetIndex < maxOffsetsPerQuery && manifest.length < target; offsetIndex++) {
    const offset = offsetIndex * searchLimit;
    let data;
    try {
      data = await commonsSearch(query, offset);
    } catch (error) {
      console.warn(error.message);
      await sleep(1000);
      continue;
    }

    const pages = (data?.query?.search || []).map((x) => x.title).filter(Boolean);
    if (!pages.length) break;

    for (let start = 0; start < pages.length && manifest.length < target; start += 25) {
      const batchTitles = pages.slice(start, start + 25);
      let infoData;
      try {
        infoData = await imageInfo(batchTitles);
      } catch (error) {
        console.warn(error.message);
        await sleep(1200);
        continue;
      }

      for (const page of infoData?.query?.pages || []) {
        if (manifest.length >= target) break;
        const info = page?.imageinfo?.[0];
        if (!info || !info.thumburl || !info.descriptionurl) continue;
        if (info.width < 320 || info.height < 240) continue;
        if (!isPhotoLike(info, info.extmetadata || {})) continue;

        const ext = info.extmetadata || {};
        const licenseShortName = metaValue(ext, 'LicenseShortName');
        const licenseUrl = metaValue(ext, 'LicenseUrl');
        const usageTerms = metaValue(ext, 'UsageTerms');
        const copyrighted = metaValue(ext, 'Copyrighted');
        const restrictions = metaValue(ext, 'Restrictions');
        if (!acceptedLicense(licenseShortName, copyrighted, usageTerms)) continue;
        if (restrictions) continue;

        const sourceId = String(page.pageid || page.title);
        if (seenSource.has(sourceId)) continue;
        seenSource.add(sourceId);

        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 20000);
          const response = await fetch(info.thumburl, {
            signal: controller.signal,
            headers: {
              'User-Agent': 'RetrievalRecoveryCopilot/1.0 (https://github.com/Sanbhati07/retrieval-recovery-copilot)',
              'Api-User-Agent': 'RetrievalRecoveryCopilot/1.0 (https://github.com/Sanbhati07/retrieval-recovery-copilot)',
            },
          });
          clearTimeout(timeout);
          if (!response.ok) continue;
          const raw = Buffer.from(await response.arrayBuffer());
          if (raw.length < 20_000 || raw.length > 10_000_000) continue;

          const image = sharp(raw, { failOn: 'warning' });
          const meta = await image.metadata();
          if (!meta.width || !meta.height || Math.min(meta.width, meta.height) < 160) continue;

          const processed = await image
            .rotate()
            .resize({ width: 1280, height: 960, fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 78, mozjpeg: true })
            .toBuffer();

          if (processed.length > 900_000) continue;
          const hash = sha1(processed);
          if (seenHash.has(hash)) continue;
          seenHash.add(hash);

          const id = `wm_${hash.slice(0, 20)}`;
          const storagePath = `${version}/${id}.jpg`;
          const { error: uploadError } = await supabase.storage
            .from(bucket)
            .upload(storagePath, processed, {
              contentType: 'image/jpeg',
              upsert: false,
            });

          // If the file was already uploaded by an earlier retry, continue using the same ID.
          if (uploadError && !String(uploadError.message || '').toLowerCase().includes('already exists')) {
            continue;
          }

          const publicUrl = `${supabaseUrl.replace(/\/$/, '')}/storage/v1/object/public/${bucket}/${storagePath}`;
          const creator = metaValue(ext, 'Artist') || metaValue(ext, 'Credit') || null;
          const attribution = metaValue(ext, 'Attribution') ||
            `${metaValue(ext, 'ObjectName') || page.title.replace(/^File:/, '')}${creator ? ` — ${creator}` : ''} — ${licenseShortName}`;

          const record = {
            id,
            storage_path: storagePath,
            public_url: publicUrl,
            title: metaValue(ext, 'ObjectName') || page.title.replace(/^File:/, ''),
            creator,
            creator_url: null,
            license: licenseShortName,
            license_version: null,
            license_url: licenseUrl || null,
            attribution,
            provider: 'Wikimedia Commons',
            source: 'Wikimedia Commons',
            source_id: sourceId,
            source_url: info.descriptionurl,
            original_url: info.url || info.thumburl,
            width: meta.width,
            height: meta.height,
            tags: {
              query: query,
              categories: metaValue(ext, 'Categories')
                .split('|')
                .map((x) => x.trim())
                .filter(Boolean)
                .slice(0, 40),
            },
            retrieval_metadata: {
              queryTerms: query.split(/\s+/).filter(Boolean),
              description: metaValue(ext, 'ImageDescription') || null,
              dateTimeOriginal: metaValue(ext, 'DateTimeOriginal') || null,
              gps: {
                lat: metaValue(ext, 'GPSLatitude') || null,
                lon: metaValue(ext, 'GPSLongitude') || null,
              },
              sourcePageTitle: page.title,
              sourceId,
            },
            source_metadata: {
              query,
              provider: 'Wikimedia Commons',
              fetched_at: new Date().toISOString(),
              modified_for_web: true,
              modification_note: 'Thumbnail downloaded from Wikimedia Commons and resized/converted to JPEG for web delivery.',
            },
            embedding_status: 'pending',
            active: true,
          };

          const { error: dbError } = await supabase
            .from('photo_catalog')
            .upsert(record, { onConflict: 'id' });

          if (dbError) {
            // If DB insertion fails for a new file, remove the uploaded object to keep storage/catalog in sync.
            if (!uploadError) {
              await supabase.storage.from(bucket).remove([storagePath]).catch(() => {});
            }
            continue;
          }

          manifest.push(record);
          if (manifest.length % 25 === 0) {
            console.log(`Corpus progress: ${manifest.length}/${target}`);
          }
        } catch (error) {
          console.warn(`Skipping ${page.title}: ${error.message}`);
        }
        await sleep(120);
      }
      await sleep(350);
    }
    await sleep(500);
  }
}

await fs.writeFile(
  path.join(outDir, `manifest-${version}.json`),
  JSON.stringify({ version, count: manifest.length, records: manifest }, null, 2),
  'utf8',
);

console.log(`Done. Added ${manifest.length} real photos.`);
if (manifest.length < target) {
  console.error(`Corpus target not reached: ${manifest.length}/${target}`);
  process.exitCode = 2;
}
