import fs from 'node:fs/promises';
import path from 'node:path';

export async function readSnapshot(cacheFile) {
  try {
    const raw = await fs.readFile(cacheFile, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

function canFallback(error) {
  return ['EPERM', 'EXDEV', 'EACCES'].includes(error?.code);
}

export async function writeSnapshot(cacheFile, snapshot, deps = {}) {
  const rename = deps.rename || fs.rename;
  const copyFile = deps.copyFile || fs.copyFile;
  const unlink = deps.unlink || fs.unlink;

  await fs.mkdir(path.dirname(cacheFile), { recursive: true });
  const tempFile = `${cacheFile}.tmp`;
  await fs.writeFile(tempFile, JSON.stringify(snapshot, null, 2), 'utf8');

  try {
    await rename(tempFile, cacheFile);
  } catch (error) {
    if (!canFallback(error)) {
      throw error;
    }
    await copyFile(tempFile, cacheFile);
    try {
      await unlink(tempFile);
    } catch (cleanupError) {
      if (!canFallback(cleanupError)) {
        throw cleanupError;
      }
    }
  }

  return snapshot;
}
