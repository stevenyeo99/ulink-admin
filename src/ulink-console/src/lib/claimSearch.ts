/** A list item that a claim search can find: the IAS claim no. and the TPA case no. */
export interface ClaimNumbers {
  claimNo: string | null;
  tpaCaseNumber: string | null;
}

/** True when the claim no. or the TPA case no. contains the text (upper or lower case); an empty text matches all. */
export function matchesClaim(item: ClaimNumbers, text: string): boolean {
  const q = text.trim().toLowerCase();
  if (!q) return true;
  return [item.claimNo, item.tpaCaseNumber].some((value) => value?.toLowerCase().includes(q));
}
