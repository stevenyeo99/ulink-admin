export type Audience = 'customer' | 'internal';

// Shared tint for anything that shows who an email goes to — customer-facing vs. internal
// ops (SOP §11/§13, see pipelineGraph.ts's StaticEdge.audience doc comment). Single source
// so the edge-label pill and the email badge node never drift out of sync on color.
export const AUDIENCE_STYLE: Record<Audience, string> = {
  customer: 'bg-sky-50 text-sky-700',
  internal: 'bg-violet-50 text-violet-700',
};
