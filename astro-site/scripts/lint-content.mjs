// Content lint for src/content/blog. Fails on problems that render broken pages;
// reports softer issues (missing description, duplicate titles, tag casing) as warnings.
import { readdirSync, readFileSync } from 'node:fs';

const dir = new URL('../src/content/blog/', import.meta.url);
const errors = [];
const warnings = [];
const titles = new Map();
const tagSpellings = new Map();

const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;

/** Split a markdown body into prose lines (outside code fences) and report an unclosed fence. */
function scan(body) {
  let open = null;
  const prose = [];
  for (const line of body.split('\n')) {
    const m = line.match(FENCE);
    if (open === null) {
      if (m && !(m[1][0] === '`' && m[2].includes('`'))) open = m[1];
      else prose.push(line);
    } else if (m && m[1][0] === open[0] && m[1].length >= open.length && !m[2].trim()) {
      open = null;
    }
  }
  return { prose: prose.join('\n'), unclosed: open !== null };
}

for (const file of readdirSync(dir).filter((f) => /\.mdx?$/.test(f)).sort()) {
  const text = readFileSync(new URL(file, dir), 'utf8');
  const match = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    errors.push(`${file}: missing frontmatter`);
    continue;
  }
  const [, fm, body] = match;
  if (/^draft:\s*true/m.test(fm)) continue;

  if (/Add a concise, personal takeaway/.test(body)) errors.push(`${file}: placeholder "Add a concise, personal takeaway" text`);
  if (/to share practical, production-minded guidance on this topic/.test(body)) errors.push(`${file}: boilerplate "I wrote … to share practical" opener`);
  const { prose, unclosed } = scan(body);
  if (/\\n\\n(#|\*)/.test(prose)) errors.push(`${file}: literal "\\n" escape sequences in prose`);
  if (unclosed) errors.push(`${file}: unclosed code fence`);
  if (/^# /m.test(prose)) errors.push(`${file}: H1 heading in body (the layout renders the title as H1; use ##)`);

  if (!/^description:/m.test(fm)) warnings.push(`${file}: no description`);

  const title = fm.match(/^title:\s*["']?(.*?)["']?\s*$/m)?.[1]?.toLowerCase();
  if (title) titles.set(title, [...(titles.get(title) ?? []), file]);

  const inline = fm.match(/^tags:\s*\[(.*)\]/m)?.[1];
  const block = fm.match(/^tags:\s*\n((?:[ \t]+-.*\n?)+)/m)?.[1];
  const tags = inline
    ? inline.split(',')
    : (block ?? '').split('\n').map((l) => l.replace(/^\s*-\s*/, ''));
  for (const raw of tags) {
    const tag = raw.trim().replace(/^["']|["']$/g, '');
    if (!tag) continue;
    const key = tag.toLowerCase();
    tagSpellings.set(key, new Set([...(tagSpellings.get(key) ?? []), tag]));
  }
}

for (const [title, files] of titles) {
  if (files.length > 1) warnings.push(`duplicate title "${title}": ${files.join(', ')}`);
}
for (const spellings of tagSpellings.values()) {
  if (spellings.size > 1) errors.push(`tag spelled inconsistently: ${[...spellings].join(' / ')}`);
}

const verbose = process.argv.includes('--verbose');
if (warnings.length) {
  console.warn(`${warnings.length} warning(s)${verbose ? ':' : ' (run with --verbose to list)'}`);
  if (verbose) warnings.forEach((w) => console.warn(`  warn  ${w}`));
}
if (errors.length) {
  errors.forEach((e) => console.error(`  error ${e}`));
  console.error(`\n${errors.length} content error(s).`);
  process.exit(1);
}
console.log('Content lint passed.');
