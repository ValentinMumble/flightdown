/** Manoeuvres a pilot practises, roughly in the order they are learnt. */
export const SKILLS = [
  'Hover',
  'Orientation',
  'Landings',
  'Circles',
  'Figure 8',
  'Forward flight',
  'Loops',
  'Flips',
  'Rolls',
  'Inverted',
  'Hurricanes',
  'Funnels',
  'Piros',
  'Autorotation',
  'FPV',
];

const HINTS: [RegExp, string][] = [
  [/(?<!inverted )\bhover/i, 'Hover'],
  [/orientation|nose[- ]in/i, 'Orientation'],
  [/landing/i, 'Landings'],
  [/circle/i, 'Circles'],
  [/figure[- ]?8|figure[- ]eight|\b8s\b/i, 'Figure 8'],
  [/forward flight/i, 'Forward flight'],
  [/loop/i, 'Loops'],
  [/\bflips?\b/i, 'Flips'],
  [/\broll(s|ing)?\b/i, 'Rolls'],
  [/inverted/i, 'Inverted'],
  [/hurrican/i, 'Hurricanes'],
  [/funnel/i, 'Funnels'],
  [/\bpiro/i, 'Piros'],
  [/auto[- ]?rotation/i, 'Autorotation'],
  [/fpv|goggles/i, 'FPV'],
];

/** The manoeuvres a sortie's notes mention, for logs written before Flightdown asked. */
export function inferSkills(notes: string) {
  return SKILLS.filter(skill => HINTS.some(([pattern, name]) => name === skill && pattern.test(notes)));
}
