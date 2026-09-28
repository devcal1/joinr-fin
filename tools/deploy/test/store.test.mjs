// Checks of the store clone's app folders (stage-7.md §7.3, §7.7, §8.4 item 4). Skipped when the
// clone is absent (JOINR_STORE_DIR, default ../tenon-umbrel-store). No YAML library: the files use
// a small subset (block maps, scalar lists, `{}`), read by the parser below.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REGISTRY_IMAGE, parseComposeImage } from '../lib.mjs';
import { HAS_REAL_STORE, REAL_STORE_DIR } from './helpers.mjs';

/** The fields `REQUIRED_MANIFEST_FIELDS` names (as the sibling manifest lists them). */
const REQUIRED = [
  'manifestVersion', 'id', 'category', 'name', 'version', 'tagline', 'description', 'developer',
  'website', 'dependencies', 'repo', 'support', 'port', 'gallery', 'path', 'submitter', 'submission',
]; // prettier-ignore

/** A tiny YAML subset reader: block maps, `- scalar` lists, folded `>-` scalars, `{}` and `[]`. */
export function parseYamlSubset(text) {
  const lines = text
    .split('\n')
    .map((raw) => raw.replace(/\s+#(?![^'"]*['"][^'"]*$).*$/, '').replace(/\s+$/, ''))
    .filter((l) => l.trim() !== '' && !l.trimStart().startsWith('#'));
  const scalar = (v) => {
    const t = v.trim();
    if (t === '{}') return {};
    if (t === '[]') return [];
    if (/^'.*'$/.test(t)) return t.slice(1, -1).replace(/''/g, "'");
    if (/^".*"$/.test(t)) return t.slice(1, -1);
    if (/^-?\d+$/.test(t)) return Number(t);
    return t;
  };
  let i = 0;
  const indentOf = (l) => l.length - l.trimStart().length;
  function block(indent) {
    const first = lines[i];
    if (first !== undefined && indentOf(first) === indent && first.trimStart().startsWith('- ')) {
      const list = [];
      while (
        i < lines.length &&
        indentOf(lines[i]) === indent &&
        lines[i].trimStart().startsWith('- ')
      ) {
        list.push(scalar(lines[i].trimStart().slice(2)));
        i++;
      }
      return list;
    }
    const map = {};
    while (i < lines.length && indentOf(lines[i]) === indent) {
      const m = /^([A-Za-z0-9_.-]+):(?:\s(.*))?$/.exec(lines[i].trimStart());
      if (!m) throw new Error(`cannot read line: ${lines[i]}`);
      i++;
      const [, key, rest] = m;
      if (rest === '>-' || rest === '>' || rest === '|') {
        const parts = [];
        while (i < lines.length && indentOf(lines[i]) > indent) parts.push(lines[i++].trim());
        map[key] = parts.join(' ');
      } else if (rest === undefined || rest === '') {
        map[key] =
          i < lines.length && indentOf(lines[i]) > indent ? block(indentOf(lines[i])) : null;
      } else {
        map[key] = scalar(rest);
      }
    }
    return map;
  }
  return block(0);
}

/** A minimal well-formedness check: balanced tags, one root, attributes quoted. */
function checkXml(text) {
  const body = text.replace(/<!--[\s\S]*?-->/g, '').trim();
  const stack = [];
  let roots = 0;
  for (const m of body.matchAll(/<(\/?)([A-Za-z][\w:.-]*)((?:\s+[\w:.-]+="[^"]*")*)\s*(\/?)>/g)) {
    const [, close, name, , self] = m;
    if (close) {
      if (stack.pop() !== name) throw new Error(`mismatched </${name}>`);
    } else if (!self) {
      if (stack.length === 0) roots++;
      stack.push(name);
    } else if (stack.length === 0) {
      roots++;
    }
  }
  const tags = body.match(/<[^>]*>/g) ?? [];
  const parsed = [...body.matchAll(/<(\/?)([A-Za-z][\w:.-]*)((?:\s+[\w:.-]+="[^"]*")*)\s*(\/?)>/g)]
    .length;
  if (tags.length !== parsed) throw new Error('a tag that is not well formed');
  if (stack.length !== 0 || roots !== 1) throw new Error('unbalanced or several roots');
  return true;
}

const read = (...p) => readFileSync(join(REAL_STORE_DIR, ...p), 'utf8');
const manifests = () =>
  readdirSync(REAL_STORE_DIR)
    .filter((d) => existsSync(join(REAL_STORE_DIR, d, 'umbrel-app.yml')))
    .map((d) => ({ folder: d, m: parseYamlSubset(read(d, 'umbrel-app.yml')) }));

describe.skipIf(!HAS_REAL_STORE)('the store clone', () => {
  it('the YAML reader understands the sibling manifest', () => {
    const sib = parseYamlSubset(read('tenon-joinr-backup', 'umbrel-app.yml'));
    expect(sib.id).toBe('tenon-joinr-backup');
    expect(sib.port).toBe(4931);
  });

  describe.each(['tenon-joinr-finance', 'tenon-joinr-registry'])('%s manifest', (app) => {
    const m = parseYamlSubset(read(app, 'umbrel-app.yml'));
    const sib = parseYamlSubset(read('tenon-joinr-backup', 'umbrel-app.yml'));

    it('has every required field, non-empty where the sibling is', () => {
      for (const f of REQUIRED) {
        expect(Object.keys(m), f).toContain(f);
        const empty = (v) => v === '' || v === null || (Array.isArray(v) && v.length === 0);
        if (!empty(sib[f])) expect(empty(m[f]), f).toBe(false);
      }
      expect(m.manifestVersion).toBe(1);
      expect(m.developer).toBe(sib.developer);
      expect(m.submitter).toBe(sib.submitter);
      expect(m.icon).toBe(
        `https://raw.githubusercontent.com/devcal1/tenon-umbrel-store/main/${app}/icon.svg`,
      );
    });

    it('id equals the folder name', () => {
      expect(m.id).toBe(app);
    });
  });

  it('ports 4932 and 4930 each appear in exactly one manifest of the clone', () => {
    const all = manifests();
    expect(all.filter((x) => x.m.port === 4932).map((x) => x.folder)).toEqual([
      'tenon-joinr-finance',
    ]);
    expect(all.filter((x) => x.m.port === 4930).map((x) => x.folder)).toEqual([
      'tenon-joinr-registry',
    ]);
    const ports = all.map((x) => x.m.port);
    expect(new Set(ports).size).toBe(ports.length);
  });

  describe('tenon-joinr-finance', () => {
    const m = parseYamlSubset(read('tenon-joinr-finance', 'umbrel-app.yml'));
    const c = parseYamlSubset(read('tenon-joinr-finance', 'docker-compose.yml'));

    it('manifest: version, category, uninstall warning, backupIgnore', () => {
      expect(m.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(m.category).toBe('finance');
      expect(m.name).toBe('Joinr Finance');
      expect(m.description).toContain(
        'UNINSTALLING THIS APP DELETES ITS DATABASE AND EVERY BACKUP',
      );
      expect(m.backupIgnore).toEqual([
        'data/finance.db-shm',
        'data/.*',
        'data/backups/.*',
        'data/secrets',
        'data/secrets/*',
      ]);
      // umbreld's own character rule for a backupIgnore entry.
      for (const p of m.backupIgnore) expect(p).toMatch(/^[-a-zA-Z0-9._/*]+$/);
    });

    it('manifest: the NAS copy in the description and the uninstall warning (stage-8.md §9.4)', () => {
      expect(m.description).toContain('**Copy to the NAS (optional):**');
      expect(m.description).toContain('pnpm umbrel:nas-secrets');
      expect(m.description).toMatch(/nothing on the NAS is ever deleted/);
      expect(m.description).toMatch(/never shows or asks for the address or the password/);
      // The uninstall warning points at the NAS copy, and the NAS keeps its copies.
      const warning = m.description.slice(
        m.description.indexOf('UNINSTALLING THIS APP'),
        m.description.indexOf('**Backups:**'),
      );
      expect(warning).toMatch(/weekly copy to the NAS/);
      expect(warning).toMatch(/never touches the copies on the NAS/);
      // D132: no heartbeat in Stage 8.
      expect(read('tenon-joinr-finance', 'umbrel-app.yml').toLowerCase()).not.toContain(
        'heartbeat',
      );
      expect(m.releaseNotes).toContain('1.1.0');
      expect(m.releaseNotes).toMatch(/rsync/);
    });

    it('holds no NAS secret: only .gitkeep files under data/, no secrets folder', () => {
      const files = [];
      const walk = (dir) => {
        for (const e of readdirSync(join(REAL_STORE_DIR, dir), { withFileTypes: true })) {
          const rel = `${dir}/${e.name}`;
          if (e.isDirectory()) walk(rel);
          else files.push(rel);
        }
      };
      walk('tenon-joinr-finance/data');
      expect(
        files.every((f) => f.endsWith('/.gitkeep')),
        files.join(', '),
      ).toBe(true);
      expect(existsSync(join(REAL_STORE_DIR, 'tenon-joinr-finance', 'data', 'secrets'))).toBe(
        false,
      );
      for (const f of ['umbrel-app.yml', 'docker-compose.yml']) {
        const text = read('tenon-joinr-finance', f);
        expect(text).not.toMatch(/rsync:\/\/[^<\s]/);
        expect(text).not.toMatch(/nas-password\s*[:=]/);
      }
    });

    it('compose: app_proxy, the app on the private network only, nothing published', () => {
      expect(c.services.app_proxy.environment).toEqual({
        APP_HOST: 'tenon-joinr-finance_app_1',
        APP_PORT: 3001,
      });
      expect(c.services.app_proxy.networks).toEqual(['default', 'finance']);
      const app = c.services.app;
      expect(app.user).toBe('1000:1000');
      expect(app.volumes).toEqual(['${APP_DATA_DIR}/data:/data']);
      expect(app.environment.TZ).toBe('Australia/Melbourne');
      expect(Number(app.environment.PUBLIC_PORT)).toBe(m.port);
      expect(app.ports).toBeUndefined();
      expect(app.networks).toEqual(['finance']);
      expect(app.init).toBe('true');
      expect(app.restart).toBe('on-failure');
      expect(app.stop_grace_period).toBe('30s');
      expect(c.networks).toEqual({ finance: {} });
      const noComments = read('tenon-joinr-finance', 'docker-compose.yml')
        .split('\n')
        .filter((l) => !l.trimStart().startsWith('#'))
        .join('\n');
      expect(noComments).not.toMatch(
        /PROXY_AUTH_WHITELIST|NIGHTLY_BACKUPS|WEEKLY_NAS_COPY|AUTO_RECORD|secrets/,
      );
    });

    it('the image line matches the release writer and pins the manifest version', () => {
      const img = parseComposeImage(read('tenon-joinr-finance', 'docker-compose.yml'));
      expect(img.ref).toBe(c.services.app.image);
      expect(img.ref.startsWith('127.0.0.1:4930/joinr-finance:')).toBe(true);
      expect(img.version).toBe(m.version);
    });
  });

  describe('tenon-joinr-registry', () => {
    const m = parseYamlSubset(read('tenon-joinr-registry', 'umbrel-app.yml'));
    const c = parseYamlSubset(read('tenon-joinr-registry', 'docker-compose.yml'));

    it('manifest: the registry version, the uninstall warning, backupIgnore', () => {
      expect(m.version).toBe('2.8.3');
      expect(m.category).toBe('developer');
      expect(m.description).toContain('UNINSTALLING THIS APP DELETES THE STORED IMAGES');
      expect(m.backupIgnore).toEqual(['data/*']);
    });

    it('compose: no app_proxy, loopback only, a private network, uid 1000, the pinned image, delete off', () => {
      expect(Object.keys(c.services)).toEqual(['registry']);
      const r = c.services.registry;
      expect(r.image).toBe(REGISTRY_IMAGE);
      expect(r.image).toMatch(/^registry:2\.8\.3@sha256:[0-9a-f]{64}$/);
      expect(r.ports).toEqual(['127.0.0.1:4930:5000']);
      expect(r.user).toBe('1000:1000');
      expect(r.volumes).toEqual(['${APP_DATA_DIR}/data:/var/lib/registry']);
      expect(r.environment.REGISTRY_STORAGE_DELETE_ENABLED).not.toBe('true');
      expect(r.restart).toBe('on-failure');
      // Its own bridge, not umbrel_main_network: other apps' containers cannot reach it.
      expect(r.networks).toEqual(['registry']);
      expect(c.networks).toEqual({ registry: {} });
    });
  });

  it.each(['tenon-joinr-finance', 'tenon-joinr-registry'])(
    '%s: the icon is well-formed SVG with its aria-label',
    (app) => {
      const svg = read(app, 'icon.svg');
      expect(checkXml(svg)).toBe(true);
      const name = app === 'tenon-joinr-finance' ? 'Joinr Finance' : 'Joinr Registry';
      expect(svg).toContain(`aria-label="${name}"`);
      expect(svg).toContain('role="img"');
      expect(svg).toContain('viewBox="0 0 256 256"');
    },
  );

  it('the data/ skeletons exist', () => {
    for (const p of [
      'tenon-joinr-finance/data/.gitkeep',
      'tenon-joinr-finance/data/backups/.gitkeep',
      'tenon-joinr-registry/data/.gitkeep',
    ]) {
      expect(statSync(join(REAL_STORE_DIR, p)).isFile(), p).toBe(true);
    }
  });

  it('the .gitignore keeps the new data folders to directories and .gitkeeps', () => {
    const gi = read('.gitignore');
    for (const app of ['tenon-joinr-finance', 'tenon-joinr-registry']) {
      expect(gi).toContain(`${app}/data/**\n!${app}/data/**/\n!${app}/data/**/.gitkeep`);
    }
  });

  it('every new file has LF line endings', () => {
    const files = ['README.md', '.gitignore'];
    for (const app of ['tenon-joinr-finance', 'tenon-joinr-registry']) {
      files.push(`${app}/umbrel-app.yml`, `${app}/docker-compose.yml`, `${app}/icon.svg`);
    }
    for (const f of files) expect(read(f).includes('\r'), f).toBe(false);
  });

  it('the README lists the three apps and the port table', () => {
    const readme = read('README.md');
    expect(readme).toContain('It contains three apps');
    for (const row of [
      '| 4930 | Joinr Registry',
      '| 4931 | Joinr Backup',
      '| 4932 | Joinr Finance',
    ])
      expect(readme).toContain(row);
  });
});

describe('parseYamlSubset', () => {
  it('reads maps, lists, folded scalars and quotes', () => {
    const y = parseYamlSubset(
      "# c\na: 1\nb: 'x: y'\nc:\n  - one\n  - 'two'\nd:\n  e:\n    f: g   # comment\nh: >-\n  folded\n  text\ni: {}\n",
    );
    expect(y).toEqual({
      a: 1,
      b: 'x: y',
      c: ['one', 'two'],
      d: { e: { f: 'g' } },
      h: 'folded text',
      i: {},
    });
  });
});
