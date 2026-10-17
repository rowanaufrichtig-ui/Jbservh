import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isMaths, roleOf, ectAssessment, teachesKS5, contractOf, workingPatternOf, payAreaFromText, looksPrimary } from '../scripts/lib/classify.mjs';

test('maths roles are recognised', () => {
  assert.ok(isMaths({ title: 'Teacher of Mathematics' }));
  assert.ok(isMaths({ title: 'Teacher', subjects: 'Mathematics' }));
  assert.ok(!isMaths({ title: 'Teacher of Science', subjects: 'Science' }));
});

test('roles are classified from the job title', () => {
  assert.equal(roleOf('Teacher of Maths'), 'teacher');
  assert.equal(roleOf('Lecturer Maths (0.8 FTE)'), 'teacher');
  assert.equal(roleOf('Second in Charge Maths'), 'leadership');
  assert.equal(roleOf('KS5 Lead for Maths'), 'leadership');
  assert.equal(roleOf('Head of Maths Teacher'), 'leadership');
  assert.equal(roleOf('Trainee Teacher of Secondary Mathematics'), 'trainee');
  assert.equal(roleOf('Curriculum Teaching Assistant - Maths'), 'support');
  assert.equal(roleOf('A-Level Maths Tutor'), 'tutor');
  assert.equal(roleOf('Speculative Application'), 'speculative');
});

test('ECT suitability', () => {
  const flagged = ectAssessment({ title: 'Teacher of Maths', ectFlags: ['TES Jobs'] }, 'teacher');
  assert.equal(flagged.status, 'yes');

  const mentioned = ectAssessment({ title: 'Teacher of Maths', text: 'We welcome applications from ECTs and offer a strong mentor programme.' }, 'teacher');
  assert.equal(mentioned.status, 'yes');
  assert.ok(mentioned.signals.includes('Mentoring'));

  const refused = ectAssessment({ title: 'Teacher of Maths', text: 'This post is not suitable for ECTs.', ectFlags: ['MyNewTerm'] }, 'teacher');
  assert.equal(refused.status, 'no');

  const experienced = ectAssessment({ title: 'Teacher of Maths', text: 'You will have a minimum of three years teaching experience.' }, 'teacher');
  assert.equal(experienced.status, 'no');

  assert.equal(ectAssessment({ title: 'Teacher of Maths', salary: 'MPS' }, 'teacher').status, 'likely');
  assert.equal(ectAssessment({ title: 'Head of Maths', ectFlags: ['TES Jobs'] }, 'leadership').status, 'no');
  assert.equal(ectAssessment({ title: 'Trainee Teacher' }, 'trainee').status, 'training');
});

test('sixth form, contract, hours and pay area', () => {
  assert.ok(teachesKS5({ title: 'Teacher of Maths (A Level)' }));
  assert.ok(teachesKS5({ title: 'Teacher of Maths', keyStages: 'Key stage 4, Key stage 5' }));
  assert.ok(!teachesKS5({ title: 'Teacher of Maths', text: 'Teaching KS3 and KS4' }));
  assert.equal(contractOf({ title: 'Teacher of Mathematics (Maternity Cover)' }), 'Maternity cover');
  assert.equal(contractOf({ title: 'Teacher of Maths ( 1 Year Fixed Term)' }), 'Fixed term');
  assert.equal(contractOf({ title: 'Teacher of Maths', contract: 'Permanent' }), 'Permanent');
  assert.equal(workingPatternOf({ title: 'Teacher of Maths, Fixed Term, Part time' }), 'Part time');
  assert.equal(payAreaFromText("Teachers' Pay Scales (Inner London)"), 'Inner London');
  assert.equal(payAreaFromText('MPS/UPS (Outer London) + £1,500'), 'Outer London');
  assert.ok(looksPrimary({ title: 'Maths Lead', phase: 'Primary' }));
  assert.ok(!looksPrimary({ title: 'Maths Teacher - KS3/4' }));
});
