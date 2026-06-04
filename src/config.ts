import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const config = {
  dbPath: process.env.DB_PATH ?? path.join(ROOT, 'data', 'guidelines.db'),
  voyageApiKey: process.env.VOYAGE_API_KEY ?? '',
  embedModel: 'voyage-4',
  cacheDir: path.join(ROOT, '.cache'),
};
