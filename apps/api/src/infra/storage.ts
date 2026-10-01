import { Injectable } from '@nestjs/common';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { env } from '../config/env.js';

export const STORAGE = Symbol('STORAGE');

/** Stockage objet privé : jamais d'URL publique, les fichiers ne sortent que par une route authentifiée. */
export interface ObjectStorage {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
}

/** Dev : fichiers sur disque sous STORAGE_DIR. Même interface qu'un bucket S3 privé pour la production. */
@Injectable()
export class LocalObjectStorage implements ObjectStorage {
  private readonly root = resolve(env().STORAGE_DIR);

  async put(key: string, data: Buffer): Promise<void> {
    const path = this.pathOf(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data, { flag: 'wx' });
  }

  get(key: string): Promise<Buffer> {
    return readFile(this.pathOf(key));
  }

  private pathOf(key: string): string {
    const path = resolve(this.root, key);
    if (relative(this.root, path).startsWith('..')) throw new Error('Clé de stockage invalide');
    return path;
  }
}
