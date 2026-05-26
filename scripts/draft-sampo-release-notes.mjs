import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_CHANGESET_DIR = ".sampo/changesets";

const args = process.argv.slice(2);

function usage() {
  console.log(`Usage:
  node scripts/draft-sampo-release-notes.mjs [--root .] [--changesets .sampo/changesets]
  node scripts/draft-sampo-release-notes.mjs --output RELEASE_NOTES_DRAFT.md

Options:
  --root <path>        Repository root that contains .sampo/changesets.
  --changesets <path> Changeset directory, relative to --root unless absolute.
  --output <path>     Write the draft to a file instead of stdout.
  --title <text>      Markdown H1 title. Default: Release Notes Draft.
  --help              Show this help.
`);
}

function optionValue(flag, fallback = null) {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === flag) return args[index + 1] ?? fallback;
    if (arg.startsWith(`${flag}=`)) return arg.slice(flag.length + 1);
  }

  return fallback;
}

function hasFlag(flag) {
  return args.includes(flag);
}

function resolveFromRoot(root, value) {
  if (path.isAbsolute(value)) return value;
  return path.join(root, value);
}

function normalizeDescription(text) {
  return text
    .trim()
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" ");
}

function parseChangesetFrontmatter(filePath, content) {
  const lines = content.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") {
    throw new Error(`${filePath} does not start with changeset frontmatter`);
  }

  const endIndex = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (endIndex === -1) {
    throw new Error(`${filePath} has no closing changeset frontmatter marker`);
  }

  const entries = [];
  for (const line of lines.slice(1, endIndex)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const match = trimmed.match(/^([^:]+):\s*(major|minor|patch)(?:\s*\(([^)]+)\))?\s*$/i);
    if (!match) {
      throw new Error(`${filePath} has unsupported changeset entry: ${trimmed}`);
    }

    entries.push({
      packageName: match[1].trim(),
      bump: match[2].toLowerCase(),
      tag: match[3]?.trim() ?? null
    });
  }

  if (entries.length === 0) {
    throw new Error(`${filePath} has no package bump entries`);
  }

  return {
    entries,
    description: normalizeDescription(lines.slice(endIndex + 1).join("\n"))
  };
}

async function readChangesets(changesetDir, root) {
  let dirEntries;
  try {
    dirEntries = await readdir(changesetDir, { withFileTypes: true });
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }

  const files = dirEntries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  const changesets = [];
  for (const file of files) {
    const absolutePath = path.join(changesetDir, file);
    const relativePath = path.relative(root, absolutePath) || file;
    const parsed = parseChangesetFrontmatter(relativePath, await readFile(absolutePath, "utf8"));

    changesets.push({
      file: relativePath,
      ...parsed
    });
  }

  return changesets;
}

function formatEntry(entry) {
  const bump = entry.tag ? `${entry.bump} / ${entry.tag}` : entry.bump;
  return `${entry.packageName}: ${bump}`;
}

function buildReleaseNotesDraft(changesets, options) {
  const lines = [
    `# ${options.title}`,
    "",
    `Generated from ${changesets.length} pending Sampo changeset${changesets.length === 1 ? "" : "s"} in \`${options.changesetLabel}\`.`,
    ""
  ];

  if (changesets.length === 0) {
    lines.push("No pending changesets found.", "");
    return lines.join("\n");
  }

  lines.push("## Highlights", "");
  for (const changeset of changesets) {
    lines.push(`- ${changeset.description || "No description provided."}`);
    lines.push(`  - Impact: ${changeset.entries.map(formatEntry).join("; ")}`);
    lines.push(`  - Source: \`${changeset.file}\``);
  }

  const byPackage = new Map();
  for (const changeset of changesets) {
    for (const entry of changeset.entries) {
      const packageEntries = byPackage.get(entry.packageName) ?? [];
      packageEntries.push({
        bump: entry.bump,
        tag: entry.tag,
        description: changeset.description,
        file: changeset.file
      });
      byPackage.set(entry.packageName, packageEntries);
    }
  }

  lines.push("", "## Package Impact", "");
  for (const packageName of [...byPackage.keys()].sort((left, right) => left.localeCompare(right))) {
    lines.push(`### ${packageName}`, "");
    for (const entry of byPackage.get(packageName)) {
      const bump = entry.tag ? `${entry.bump} / ${entry.tag}` : entry.bump;
      lines.push(`- **${bump}**: ${entry.description || "No description provided."}`);
      lines.push(`  - Source: \`${entry.file}\``);
    }
    lines.push("");
  }

  lines.push("## Release Note Checklist", "");
  lines.push("- Keep user-facing behavior first; move implementation detail to maintainer notes.");
  lines.push("- Call out migrations, deployment steps, secrets, image tags, or compatibility checks when they affect operators.");
  lines.push("- Do not claim consumer compatibility until the relevant smoke tests have passed.");
  lines.push("- After copying useful text into release notes, run `sampo release` to update package changelogs.");
  lines.push("");

  return lines.join("\n");
}

if (hasFlag("--help") || hasFlag("-h")) {
  usage();
  process.exit(0);
}

const root = path.resolve(optionValue("--root", process.cwd()));
const changesetArg = optionValue("--changesets", DEFAULT_CHANGESET_DIR);
const changesetDir = resolveFromRoot(root, changesetArg);
const output = optionValue("--output");
const title = optionValue("--title", "Release Notes Draft");

const changesets = await readChangesets(changesetDir, root);
const draft = buildReleaseNotesDraft(changesets, {
  title,
  changesetLabel: path.relative(root, changesetDir) || changesetDir
});

if (output) {
  const outputPath = resolveFromRoot(root, output);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, draft);
  console.log(`Wrote ${outputPath}`);
} else {
  console.log(draft);
}
