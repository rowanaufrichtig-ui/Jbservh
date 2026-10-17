// Rules that turn a raw advert into the fields the site filters on:
// what kind of role it is, how suitable it is for an early career teacher
// (ECT), whether it involves sixth form teaching, and so on.

export const isMaths = (job) =>
  /math|numeracy|statistic/i.test(job.title) || /mathematics|maths/i.test(job.subjects ?? '');

const ROLE_RULES = [
  ['speculative', /speculative|expression of interest|talent pool|register (your )?interest|general application|future vacanc/i],
  ['trainee', /trainee|train to (become|teach)|teacher training|salaried|scitt|pgce|initial teacher|unqualified teacher|graduate teach(er|ing)|apprentice/i],
  ['leadership', /head of|\bhod\b|director|lead practitioner|leader|\blead\b|second in (charge|department)|\b2ic\b|deputy|assistant (head|principal)|vice principal|co-?ordinator|principal\b|curriculum manager|faculty/i],
  ['support', /teaching assistant|\bta\b|\bhlta\b|learning support|cover supervisor|instructor|technician|learning mentor|graduate tutor|intervention|invigilat|academic mentor/i],
  ['tutor', /\btutors?\b/i],
  ['teacher', /teacher|teaching|lecturer|educator|\bmaths\b|mathematics/i],
];

export function roleOf(title) {
  for (const [role, re] of ROLE_RULES) if (re.test(title)) return role;
  return 'other';
}

const ECT_MENTION = /\b(ECTs?|NQTs?|early[- ]career (teachers?|framework)|newly[- ]qualified|ECF)\b/i;
const ECT_REFUSED =
  /(not|unable to|cannot|can't|won't)\s+(be\s+)?(suitable|consider(ed)?|accept(ed)?|open)\b[^.]{0,40}\b(ECTs?|NQTs?|early career)|\b(ECTs?|NQTs?)\s+(are\s+|will\s+)?(not|unable)\b|not suitable for (an? )?(ECT|NQT|early career)/i;
const EXPERIENCE_REQUIRED = /\b(minimum|at least|min\.?)\s+(of\s+)?(two|three|four|five|\d)\s+years'?\s+(of\s+)?(teaching\s+)?experience|experienced teachers? only|UPS only/i;

const SIGNALS = [
  ['Mentoring', /mentor/i],
  ['ECT induction / ECF', /induction|early career framework|\bECF\b|\bECT programme/i],
  ['Training & CPD', /\bCPD\b|professional development|professional learning|coaching/i],
  ['Reduced timetable', /reduced timetable|10% (timetable )?reduction|non-contact time/i],
  ['Wellbeing / workload', /wellbeing|well-being|workload/i],
];

export function ectAssessment(job, role) {
  const text = `${job.title}\n${job.text ?? ''}`;
  const reasons = [];
  const signals = SIGNALS.filter(([, re]) => re.test(text)).map(([s]) => s);
  let status;

  if (role === 'trainee') status = 'training';
  else if (role === 'support' || role === 'tutor' || role === 'other') status = 'n/a';
  else if (role === 'leadership') {
    status = 'no';
    reasons.push('Leadership / TLR role – usually for experienced teachers');
  } else if (ECT_REFUSED.test(text)) {
    status = 'no';
    reasons.push('Advert says it is not open to ECTs');
  } else if (job.ectFlags?.length) {
    status = 'yes';
    reasons.push(`Marked suitable for ECTs on ${job.ectFlags.join(', ')}`);
  } else if (ECT_MENTION.test(text)) {
    status = 'yes';
    reasons.push('Advert mentions ECTs / early career teachers');
  } else if (EXPERIENCE_REQUIRED.test(text)) {
    status = 'no';
    reasons.push('Asks for several years of experience');
  } else {
    status = 'likely';
    reasons.push('Classroom teacher role – ECTs can usually apply; check the advert');
  }
  if (status === 'likely' && /\b(MPS|main pay|M1|MPR|teachers'? pay)/i.test(`${job.salary ?? ''} ${text}`)) {
    reasons.push('Paid on the main pay scale');
  }
  return { status, reasons, signals };
}

export const teachesKS5 = (job) =>
  /\b(a[- ]?levels?|ks5|key stage 5|sixth[- ]form|6th form|post[- ]?16|16[- ]19|further math(s|ematics)|year 1[23])\b/i.test(
    `${job.title}\n${job.keyStages ?? ''}\n${job.text ?? ''}`,
  );

export function contractOf(job) {
  const s = `${job.title} ${job.contract ?? ''}`;
  if (/maternity|parental|mat cover/i.test(s)) return 'Maternity cover';
  if (/fixed[- ]term|temporary|\btemp\b|one year|1 year|interim/i.test(s)) return 'Fixed term';
  if (/supply|daily rate|per day|casual|sessional/i.test(`${s} ${job.salary ?? ''}`)) return 'Supply / sessional';
  if (/permanent/i.test(s)) return 'Permanent';
  return job.contract || null;
}

export function workingPatternOf(job) {
  const s = `${job.title} ${job.workingPattern ?? ''}`;
  const full = /full[- ]?time/i.test(s), part = /part[- ]?time|\b0\.\d\b|fte|job share/i.test(s);
  if (full && part) return 'Full or part time';
  if (part) return 'Part time';
  if (full) return 'Full time';
  return null;
}

export function payAreaFromText(s = '') {
  if (/inner[- ]london/i.test(s)) return 'Inner London';
  if (/outer[- ]london/i.test(s)) return 'Outer London';
  if (/fringe/i.test(s)) return 'Fringe';
  return null;
}

const PRIMARY = /\bprimary\b|\bprep(aratory)?\b|\binfant|\bjunior\b|\bKS1\b|\bKS2\b|key stage [12]\b|\bEYFS\b|nursery/i;
export const looksPrimary = (job) => PRIMARY.test(`${job.title} ${job.phase ?? ''}`) && !/secondary|KS3|KS4|all[- ]through/i.test(`${job.title} ${job.phase ?? ''}`);

// Places outside London that turn up in "London" searches.
export const NON_LONDON_TITLE = /\b(Manchester|Oldham|Birmingham|Leeds|Liverpool|Bristol|Sheffield|Nottingham|Leicester|Hertfordshire|Berkshire|Slough|Watford|Luton|Milton Keynes|Brighton|Dubai|Abu Dhabi|Morocco|China|Spain)\b/i;

export function toDate(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
