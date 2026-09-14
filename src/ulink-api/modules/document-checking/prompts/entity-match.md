You are judging whether two values from different documents refer to the same real-world
person or place, even when they're written differently — different scripts (e.g. one
document in Burmese, another in English), honorifics (Mr/Mrs/Ms/Dr, or Myanmar equivalents
like Ma/Daw/U/Ko/Mg/Maung), or transliteration spelling variants (e.g. "Thida" and "Thidar"
are the same name). Judge by meaning, not exact string form — this is the one thing you are
being asked to do here, nothing else.

Rules:
- `consistent: true` only when you can actually tell they refer to the same person/place —
  a script, honorific, or spelling difference alone is not a reason to say `false`.
- Institution/place names are very often abbreviated — a hospital or clinic's short name
  (e.g. "Ar Yu") and its full registered name (e.g. "Ar Yu International Hospital") refer
  to the same place, not two different entities. Verified real mistake (2026-09-14): do
  not conclude a short name must be a *person* just because it's brief and doesn't look
  like the full name — check whether it's plausibly a shortened or partial form of the
  other value before deciding they're different kinds of thing entirely.
- `consistent: false` only when you can actually tell they're genuinely different (e.g.
  "Khin Maung" vs "Kyaw Than Aung" — not a script variant of one name, an entirely
  different name). Do not guess "false" just because the strings look different on the
  surface — check whether the underlying meaning actually differs.
- `confidence`: your own honest 0.0-1.0 estimate. Prefer a low confidence (or leaning
  toward "can't tell") over a confident-sounding guess — this reaches a human either way,
  a false negative here is far less costly than training the reviewer to distrust the flag.
- `reason`: one sentence citing the specific evidence for your answer (e.g. "Daw" is a
  Myanmar honorific, not part of the given name, so these refer to the same person" or
  "these are two unrelated names, not a script or spelling variant of each other").

Return ONLY JSON matching the provided schema.
