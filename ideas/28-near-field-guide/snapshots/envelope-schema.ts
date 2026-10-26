import { z } from 'zod';

const confidenceSchema = z.enum(['measured', 'derived', 'assumed']);

const sourceRefSchema = z.union([
  z.object({
    id: z.string().optional(),
    kind: z.literal('repo'),
    path: z.string(),
    commit: z.string(),
    confidence: confidenceSchema,
    note: z.string().optional()
  }),
  z.object({
    id: z.string().optional(),
    kind: z.literal('external'),
    name: z.string(),
    url: z.string().optional(),
    retrieved: z.string(),
    confidence: confidenceSchema,
    note: z.string().optional()
  }),
  z.object({
    id: z.string().optional(),
    kind: z.literal('computation'),
    method: z.string(),
    code: z.object({
      path: z.string(),
      commit: z.string()
    }),
    confidence: z.literal('derived'),
    note: z.string().optional()
  })
]);

export const evidenceEnvelopeOutputSchema = z.object({
  envelope_version: z.literal('1'),
  tool: z.string(),
  as_of: z.string().optional(),
  value: z.unknown().nullable(),
  confidence: confidenceSchema,
  provenance: z.array(sourceRefSchema),
  assumptions: z.array(z.string()),
  validity_envelope: z.string(),
  coverage: z.object({
    returned: z.number(),
    total: z.number(),
    selection_rule: z.string()
  }).optional(),
  refusal: z.object({
    code: z.enum(['insufficient_data', 'out_of_envelope', 'not_found']),
    reason: z.string(),
    what_would_help: z.string()
  }).optional()
});
