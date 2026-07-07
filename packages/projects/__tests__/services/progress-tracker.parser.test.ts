import { describe, it, expect } from '@jest/globals';
import { parseResolvedGates } from '../../services/progress-tracker.parser';

describe('parseResolvedGates', () => {
  it('resolves a checked task-list item to its canonical gate', () => {
    const md = '- [x] 1.4 SRS approved — 2026-07-03';
    expect([...parseResolvedGates(md)]).toEqual(['SRS approved']);
  });

  it('ignores an UNCHECKED item even if it names a gate', () => {
    const md = '- [ ] 1.4 SRS approved';
    expect(parseResolvedGates(md).size).toBe(0);
  });

  it('resolves an "approved by" line (no checkbox)', () => {
    const md = 'Design docs approved by Faraz on 2026-07-01';
    expect([...parseResolvedGates(md)]).toEqual(['Design docs approved']);
  });

  it('resolves gate aliases via the shared matcher', () => {
    const md = '- [x] spec file approved by Tariq';
    expect([...parseResolvedGates(md)]).toEqual(['Spec strategy approved']);
  });

  it('de-duplicates a gate mentioned on multiple resolved lines', () => {
    const md = ['- [x] SRS approved', 'SRS approved by SA in the review call'].join('\n');
    expect([...parseResolvedGates(md)]).toEqual(['SRS approved']);
  });

  it('collects multiple distinct resolved gates', () => {
    const md = [
      '# Project Progress',
      '- [x] 1.4 SRS approved',
      '- [ ] 2.1 Design docs approved', // unchecked → ignored
      '- [x] Implementation plan approved by Faraz',
      'Code approved by Tech Lead',
      'just a routine note about the srs', // no marker → ignored
    ].join('\n');
    const got = parseResolvedGates(md);
    expect(got.has('SRS approved')).toBe(true);
    expect(got.has('Implementation plan approved')).toBe(true);
    expect(got.has('Code approved')).toBe(true);
    expect(got.has('Design docs approved')).toBe(false); // was unchecked
    expect(got.size).toBe(3);
  });

  it('ignores marker lines that match no gate', () => {
    const md = '- [x] Set up Slack channel';
    expect(parseResolvedGates(md).size).toBe(0);
  });

  it('handles empty / whitespace input', () => {
    expect(parseResolvedGates('').size).toBe(0);
    expect(parseResolvedGates('\n\n   \n').size).toBe(0);
  });

  it('tolerates CRLF line endings and `*` bullets', () => {
    const md = '* [x] SRS approved\r\n* [ ] Runbooks approved';
    expect([...parseResolvedGates(md)]).toEqual(['SRS approved']);
  });
});
