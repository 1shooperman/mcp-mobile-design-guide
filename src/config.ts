import path from 'path';

const ROOT = path.resolve(__dirname, '..');

export const config = {
  dbPath: process.env.DB_PATH ?? path.join(ROOT, 'data', 'guidelines.db'),
  voyageApiKey: process.env.VOYAGE_API_KEY ?? '',
  embedModel: 'voyage-4',
  cacheDir: path.join(ROOT, '.cache'),
};
