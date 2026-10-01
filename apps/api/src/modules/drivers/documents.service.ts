import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import { AppError, Errors } from '../../common/errors.js';
import { mimeFromExt, sniffFileType } from '../../common/file-type.js';
import { env } from '../../config/env.js';
import { DB, type Db } from '../../db/db.js';
import { type DocumentType, driverDocuments, driverProfiles } from '../../db/schema.js';
import { STORAGE, type ObjectStorage } from '../../infra/storage.js';

export interface UploadedDocument {
  buffer: Buffer;
  size: number;
}

type DocumentRow = typeof driverDocuments.$inferSelect;

const MAX_DOCUMENTS_PER_DRIVER = 30;

/** Ce que voit le chauffeur ou l'admin : jamais la clé de stockage. */
const publicView = ({ storageKey: _k, ...doc }: DocumentRow) => doc;

@Injectable()
export class DocumentsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(STORAGE) private readonly storage: ObjectStorage,
  ) {}

  async upload(driverId: string, input: { type: DocumentType; expiresAt?: string; file: UploadedDocument }) {
    const [profile] = await this.db.select().from(driverProfiles).where(eq(driverProfiles.userId, driverId));
    if (!profile) throw new AppError('NOT_A_DRIVER', 'Profil chauffeur inexistant', HttpStatus.FORBIDDEN);

    const sniffed = sniffFileType(input.file.buffer);
    if (!sniffed || (input.type === 'profile_photo' && sniffed.ext === 'pdf')) {
      throw new AppError('DOCUMENT_INVALID_TYPE', 'Formats acceptés : JPEG, PNG ou PDF (photo de profil : image)');
    }
    if (input.expiresAt && input.expiresAt < new Date().toISOString().slice(0, 10)) {
      throw new AppError('DOCUMENT_EXPIRED', 'Document déjà expiré');
    }
    if ((await this.listAll(driverId)).length >= MAX_DOCUMENTS_PER_DRIVER) {
      throw new AppError('TOO_MANY_DOCUMENTS', 'Trop de documents envoyés', HttpStatus.TOO_MANY_REQUESTS);
    }

    const storageKey = `drivers/${driverId}/${randomUUID()}.${sniffed.ext}`;
    await this.storage.put(storageKey, input.file.buffer);
    const [doc] = await this.db
      .insert(driverDocuments)
      .values({ driverId, type: input.type, storageKey, expiresAt: input.expiresAt })
      .returning();

    await this.refreshReviewState(driverId);
    return publicView(doc!);
  }

  /** Dernière version de chaque type de document. */
  async list(driverId: string) {
    const latest = new Map<DocumentType, DocumentRow>();
    for (const doc of await this.listAll(driverId)) if (!latest.has(doc.type)) latest.set(doc.type, doc);
    return [...latest.values()].map(publicView);
  }

  /** Pièces obligatoires dont la dernière version n'est pas approuvée ou est expirée. */
  async missingForApproval(driverId: string): Promise<DocumentType[]> {
    const today = new Date().toISOString().slice(0, 10);
    const latest = new Map((await this.list(driverId)).map((d) => [d.type, d]));
    return env().DRIVER_REQUIRED_DOCUMENTS.filter((type) => {
      const doc = latest.get(type);
      return !doc || doc.status !== 'approved' || (doc.expiresAt !== null && doc.expiresAt < today);
    });
  }

  async assertReadyForApproval(driverId: string) {
    const missing = await this.missingForApproval(driverId);
    if (missing.length > 0) {
      throw new AppError('DOCUMENTS_INCOMPLETE', 'Documents manquants ou non validés', HttpStatus.CONFLICT, { missing });
    }
  }

  async review(adminId: string, driverId: string, docId: string, status: 'approved' | 'rejected', reason?: string) {
    const [doc] = await this.db
      .select()
      .from(driverDocuments)
      .where(and(eq(driverDocuments.id, docId), eq(driverDocuments.driverId, driverId)));
    if (!doc) throw Errors.notFound('Document');

    const [reviewed] = await this.db
      .update(driverDocuments)
      .set({ status, reviewedBy: adminId, reviewedAt: new Date(), rejectionReason: status === 'rejected' ? reason : null })
      .where(and(eq(driverDocuments.id, docId), eq(driverDocuments.status, 'pending')))
      .returning();
    if (!reviewed) throw Errors.conflict('DOCUMENT_ALREADY_REVIEWED', 'Document déjà traité');

    // Un document refusé renvoie le dossier au chauffeur, qui doit en envoyer un nouveau.
    if (status === 'rejected') {
      await this.db
        .update(driverProfiles)
        .set({ status: 'pending_documents' })
        .where(and(eq(driverProfiles.userId, driverId), eq(driverProfiles.status, 'under_review')));
    }
    return publicView(reviewed);
  }

  /** Contenu d'un document, réservé au back-office. */
  async read(driverId: string, docId: string) {
    const [doc] = await this.db
      .select()
      .from(driverDocuments)
      .where(and(eq(driverDocuments.id, docId), eq(driverDocuments.driverId, driverId)));
    if (!doc) throw Errors.notFound('Document');
    const mime = mimeFromExt(extname(doc.storageKey).slice(1)) ?? 'application/octet-stream';
    return { data: await this.storage.get(doc.storageKey), mime };
  }

  /**
   * Dossier complet (toutes les pièces obligatoires envoyées, aucune refusée) : `pending_documents` → `under_review`,
   * ce qui le fait apparaître dans la file de validation de l'admin.
   */
  private async refreshReviewState(driverId: string) {
    const latest = new Map((await this.list(driverId)).map((d) => [d.type, d]));
    const complete = env().DRIVER_REQUIRED_DOCUMENTS.every((type) => {
      const doc = latest.get(type);
      return doc && doc.status !== 'rejected';
    });
    if (!complete) return;
    await this.db
      .update(driverProfiles)
      .set({ status: 'under_review' })
      .where(and(eq(driverProfiles.userId, driverId), eq(driverProfiles.status, 'pending_documents')));
  }

  private listAll(driverId: string) {
    return this.db
      .select()
      .from(driverDocuments)
      .where(eq(driverDocuments.driverId, driverId))
      .orderBy(desc(driverDocuments.createdAt));
  }
}
