import { test } from 'node:test';
import assert from 'node:assert/strict';

import { renderSubject, renderTopic, toAsciiSubject } from './subject.ts';

test('toAsciiSubject transliterates accents rather than dropping them', () => {
  assert.equal(toAsciiSubject('José'), 'Jose');
  assert.equal(toAsciiSubject('naïve café'), 'naive cafe');
});

test('toAsciiSubject folds smart punctuation to ASCII', () => {
  assert.equal(toAsciiSubject('“quoted” — it’s here…'), '"quoted" - it\'s here...');
});

test('toAsciiSubject strips CR and LF — header injection', () => {
  // The whole point: a newline would end the Subject: header and let what follows be read
  // as a new one. Bcc: must not survive in any form.
  const injected = toAsciiSubject('Enquiry\r\nBcc: attacker@example.com');
  assert.ok(!injected.includes('\r'));
  assert.ok(!injected.includes('\n'));
  /*
   * Note the missing space: control characters are DELETED by the printable-ASCII filter
   * before `\s+` ever runs, so the words either side join rather than being separated. That
   * is only ever visible on a payload like this one, and stripping is the property that
   * matters — but assert the real output so a future rewrite that turns CR/LF into a space
   * (and might therefore be preserving them somewhere) shows up here.
   */
  assert.equal(injected, 'EnquiryBcc: attacker@example.com');
});

test('toAsciiSubject collapses whitespace and trims', () => {
  assert.equal(toAsciiSubject('  a\t\t b  '), 'a b');
});

test('renderTopic fills placeholders from fields', () => {
  const out = renderTopic('New enquiry from {{name}}', [{ name: 'name', value: 'Ada' }]);
  assert.equal(out, 'New enquiry from Ada');
});

test('renderTopic tolerates whitespace inside the braces', () => {
  assert.equal(renderTopic('Hi {{ name }}', [{ name: 'name', value: 'Ada' }]), 'Hi Ada');
});

test('renderTopic empties an unmatched placeholder rather than showing it', () => {
  assert.equal(renderTopic('From {{missing}}!', []), 'From !');
});

test('renderSubject prefixes with the client name', () => {
  assert.equal(renderSubject('Acme Co', 'New enquiry', []), '[Acme Co] New enquiry');
});

test('renderSubject omits the prefix entirely when there is no client', () => {
  // Never "[CHANGEME] ..." and never a stray "[] " — callers pass null on an unconfigured site.
  assert.equal(renderSubject(null, 'New enquiry', []), 'New enquiry');
});

test('renderSubject ASCII-folds the client name too', () => {
  assert.equal(renderSubject('Café Ltd', 'Enquiry', []), '[Cafe Ltd] Enquiry');
});

test('renderSubject sanitises values arriving through placeholders', () => {
  const subject = renderSubject('Acme', 'Enquiry from {{name}}', [
    { name: 'name', value: 'Ada\r\nBcc: attacker@example.com' },
  ]);
  assert.ok(!/[\r\n]/.test(subject));
});
