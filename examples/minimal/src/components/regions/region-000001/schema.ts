import { z } from 'astro/zod';

export const schema = z.object({
  type: z.literal('region-000001'),
});
