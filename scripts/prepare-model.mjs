/** Build-time downloads only. The app itself is strictly offline. Node >= 22. */
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const model = 'Xenova/whisper-small';
const revision = '2d67713f236afa48a18992566e7647f6ca848e13';
// HF Git blob IDs for ordinary files; SHA-256 LFS IDs for model weights.
// Verified from https://huggingface.co/api/models/Xenova/whisper-small/revision/<revision>?blobs=true
const files = [
  ['config.json', 2232, 'a239fdd538b77d3c496d13d085848eca67fe993a'],
  ['generation_config.json', 3837, '66f96818620f7b67c276aed4a35bedc4f6986dc3'],
  ['preprocessor_config.json', 339, '91876762a536a746d268353c5cba57286e76b058'],
  ['tokenizer.json', 2480466, '1e95340ff836fad1b5932e800fb7b8c5e6d78a74'],
  ['tokenizer_config.json', 282683, 'd13b786c04765fb1a06492b53587752cd67665ea'],
  ['special_tokens_map.json', 2194, 'bf69932dca4b3719b59fdd8f6cc1978109509f6c'],
  ['added_tokens.json', 2082, 'a973b01f5b1e5755fb2fd8a89cbd0c0c0ccf1460'],
  ['vocab.json', 1036584, '90e797dd4fd05d9dea443d702ca06be2463c5f2f'],
  ['merges.txt', 493869, '6038932a2a1f09a66991b1c2adae0d14066fa29e'],
  ['normalizer.json', 52666, 'dd6ae819ad738ac1a546e9f9282ef325c33b9ea0'],
  ['README.md', 1163, '220a86a80a79192832df3502a91d5faae6104332'],
  ['onnx/encoder_model_quantized.onnx', 92324809, '969f5ac12974340386bf7a02ea6626003e5e2dee396ffc6ab0eec282bf55ba06'],
  ['onnx/decoder_model_merged_quantized.onnx', 156780950, 'fcfc6100dc7339e7507e10f8b274350be7c4f8d8b575f0293f94cc0e156d6d24'],
];
const verifyOnly = process.argv.includes('--verify');

async function hashFile(file, expectedSize, expectedHash) {
  const meta = await stat(file);
  if (meta.size !== expectedSize) throw new Error(`Size mismatch for ${file}`);
  const digest = createHash(expectedHash.length === 40 ? 'sha1' : 'sha256');
  if (expectedHash.length === 40) digest.update(`blob ${expectedSize}\0`);
  const sha256 = createHash('sha256');
  for await (const block of createReadStream(file)) { digest.update(block); sha256.update(block); }
  if (digest.digest('hex') !== expectedHash) throw new Error(`Checksum mismatch for ${file}`);
  return sha256.digest('hex');
}

async function download(file, size, hash, directory = `models/${model}`, url = `https://huggingface.co/${model}/resolve/${revision}/${file}?download=true`) {
  const destination = path.join(root, 'public', directory, file);
  try { return await hashFile(destination, size, hash); }
  catch (error) { if (verifyOnly) throw new Error(`Missing/corrupt offline model: ${file}. Run npm run model:prepare.`, { cause: error }); }
  await mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.download`;
  console.log(`Bundling ${directory}/${file} (${(size / 1024 / 1024).toFixed(1)} MiB)`);
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(180_000) });
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status} downloading ${file}`);
      let written = 0;
      const limiter = new Transform({ transform(chunk, encoding, callback) { written += chunk.length; callback(written > size ? new Error('Downloaded file exceeded pinned size') : null, chunk); } });
      await pipeline(Readable.fromWeb(response.body), limiter, createWriteStream(temporary));
      const checksum = await hashFile(temporary, size, hash);
      await rename(temporary, destination);
      return checksum;
    } catch (error) {
      await rm(temporary, { force: true });
      if (attempt === 3) throw new Error(`Cannot download ${url}. If your network requires a proxy, set HTTPS_PROXY and (Node 24+) NODE_USE_ENV_PROXY=1, then retry. ${error.message}`, { cause: error });
      console.warn(`Retry ${attempt}/3: ${file}: ${error.message}`);
    }
  }
}

const manifest = { model, revision, modelLicense: 'Apache-2.0', files: {} };
// Four parallel requests keep downloads practical without large memory buffers.
for (let i = 0; i < files.length; i += 4) await Promise.all(files.slice(i, i + 4).map(async ([file, size, hash]) => {
  manifest.files[`models/${model}/${file}`] = { size, sha256: await download(file, size, hash) };
}));

// The ONNX model card declares Apache-2.0; preserve its README and standard license.
const transformersRoot = path.resolve(path.dirname(require.resolve('@huggingface/transformers')), '..');
const apache = await readFile(path.join(transformersRoot, 'LICENSE'));
const modelLicense = path.join(root, 'public', 'models', model, 'LICENSE');
const apacheHash = createHash('sha256').update(apache).digest('hex');
if (verifyOnly) await hashFile(modelLicense, apache.length, apacheHash);
else await writeFile(modelLicense, apache);
manifest.files[`models/${model}/LICENSE`] = { size: apache.length, sha256: apacheHash };

// Copy the runtime from the exact lockfile-installed onnxruntime-web package.
// Both jsep and plain WASM loaders are copied because its export conditions select them.
const runtimeDist = path.dirname(require.resolve('onnxruntime-web'));
const runtimeFiles = (await readdir(runtimeDist)).filter(name => /^ort-wasm.*\.(mjs|wasm)$/.test(name));
if (!runtimeFiles.some(file => file.endsWith('.wasm'))) throw new Error('ONNX runtime WASM assets were not found. Run npm ci.');
await mkdir(path.join(root, 'public', 'ort'), { recursive: true });
for (const file of runtimeFiles) {
  const source = path.join(runtimeDist, file), destination = path.join(root, 'public', 'ort', file);
  const sourceData = await readFile(source);
  const sha256 = createHash('sha256').update(sourceData).digest('hex');
  if (verifyOnly) await hashFile(destination, sourceData.length, sha256);
  else await copyFile(source, destination);
  manifest.files[`ort/${file}`] = { size: sourceData.length, sha256 };
}
const ortCommit = '89f8206ba4f1c22c39e0297fb55272e8ce8cd7d0';
for (const [file, size, hash] of [
  ['LICENSE', 1073, '2f07c72751aed99790b8a4869cf2311df85a860b22ded05fa22803587a48922c'],
  ['ThirdPartyNotices.txt', 326866, 'e9e90971a8e75a9a8ac0c6412e29c1202d079998389915aa485f46c816c3b4cc'],
]) manifest.files[`ort/${file}`] = { size, sha256: await download(file, size, hash, 'ort', `https://raw.githubusercontent.com/microsoft/onnxruntime/${ortCommit}/${file}`) };
if (!verifyOnly) await writeFile(path.join(root, 'public', 'offline-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
const total = Object.values(manifest.files).reduce((sum, file) => sum + file.size, 0);
console.log(`Offline assets ${verifyOnly ? 'verified' : 'ready'}: ${(total / 1024 / 1024).toFixed(1)} MiB; immutable model revision ${revision}.`);
