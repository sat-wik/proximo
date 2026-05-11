#!/usr/bin/env node
/**
 * Upload precomputed rank files to Cloudflare R2.
 *
 * Prerequisites:
 *   pnpm install   (installs @aws-sdk/client-s3 from root devDependencies)
 *
 * Required env vars (set in .env or export in shell):
 *   R2_ACCOUNT_ID        — Cloudflare account ID
 *   R2_ACCESS_KEY_ID     — R2 API token Access Key ID
 *   R2_SECRET_ACCESS_KEY — R2 API token Secret Access Key
 *   R2_BUCKET_NAME       — bucket name (e.g. "closer-ranks")
 *
 * Usage:
 *   node scripts/upload-ranks-r2.mjs
 */

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { readdir, readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME } = process.env;

if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET_NAME) {
  console.error(
    'Missing env vars. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME'
  );
  process.exit(1);
}

const client = new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
});

const RANKS_DIR = join(__dirname, '../data/ranks');
const CONCURRENCY = 20;

const files = await readdir(RANKS_DIR);
console.log(`Uploading ${files.length} rank files to r2://${R2_BUCKET_NAME}/ranks/ ...`);

let done = 0;

async function upload(file) {
  const body = await readFile(join(RANKS_DIR, file));
  await client.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: `ranks/${file}`,
      Body: body,
      ContentType: 'application/json',
    })
  );
  done++;
  if (done % 100 === 0 || done === files.length) {
    process.stdout.write(`\r${done}/${files.length}`);
  }
}

// Upload in parallel batches
for (let i = 0; i < files.length; i += CONCURRENCY) {
  await Promise.all(files.slice(i, i + CONCURRENCY).map(upload));
}

console.log('\nDone. Set RANKS_BUCKET_URL on Railway to your bucket\'s public URL.');
