import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HONEYPOT_FIELD, honeypotAttributes, isHoneypotFilled } from './honeypot.ts';

const form = (entries: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(entries)) data.append(k, v);
  return data;
};

test('an empty or absent honeypot is a human', () => {
  assert.equal(isHoneypotFilled(form({})), false);
  assert.equal(isHoneypotFilled(form({ website: '' })), false);
  assert.equal(isHoneypotFilled(form({ website: '   ' })), false, 'whitespace is not a fill');
});

test('any real value is a bot', () => {
  assert.equal(isHoneypotFilled(form({ website: 'http://spam.example' })), true);
});

test('the field name is configurable, so a real "website" field is possible', () => {
  /*
   * Reserving one name across a whole fleet means the first client whose form genuinely asks for
   * a website has every submission silently treated as spam.
   */
  const data = form({ website: 'https://a-real-clients-site.com', hp_url: '' });
  assert.equal(isHoneypotFilled(data, 'hp_url'), false, 'the real field is not the trap');
  assert.equal(isHoneypotFilled(data), true, 'and the default would have caught it wrongly');
});

test('the rendering contract carries all four parts', () => {
  // Get any one wrong and it catches real people, whose submission vanishes with a cheerful
  // confirmation - the worst failure a contact form has.
  const attrs = honeypotAttributes();
  assert.equal(attrs.name, HONEYPOT_FIELD);
  assert.equal(attrs['aria-hidden'], 'true');
  assert.equal(attrs.tabindex, '-1');
  assert.equal(attrs.autocomplete, 'off');
  assert.match(attrs.class, /honeypot/);
});
