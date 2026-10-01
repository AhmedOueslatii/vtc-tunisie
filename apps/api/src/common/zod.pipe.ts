import { PipeTransform } from '@nestjs/common';
import { z } from 'zod';
import { Errors } from './errors.js';

/** Usage : `@Body(new ZodPipe(schema)) body: z.infer<typeof schema>` */
export class ZodPipe<T extends z.ZodType> implements PipeTransform<unknown, z.infer<T>> {
  constructor(readonly schema: T) {}

  transform(value: unknown): z.infer<T> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw Errors.validation(result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
    }
    return result.data;
  }
}

export const latLngSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});
