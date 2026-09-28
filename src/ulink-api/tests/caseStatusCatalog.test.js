// Case status catalog: every status code a job sets has a label, description, module and group, so
// users never see a raw code. Scans the job code for the status literals it sets.

const fs = require('fs');
const path = require('path');
const { CASE_STATUSES, MODULES, GROUPS, codesInGroup } = require('../modules/case-status/catalog');

function statusesSetInCode() {
  const found = new Set();
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const file = path.join(dir, name);
      if (fs.statSync(file).isDirectory()) walk(file);
      else if (file.endsWith('.js')) {
        const src = fs.readFileSync(file, 'utf8');
        for (const m of src.matchAll(/(?:currentStatus|nextStatus|inputStatus)\s*:\s*(\[[^\]]*\]|'[A-Z][A-Z_]+')/g)) {
          for (const c of m[1].matchAll(/'([A-Z][A-Z_]+)'/g)) found.add(c[1]);
        }
        for (const m of src.matchAll(/_TO_STATUS\s*=\s*\{([^}]*)\}/g)) {
          for (const c of m[1].matchAll(/:\s*'([A-Z][A-Z_]+)'/g)) found.add(c[1]);
        }
      }
    }
  };
  walk(path.join(__dirname, '..', 'modules'));
  return [...found];
}

it('covers every status the jobs set', () => {
  const scanned = statusesSetInCode();
  expect(scanned.length).toBeGreaterThan(20); // the scan itself still works
  expect(scanned.filter((code) => !CASE_STATUSES[code])).toEqual([]);
});

it('gives every status a label, a description, a known module and a known group', () => {
  const modules = MODULES.map((m) => m.id);
  const groups = GROUPS.map((g) => g.id);
  for (const [code, info] of Object.entries(CASE_STATUSES)) {
    expect({ code, ok: Boolean(info.label && info.description) && modules.includes(info.module) && groups.includes(info.group) })
      .toEqual({ code, ok: true });
  }
});

it('lists the codes in a group', () => {
  expect(codesInGroup('needs_review')).toEqual(expect.arrayContaining(['MEMBER_REVIEW_REQUIRED', 'API_MANUAL_REVIEW']));
  expect(codesInGroup('needs_review')).not.toContain('CSR_SENT');
});
