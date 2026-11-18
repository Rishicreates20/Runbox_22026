import { z } from "zod";

/**
 * Branded identifiers. A ProblemSlug and a SubmissionId are both strings at
 * runtime, but the brand stops one being passed where the other is expected.
 */
export const ProblemSlug = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "lowercase words separated by '-'")
  .max(64)
  .brand<"ProblemSlug">();
export type ProblemSlug = z.infer<typeof ProblemSlug>;

export const SubmissionId = z.uuid().brand<"SubmissionId">();
export type SubmissionId = z.infer<typeof SubmissionId>;

/** Anonymous per-browser id, kept in a cookie. */
export const ClientId = z
  .string()
  .regex(/^[A-Za-z0-9_-]{16,64}$/)
  .brand<"ClientId">();
export type ClientId = z.infer<typeof ClientId>;
