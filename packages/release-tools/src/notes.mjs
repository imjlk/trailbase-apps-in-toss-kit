import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { releaseTag } from './sampo.mjs';

export function renderSampoReleaseNotes({ root, appName, lockstep }) {
  const entries = new Map();
  for (const item of lockstep.packages) {
    const path = resolve(root, dirname(item.path), 'CHANGELOG.md');
    const sections = readFileSync(path, 'utf8').replace(/\r\n/g, '\n').split(/(?=^## )/m);
    const section = sections.find((text) => text.startsWith(`## ${lockstep.version} `) || text.startsWith(`## ${lockstep.version}\n`));
    assert(section, `Missing ${lockstep.version} changelog: ${item.path}`);
    let heading = 'Changes';
    let current;
    const save = () => {
      if (!current) return;
      current.text = current.text.trimEnd();
      const key = `${current.heading}\n${current.text}`;
      if (entries.has(key)) entries.get(key).packages.push(item.name);
      else entries.set(key, current);
      current = undefined;
    };
    for (const line of section.split('\n')) {
      if (line.startsWith('### ')) { save(); heading = line.slice(4).trim(); }
      else if (line.startsWith('- ')) {
        save();
        current = { heading, text: line.slice(2), packages: [item.name] };
      } else if (current && (line === '' || /^\s+\S/.test(line))) current.text += `\n${line}`;
    }
    save();
  }
  assert(entries.size > 0, 'Release notes contain no entries');
  const lines = [`# ${releaseTag(appName, lockstep.version)}`, '', `${lockstep.packages.length} packages released in lockstep.`, ''];
  const groups = new Map();
  for (const entry of entries.values()) {
    if (!groups.has(entry.heading)) groups.set(entry.heading, []);
    groups.get(entry.heading).push(entry.text);
  }
  for (const [heading, texts] of groups) lines.push(`## ${heading}`, '', ...texts.map((text) => `- ${text}`), '');
  return `${lines.join('\n')}\n`;
}
