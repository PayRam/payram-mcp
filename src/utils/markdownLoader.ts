import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DOCS_ROOT = path.resolve(__dirname, '../..', 'docs', 'payram-docs-live');

export const getDocsRoot = () => DOCS_ROOT;

export const loadMarkdown = async (relativePath: string): Promise<string> => {
  const fullPath = path.join(DOCS_ROOT, relativePath);
  try {
    const content = await fs.readFile(fullPath, 'utf8');
    return content;
  } catch (error) {
    logger.error('Failed to load markdown file', { fullPath, error });
    throw error;
  }
};

export const loadManyMarkdown = async (paths: string[]): Promise<string[]> => {
  return Promise.all(paths.map(loadMarkdown));
};
