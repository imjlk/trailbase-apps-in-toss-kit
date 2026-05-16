#!/usr/bin/env bun
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const skillsRoot = path.join(repoRoot, "skills");
const forbiddenSkillFiles = new Set([
  "README.md",
  "CHANGELOG.md",
  "INSTALLATION_GUIDE.md",
  "QUICK_REFERENCE.md",
]);
const adapterSpecs = [
  {
    file: "agents/openai.yaml",
    validate: validateOpenAiYaml,
  },
  {
    file: "agents/claude-code.md",
    validate: validateClaudeCode,
    markdown: true,
  },
  {
    file: "agents/cursor.mdc",
    validate: validateCursor,
    markdown: true,
  },
  {
    file: "agents/windsurf.md",
    validate: validateWindsurf,
    markdown: true,
  },
  {
    file: "agents/github-copilot.instructions.md",
    validate: validateGitHubCopilot,
    markdown: true,
  },
  {
    file: "agents/gemini-command.toml",
    validate: validateGeminiCommand,
  },
];

const failures = [];
const warnings = [];

if (!existsSync(skillsRoot)) {
  fail("skills/ directory is missing");
} else {
  const skillDirs = readdirSync(skillsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort();

  if (skillDirs.length === 0) {
    fail("skills/ does not contain any skills");
  }

  for (const skillName of skillDirs) {
    validateSkill(skillName);
  }
}

for (const warning of warnings) {
  console.warn(`WARN ${warning}`);
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`FAIL ${failure}`);
  }
  process.exit(1);
}

console.log("Agent skill validation passed");

function validateSkill(skillName) {
  const skillDir = path.join(skillsRoot, skillName);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skillName)) {
    fail(`${skillName}: directory name must be hyphen-case`);
  }

  for (const fileName of forbiddenSkillFiles) {
    if (existsSync(path.join(skillDir, fileName))) {
      fail(`${skillName}: ${fileName} should not live inside a skill folder`);
    }
  }

  const skillPath = path.join(skillDir, "SKILL.md");
  if (!existsSync(skillPath)) {
    fail(`${skillName}: SKILL.md is missing`);
    return;
  }

  const skillSource = readFileSync(skillPath, "utf8");
  validateNoSensitiveOrLocalContent(skillName, skillPath, skillSource);
  const frontmatter = parseFrontmatter(skillSource, `${skillName}/SKILL.md`);
  if (!frontmatter) {
    return;
  }

  if (frontmatter.name !== skillName) {
    fail(`${skillName}: frontmatter name must match directory name`);
  }
  if (!frontmatter.description || frontmatter.description.length > 1024) {
    fail(`${skillName}: frontmatter description must be 1-1024 characters`);
  }

  const body = skillSource.replace(/^---\n[\s\S]*?\n---\n?/, "");
  const bodyLines = body.split(/\r?\n/).length;
  if (bodyLines > 500) {
    warnings.push(`${skillName}: SKILL.md body is ${bodyLines} lines; prefer references/ for detail`);
  }

  for (const spec of adapterSpecs) {
    const adapterPath = path.join(skillDir, spec.file);
    if (!existsSync(adapterPath)) {
      fail(`${skillName}: ${spec.file} is missing`);
      continue;
    }
    const source = readFileSync(adapterPath, "utf8");
    validateNoSensitiveOrLocalContent(skillName, adapterPath, source);
    spec.validate(skillName, adapterPath, source);
    if (spec.markdown) {
      validateMarkdownLinks(skillName, adapterPath);
    }
  }

  validateMarkdownLinks(skillName, skillPath);
  validateReferenceLinks(skillName, path.join(skillDir, "references"));
}

function validateOpenAiYaml(skillName, agentPath, source) {
  const values = parseSimpleYaml(source);
  const displayName = values["interface.display_name"];
  const shortDescription = values["interface.short_description"];
  const defaultPrompt = values["interface.default_prompt"];

  if (!displayName) {
    fail(`${skillName}: agents/openai.yaml missing interface.display_name`);
  }
  if (!shortDescription || shortDescription.length < 25 || shortDescription.length > 64) {
    fail(`${skillName}: interface.short_description must be 25-64 characters`);
  }
  if (!defaultPrompt || !defaultPrompt.includes(`$${skillName}`)) {
    fail(`${skillName}: interface.default_prompt must mention $${skillName}`);
  }
}

function validateClaudeCode(skillName, agentPath, source) {
  const frontmatter = parseFrontmatter(source, path.relative(repoRoot, agentPath));
  if (!frontmatter) {
    return;
  }
  if (frontmatter.name !== skillName) {
    fail(`${skillName}: claude-code.md frontmatter name must match skill name`);
  }
  if (!frontmatter.description) {
    fail(`${skillName}: claude-code.md missing description`);
  }
  if (!source.includes("SKILL.md")) {
    fail(`${skillName}: claude-code.md should point back to canonical SKILL.md`);
  }
}

function validateCursor(skillName, agentPath, source) {
  const frontmatter = parseFrontmatter(source, path.relative(repoRoot, agentPath));
  if (!frontmatter) {
    return;
  }
  if (!frontmatter.description) {
    fail(`${skillName}: cursor.mdc missing description`);
  }
  if (!frontmatter.globs) {
    fail(`${skillName}: cursor.mdc missing globs`);
  }
  if (frontmatter.alwaysApply !== "false") {
    fail(`${skillName}: cursor.mdc alwaysApply must be false`);
  }
}

function validateWindsurf(skillName, agentPath, source) {
  const frontmatter = parseFrontmatter(source, path.relative(repoRoot, agentPath));
  if (!frontmatter) {
    return;
  }
  if (frontmatter.trigger !== "model_decision") {
    fail(`${skillName}: windsurf.md trigger must be model_decision`);
  }
  if (!frontmatter.globs) {
    fail(`${skillName}: windsurf.md missing globs`);
  }
}

function validateGitHubCopilot(skillName, agentPath, source) {
  const frontmatter = parseFrontmatter(source, path.relative(repoRoot, agentPath));
  if (!frontmatter) {
    return;
  }
  if (!frontmatter.applyTo) {
    fail(`${skillName}: github-copilot.instructions.md missing applyTo`);
  }
}

function validateGeminiCommand(skillName, agentPath, source) {
  const values = parseSimpleToml(source);
  if (!values.description) {
    fail(`${skillName}: gemini-command.toml missing description`);
  }
  if (!values.prompt || !values.prompt.includes(skillName)) {
    fail(`${skillName}: gemini-command.toml prompt must mention ${skillName}`);
  }
}

function validateNoSensitiveOrLocalContent(skillName, filePath, source) {
  const relativePath = path.relative(repoRoot, filePath);
  const patterns = [
    { pattern: /\/Users\/|\/home\/|\/private\//, label: "local absolute path" },
    { pattern: /\b(?:zero-three-three|light-on-off)\b/, label: "consumer-specific repo name" },
    { pattern: /\b(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16})\b/, label: "secret-looking token" },
    { pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, label: "private key material" },
  ];

  for (const { pattern, label } of patterns) {
    if (pattern.test(source)) {
      fail(`${skillName}: ${relativePath} contains ${label}`);
    }
  }
}

function validateReferenceLinks(skillName, referencesDir) {
  if (!existsSync(referencesDir)) {
    return;
  }
  for (const entry of readdirSync(referencesDir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".md")) {
      validateMarkdownLinks(skillName, path.join(referencesDir, entry.name));
    }
  }
}

function validateMarkdownLinks(skillName, filePath) {
  const source = readFileSync(filePath, "utf8");
  const linkPattern = /\[[^\]]+\]\(([^)]+)\)/g;
  let match;
  while ((match = linkPattern.exec(source))) {
    const href = match[1].trim();
    const targetPath = normalizeMarkdownHref(href);
    if (!targetPath) {
      continue;
    }
    const resolved = path.resolve(path.dirname(filePath), targetPath);
    if (!existsSync(resolved)) {
      fail(`${skillName}: broken link ${href} in ${path.relative(repoRoot, filePath)}`);
    }
  }
}

function normalizeMarkdownHref(href) {
  if (!href || href.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(href)) {
    return undefined;
  }
  const withoutAnchor = href.split("#", 1)[0].trim();
  if (!withoutAnchor) {
    return undefined;
  }
  const withoutTitle = withoutAnchor.replace(/^<(.+)>$/, "$1").split(/\s+/, 1)[0];
  return withoutTitle || undefined;
}

function parseFrontmatter(source, label) {
  const match = source.match(/^---\n([\s\S]*?)\n---/);
  if (!match) {
    fail(`${label}: missing YAML frontmatter`);
    return undefined;
  }
  return parseSimpleYaml(match[1], label);
}

function parseSimpleYaml(source, label = "YAML") {
  const result = {};
  const stack = [];
  for (const rawLine of source.split(/\r?\n/)) {
    if (!rawLine.trim() || rawLine.trimStart().startsWith("#")) {
      continue;
    }
    const indent = rawLine.match(/^\s*/)[0].length;
    const line = rawLine.trim();
    const match = line.match(/^([A-Za-z0-9_.-]+):(?:\s*(.*))?$/);
    if (!match) {
      continue;
    }
    const key = match[1];
    const value = match[2] ?? "";
    while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }
    const fullKey = [...stack.map((item) => item.key), key].join(".");
    if (value === "") {
      stack.push({ indent, key });
    } else {
      result[fullKey] = unquoteScalar(value);
    }
  }
  if (label && result.name && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(result.name)) {
    fail(`${label}: name must be hyphen-case`);
  }
  return result;
}

function parseSimpleToml(source) {
  const result = {};
  const multiLine = source.match(/prompt\s*=\s*"""([\s\S]*?)"""/);
  if (multiLine) {
    result.prompt = multiLine[1];
  }
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.includes('"""')) {
      continue;
    }
    const match = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/);
    if (match) {
      result[match[1]] = unquoteScalar(match[2]);
    }
  }
  return result;
}

function unquoteScalar(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  return trimmed;
}

function fail(message) {
  failures.push(message);
}
