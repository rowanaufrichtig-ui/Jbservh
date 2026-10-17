// Link a job advert to a London school, using (in order) the DfE URN the job
// board gave us, the postcode, then a fuzzy match on the school's name.

import { nameKey, nameSimilarity, normPostcode } from './text.mjs';

export function buildMatcher(establishments, schools) {
  const schoolByUrn = new Map(schools.map((s) => [s.urn, s]));
  const byUrn = new Map(establishments.map((e) => [e.urn, e]));
  const byPostcode = new Map();
  const byKey = new Map();
  for (const e of establishments) {
    const pc = normPostcode(e.postcode);
    if (pc) byPostcode.set(pc, [...(byPostcode.get(pc) ?? []), e]);
    byKey.set(nameKey(e.name), e);
  }

  function best(candidates, name, threshold) {
    let top = null, score = 0;
    for (const e of candidates) {
      const s = nameSimilarity(name, e.name);
      if (s > score) [top, score] = [e, s];
    }
    return score >= threshold ? top : null;
  }

  return function match(job) {
    let est = job.urn ? byUrn.get(job.urn) : null;
    const name = job.employer ?? '';
    if (!est && name) est = byKey.get(nameKey(name)) ?? null;
    const pc = normPostcode(job.postcode);
    if (!est && pc && byPostcode.has(pc)) {
      const here = byPostcode.get(pc);
      est = best(here, name, 0.25);
    }
    if (!est && name) est = best(establishments, name, 0.75);
    if (!est) return { establishment: null, school: null };
    return { establishment: est, school: schoolByUrn.get(est.urn) ?? null };
  };
}
