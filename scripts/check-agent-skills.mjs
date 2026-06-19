#!/usr/bin/env bun
import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const skillsRoot = path.join(repoRoot, "skills");
const args = parseArgs(process.argv.slice(2));
const target = args.target ?? "codex";
const targetConfigs = {
  codex: {
    defaultRoot: () =>
      path.join(process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex"), "skills"),
    destinationName: (skillName) => skillName,
    source: (skillName) => path.join(skillsRoot, skillName),
    syncHint: "bun run skills:sync -- --force",
  },
  cline: {
    defaultRoot: () =>
      path.join(process.env.CLINE_HOME ?? path.join(os.homedir(), ".cline"), "skills"),
    destinationName: (skillName) => skillName,
    source: (skillName) => path.join(skillsRoot, skillName),
    syncHint: "bun run skills:sync:cline -- --force",
  },
  "claude-code": {
    defaultRoot: () =>
      path.join(
        args.project ? path.join(path.resolve(args.project), ".claude") : path.join(os.homedir(), ".claude"),
        "agents",
      ),
    destinationName: (skillName) => `${skillName}.md`,
    source: (skillName) => path.join(skillsRoot, skillName, "agents", "claude-code.md"),
    syncHint: "bun run skills:sync:claude -- --force",
  },
  cursor: {
    defaultRoot: () => path.join(path.resolve(args.project), ".cursor", "rules"),
    destinationName: (skillName) => `${skillName}.mdc`,
    projectScoped: true,
    source: (skillName) => path.join(skillsRoot, skillName, "agents", "cursor.mdc"),
    syncHint:
      "bun run skills:sync:agent -- --target cursor --project <repo> --all --mode copy --force",
  },
  windsurf: {
    defaultRoot: () => path.join(path.resolve(args.project), ".windsurf", "rules"),
    destinationName: (skillName) => `${skillName}.md`,
    projectScoped: true,
    source: (skillName) => path.join(skillsRoot, skillName, "agents", "windsurf.md"),
    syncHint:
      "bun run skills:sync:agent -- --target windsurf --project <repo> --all --mode copy --force",
  },
  "github-copilot": {
    defaultRoot: () => path.join(path.resolve(args.project), ".github", "instructions"),
    destinationName: (skillName) => `${skillName}.instructions.md`,
    projectScoped: true,
    source: (skillName) =>
      path.join(skillsRoot, skillName, "agents", "github-copilot.instructions.md"),
    syncHint:
      "bun run skills:sync:agent -- --target github-copilot --project <repo> --all --mode copy --force",
  },
  gemini: {
    defaultRoot: () => path.join(path.resolve(args.project), ".gemini", "commands"),
    destinationName: (skillName) => `${skillName}.toml`,
    projectScoped: true,
    source: (skillName) => path.join(skillsRoot, skillName, "agents", "gemini-command.toml"),
    syncHint:
      "bun run skills:sync:agent -- --target gemini --project <repo> --all --mode copy --force",
  },
};

if (!targetConfigs[target]) {
  die(`Unsupported --target ${target}. Use one of: ${Object.keys(targetConfigs).join(", ")}`);
}
if (!existsSync(skillsRoot)) {
  die("skills/ directory is missing");
}

const config = targetConfigs[target];
if (config.projectScoped && !args.project) {
  die(`--target ${target} requires --project <repo-path>`);
}

const destinationRoot = path.resolve(args.dest ?? config.defaultRoot());
const availableSkills = listSkills();
const selectedSkills = args.all
  ? availableSkills
  : args.skills.length > 0
    ? args.skills
    : die("Select at least one skill or pass --all.");

for (const skillName of selectedSkills) {
  if (!availableSkills.includes(skillName)) {
    die(`Unknown skill '${skillName}'. Available: ${availableSkills.join(", ")}`);
  }
}

const failures = [];
for (const skillName of selectedSkills) {
  checkSkill(skillName, config);
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`FAIL ${failure}`);
  }
  console.error(`\nRun from this kit checkout to refresh ${target}:`);
  console.error(`  ${config.syncHint}`);
  process.exit(1);
}

console.log(`Agent skill install check passed for ${selectedSkills.length} ${target} skill(s).`);

/**
 * Check whether one installed skill is present and matches the repository copy.
 *
 * @param {string} skillName
 * @param {(typeof targetConfigs)[keyof typeof targetConfigs]} targetConfig
 */
function checkSkill(skillName, targetConfig) {
  const source = targetConfig.source(skillName);
  const destination = path.join(destinationRoot, targetConfig.destinationName(skillName));

  if (!existsSync(source)) {
    failures.push(`${skillName}: source is missing (${path.relative(repoRoot, source)})`);
    return;
  }
  if (!existsSync(destination)) {
    failures.push(`${skillName}: destination is missing (${destination})`);
    return;
  }

  const destinationStat = lstatSync(destination);
  if (destinationStat.isSymbolicLink()) {
    if (isSameLink(destination, source)) {
      console.log(`OK ${skillName}: linked to ${path.relative(repoRoot, source)}`);
      return;
    }
    failures.push(
      `${skillName}: symlink points to ${readlinkSync(destination)}, not ${path.relative(repoRoot, source)}`,
    );
    return;
  }

  const differences = compareEntries(source, destination);
  if (differences.length === 0) {
    console.log(`OK ${skillName}: copied files match`);
    return;
  }

  failures.push(`${skillName}: installed files differ (${differences.slice(0, 5).join("; ")})`);
}

/**
 * Recursively compare a source skill entry with its installed destination.
 *
 * @param {string} source
 * @param {string} destination
 * @param {string} [relativePath]
 * @returns {string[]}
 */
function compareEntries(source, destination, relativePath = "") {
  const sourceStat = lstatSync(source);
  const destinationStat = lstatSync(destination);

  if (sourceStat.isDirectory() !== destinationStat.isDirectory()) {
    return [`${relativePath || "."}: entry type differs`];
  }

  if (sourceStat.isDirectory()) {
    const sourceNames = entryNames(source);
    const destinationNames = entryNames(destination);
    const names = [...new Set([...sourceNames, ...destinationNames])].sort();
    const differences = [];
    for (const name of names) {
      const childRelativePath = path.join(relativePath, name);
      const sourceChild = path.join(source, name);
      const destinationChild = path.join(destination, name);
      if (!existsSync(sourceChild)) {
        differences.push(`${childRelativePath}: extra installed file`);
      } else if (!existsSync(destinationChild)) {
        differences.push(`${childRelativePath}: missing installed file`);
      } else {
        differences.push(...compareEntries(sourceChild, destinationChild, childRelativePath));
      }
    }
    return differences;
  }

  if (!readFileSync(source).equals(readFileSync(destination))) {
    return [`${relativePath || path.basename(source)}: content differs`];
  }
  return [];
}

/**
 * List repository-managed skill directories.
 *
 * @returns {string[]}
 */
function listSkills() {
  return readdirSync(skillsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort();
}

/**
 * List non-hidden child entries for stable directory comparisons.
 *
 * @param {string} directory
 * @returns {string[]}
 */
function entryNames(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort();
}

/**
 * Check whether an installed symlink resolves to the expected source path.
 *
 * @param {string} destination
 * @param {string} source
 * @returns {boolean}
 */
function isSameLink(destination, source) {
  try {
    const targetPath = path.resolve(path.dirname(destination), readlinkSync(destination));
    return realpathSync(targetPath) === realpathSync(source);
  } catch {
    return false;
  }
}

/**
 * Parse command line flags for a skill install check run.
 *
 * @param {string[]} rawArgs
 * @returns {{all: boolean, skills: string[], target?: string, dest?: string, project?: string}}
 */
function parseArgs(rawArgs) {
  const parsed = {
    all: false,
    skills: [],
  };

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (arg === "--all") {
      parsed.all = true;
    } else if (arg === "--target" || arg === "--dest" || arg === "--project") {
      const value = rawArgs[index + 1];
      if (!value) {
        die(`${arg} requires a value`);
      }
      parsed[arg.slice(2)] = value;
      index += 1;
    } else if (arg.startsWith("--target=")) {
      parsed.target = arg.slice("--target=".length);
    } else if (arg.startsWith("--dest=")) {
      parsed.dest = arg.slice("--dest=".length);
    } else if (arg.startsWith("--project=")) {
      parsed.project = arg.slice("--project=".length);
    } else if (arg.startsWith("-")) {
      die(`Unknown option ${arg}`);
    } else {
      parsed.skills.push(arg);
    }
  }

  return parsed;
}

/**
 * Print an error and terminate with a non-zero exit code.
 *
 * @param {string} message
 * @returns {never}
 */
function die(message) {
  console.error(message);
  process.exit(1);
}
