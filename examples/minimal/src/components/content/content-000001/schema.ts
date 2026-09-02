import { z } from 'astro/zod';

export const schema = z.object({
  type: z.literal('content-000001'),
  heading: z.string().optional(),
  body: z.array(z.string()).default([]),
});
