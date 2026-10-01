import type { INestApplication } from '@nestjs/common';
import { ModulesContainer } from '@nestjs/core';
import { ApiBody, DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { z } from 'zod';
import { ZodPipe } from './common/zod.pipe.js';

// Clé de métadonnées Nest des arguments de route ; les entrées @Body() sont indexées `3:<index>` (RouteParamtypes.BODY).
const ROUTE_ARGS_METADATA = '__routeArguments__';
const BODY_PREFIX = '3:';
// Clé posée par @ApiConsumes (DECORATORS.API_CONSUMES de @nestjs/swagger, non exportée publiquement).
const API_CONSUMES_METADATA = 'swagger/apiConsumes';

/**
 * Les corps sont validés par `ZodPipe`, invisible pour Swagger : on convertit chaque schéma Zod
 * en JSON Schema et on l'attache au handler via `@ApiBody`.
 */
function documentZodBodies(app: INestApplication) {
  for (const module of app.get(ModulesContainer).values()) {
    for (const { metatype } of module.controllers.values()) {
      if (typeof metatype !== 'function') continue;
      const proto = metatype.prototype;
      for (const key of Object.getOwnPropertyNames(proto)) {
        const args: Record<string, { pipes?: unknown[] }> | undefined = Reflect.getMetadata(ROUTE_ARGS_METADATA, metatype, key);
        const pipe = Object.entries(args ?? {})
          .filter(([k]) => k.startsWith(BODY_PREFIX))
          .flatMap(([, a]) => a.pipes ?? [])
          .find((p): p is ZodPipe<z.ZodType> => p instanceof ZodPipe);
        // Les routes multipart (upload) décrivent déjà leur corps à la main : on ne l'écrase pas.
        if (!pipe || Reflect.hasMetadata(API_CONSUMES_METADATA, proto[key])) continue;
        const { $schema: _, ...schema } = z.toJSONSchema(pipe.schema, { io: 'input', unrepresentable: 'any' });
        ApiBody({ schema: schema as object })(proto, key, Object.getOwnPropertyDescriptor(proto, key)!);
      }
    }
  }
}

/** Swagger UI sur `/docs` (JSON brut sur `/docs-json`). */
export function setupSwagger(app: INestApplication) {
  documentZodBodies(app);
  const config = new DocumentBuilder()
    .setTitle('VTC Tunisie API')
    .setVersion('v1')
    .addBearerAuth()
    .addSecurityRequirements('bearer')
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, config), {
    swaggerOptions: { persistAuthorization: true },
  });
}
