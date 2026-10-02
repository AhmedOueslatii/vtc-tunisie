import { Controller, Get, Header, Param, ParseUUIDPipe, Query, StreamableFile } from '@nestjs/common';
import { z } from 'zod';
import { ZodPipe } from '../../common/zod.pipe.js';
import { Public } from '../auth/auth.guard.js';
import { DocumentsService } from './documents.service.js';

const linkSchema = z.object({
  e: z.coerce.number().int().positive(),
  a: z.uuid(),
  s: z.string().min(20).max(100),
});

/**
 * Lecture d'un scan par lien signé (voir `document-links.ts`). Route publique : la signature tient lieu d'authentification,
 * le navigateur de l'admin l'appelle directement. Jamais mise en cache, jamais interprétée comme autre chose que le fichier.
 */
@Public()
@Controller('documents')
export class DocumentFilesController {
  constructor(private readonly documents: DocumentsService) {}

  @Get(':docId/file')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Referrer-Policy', 'no-referrer')
  async file(@Param('docId', ParseUUIDPipe) docId: string, @Query(new ZodPipe(linkSchema)) query: z.infer<typeof linkSchema>) {
    const { data, mime } = await this.documents.readSigned(docId, { exp: query.e, adminId: query.a, signature: query.s });
    return new StreamableFile(data, { type: mime, disposition: 'inline' });
  }
}
