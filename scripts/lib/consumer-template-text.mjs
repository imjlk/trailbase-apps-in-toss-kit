export function extractYamlMappingEntry(text, parentKey, entryKey) {
  const lines = text.split(/\r?\n/);
  const parentIndex = lines.findIndex((line) =>
    new RegExp(`^${escapeRegex(parentKey)}:\\s*(?:#.*)?$`).test(line),
  );
  if (parentIndex < 0) {
    return '';
  }

  const parentIndent = indentation(lines[parentIndex]);
  const parentEnd = findYamlBlockEnd(lines, parentIndex + 1, parentIndent, {
    skipBoundaryComments: true,
  });
  const entryDirectIndent = findYamlDirectChildIndent(
    lines,
    parentIndex + 1,
    parentEnd,
    parentIndent,
  );
  if (entryDirectIndent === null) {
    return '';
  }

  for (let index = parentIndex + 1; index < parentEnd; index += 1) {
    const line = lines[index];
    if (isYamlSkippableLine(line)) {
      continue;
    }
    const entryIndent = indentation(line);
    if (
      entryIndent === entryDirectIndent &&
      yamlMappingEntryPattern(entryIndent, entryKey).test(line)
    ) {
      const entryEnd = findYamlBlockEnd(lines, index + 1, entryIndent);
      const entryLines = trimTrailingBlankLines(lines.slice(index, entryEnd));
      entryLines[0] = normalizeYamlMappingEntryLine(entryLines[0], entryIndent, entryKey);
      return `${entryLines.join('\n')}\n`;
    }
  }
  return '';
}

function findYamlBlockEnd(lines, start, baseIndent, { skipBoundaryComments = false } = {}) {
  for (let index = start; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    if (trimmed.startsWith('#')) {
      if (skipBoundaryComments || indentation(line) > baseIndent) {
        continue;
      }
      return index;
    }
    if (indentation(line) <= baseIndent) {
      return index;
    }
  }
  return lines.length;
}

function normalizeYamlMappingEntryLine(line, entryIndent, entryKey) {
  const match = line.match(yamlMappingEntryPattern(entryIndent, entryKey));
  if (!match) {
    return line;
  }
  return `${match[1]}${entryKey}${match[2]}`;
}

function yamlMappingEntryPattern(entryIndent, entryKey) {
  const keyPattern = yamlMappingKeyAlternatives(entryKey);
  return new RegExp(`^(\\s{${entryIndent}})(?:${keyPattern})(\\s*:\\s*.*)$`);
}

function yamlMappingKeyAlternatives(entryKey) {
  return [
    escapeRegex(entryKey),
    `"${escapeRegex(entryKey)}"`,
    `'${escapeRegex(entryKey)}'`,
  ].join('|');
}

function isYamlSkippableLine(line) {
  const trimmed = line.trim();
  return !trimmed || trimmed.startsWith('#');
}

function findYamlDirectChildIndent(lines, start, end, parentIndent) {
  for (let index = start; index < end; index += 1) {
    const line = lines[index];
    if (isYamlSkippableLine(line)) {
      continue;
    }
    const lineIndent = indentation(line);
    if (lineIndent > parentIndent) {
      return lineIndent;
    }
  }
  return null;
}

function trimTrailingBlankLines(lines) {
  let end = lines.length;
  while (end > 0 && !lines[end - 1].trim()) {
    end -= 1;
  }
  return lines.slice(0, end);
}

export function parseActiveEnvEntries(text) {
  const entries = [];
  const entryIndexes = new Map();
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const withoutExport = trimmed.startsWith('export ')
      ? trimmed.slice('export '.length).trim()
      : trimmed;
    const index = withoutExport.indexOf('=');
    if (index < 1) {
      continue;
    }
    const key = withoutExport.slice(0, index).trim();
    const value = parseEnvValue(withoutExport.slice(index + 1));
    if (key) {
      const entry = { key, value };
      if (entryIndexes.has(key)) {
        entries[entryIndexes.get(key)] = entry;
      } else {
        entryIndexes.set(key, entries.length);
        entries.push(entry);
      }
    }
  }
  return entries;
}

function parseEnvValue(rawValue) {
  const value = String(rawValue ?? '').trim();
  const quote = value[0];
  if (quote === '"' || quote === "'") {
    for (let index = 1; index < value.length; index += 1) {
      if (value[index] === quote && value[index - 1] !== '\\') {
        return value.slice(1, index);
      }
    }
    return value.slice(1);
  }

  const commentIndex = value.search(/\s#/);
  if (commentIndex >= 0) {
    return value.slice(0, commentIndex).trim();
  }
  return value;
}


function indentation(line) {
  return line.match(/^\s*/)[0].length;
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
