// GitHub rejects an issue form it can't parse or that breaks its rules, and only says so to
// signed-in users on the form page. These tests run the same checks on every push.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { load } from 'js-yaml';

const DIR = path.join(__dirname, '../../.github/ISSUE_TEMPLATE');
const TYPES = ['markdown', 'textarea', 'input', 'dropdown', 'checkboxes'];

/** The problems GitHub would reject a form for. Throws if the YAML doesn't parse. */
export function formProblems(text: string): string[] {
  const form = load(text) as any;
  const problems: string[] = [];
  for (const key of ['name', 'description', 'body']) if (!form?.[key]) problems.push(`missing ${key}`);
  const fields = (form?.body ?? []) as any[];
  const seen = { id: new Set<string>(), label: new Set<string>() };
  for (const [i, f] of fields.entries()) {
    const where = `body[${i}]`;
    if (!TYPES.includes(f.type)) problems.push(`${where}: unknown type ${f.type}`);
    if (f.type === 'markdown') { if (!f.attributes?.value) problems.push(`${where}: markdown needs a value`); continue; }
    const label = f.attributes?.label;
    if (!label) problems.push(`${where}: needs a label`);
    else if (seen.label.has(label)) problems.push(`${where}: duplicate label "${label}"`);
    else seen.label.add(label);
    if (f.id !== undefined) {
      if (!/^[\w-]+$/.test(f.id)) problems.push(`${where}: id "${f.id}" may use only letters, digits, - and _`);
      else if (seen.id.has(f.id)) problems.push(`${where}: duplicate id "${f.id}"`);
      else seen.id.add(f.id);
    }
    if (f.type === 'dropdown') {
      const options = f.attributes?.options;
      if (!Array.isArray(options) || !options.length) problems.push(`${where}: dropdown needs options`);
      else if (options.some((o: unknown) => typeof o !== 'string')) problems.push(`${where}: options must be text (quote numbers)`);
      else if (new Set(options).size !== options.length) problems.push(`${where}: duplicate options`);
    }
  }
  return problems;
}

for (const file of fs.readdirSync(DIR).filter(f => /\.ya?ml$/.test(f) && f !== 'config.yml')) {
  test(`issue form ${file} is valid`, () => {
    assert.deepEqual(formProblems(fs.readFileSync(path.join(DIR, file), 'utf8')), []);
  });
}

test('the check catches what broke the feedback form', () => {
  const form = (description: string) => `name: F\ndescription: D\nbody:\n  - type: input\n    id: v\n    attributes:\n      label: Version\n      description: ${description}\n`;
  assert.throws(() => formProblems(form('Filled in by "Earworm: Send Feedback". Edit it.')), /bad indentation/);
  assert.deepEqual(formProblems(form(`'Filled in by "Earworm: Send Feedback". Edit it.'`)), []);
  assert.deepEqual(formProblems('name: F\ndescription: D\nbody:\n  - type: dropdown\n    attributes:\n      label: R\n      options: [5, 4]\n'),
    ['body[0]: options must be text (quote numbers)']);
});
