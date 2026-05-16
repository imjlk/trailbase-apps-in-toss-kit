#!/usr/bin/env bun
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const skillsRoot = path.join(repoRoot, "skills");
const args = parseArgs(process.argv.slice(2));
const target = args.target ?? "codex";
const mode = args.mode ?? "link";
const targetConfigs = {
  codex: {
    defaultRoot: () => path.join(process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex"), "skills"),
    source: (skillName) => path.join(skillsRoot, skillName),
    destinationName: (skillName) => skillName,
    restartMessage: "Restart Codex to pick up new or changed skills.",
  },
  cline: {
    defaultRoot: () => path.join(process.env.CLINE_HOME ?? path.join(os.homedir(), ".cline"), "skills"),
    source: (skillName) => path.join(skillsRoot, skillName),
    destinationName: (skillName) => skillName,
    restartMessage: "Reload Cline to pick up new or changed skills.",
  },
  "claude-code": {
    defaultRoot: () => path.join(args.project ? path.join(path.resolve(args.project), ".claude") : path.join(os.homedir(), ".claude"), "agents"),
    source: (skillName) => path.join(skillsRoot, skillName, "agents", "claude-code.md"),
    destinationName: (skillName) => `${skillName}.md`,
    restartMessage: "Reload Claude Code to pick up new or changed subagents.",
  },
  cursor: {
    projectScoped: true,
    defaultRoot: () => path.join(path.resolve(args.project), ".cursor", "rules"),
    source: (skillName) => path.join(skillsRoot, skillName, "agents", "cursor.mdc"),
    destinationName: (skillName) => `${skillName}.mdc`,
    restartMessage: "Reload Cursor or reopen the project to pick up changed rules.",
  },
  windsurf: {
    projectScoped: true,
    defaultRoot: () => path.join(path.resolve(args.project), ".windsurf", "rules"),
    source: (skillName) => path.join(skillsRoot, skillName, "agents", "windsurf.md"),
    destinationName: (skillName) => `${skillName}.md`,
    restartMessage: "Reload Windsurf or reopen the project to pick up changed rules.",
  },
  "github-copilot": {
    projectScoped: true,
    defaultRoot: () => path.join(path.resolve(args.project), ".github", "instructions"),
    source: (skillName) => path.join(skillsRoot, skillName, "agents", "github-copilot.instructions.md"),
    destinationName: (skillName) => `${skillName}.instructions.md`,
    restartMessage: "GitHub Copilot will use repository instructions after the file is committed or available in the workspace.",
  },
  gemini: {
    projectScoped: true,
    defaultRoot: () => path.join(path.resolve(args.project), ".gemini", "commands"),
    source: (skillName) => path.join(skillsRoot, skillName, "agents", "gemini-command.toml"),
    destinationName: (skillName) => `${skillName}.toml`,
    restartMessage: "Reload Gemini CLI or reopen the workspace to pick up changed commands.",
  },
};

if (!targetConfigs[target]) {
  die(`Unsupported --target ${target}. Use one of: ${Object.keys(targetConfigs).join(", ")}`);
}
if (!["copy", "link"].includes(mode)) {
  die(`Unsupported --mode ${mode}. Use copy or link.`);
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

mkdirSync(destinationRoot, { recursive: true });

for (const skillName of selectedSkills) {
  syncSkill(skillName, config);
}

console.log(`Synced ${selectedSkills.length} skill adapter(s) for ${target} to ${destinationRoot}`);
console.log(config.restartMessage);

function syncSkill(skillName, targetConfig) {
  const source = targetConfig.source(skillName);
  const destination = path.join(destinationRoot, targetConfig.destinationName(skillName));

  if (!existsSync(source)) {
    die(`${skillName}: missing adapter source ${path.relative(repoRoot, source)}`);
  }

  if (existsSync(destination)) {
    if (isSameLink(destination, source)) {
      console.log(`OK ${skillName}: already linked`);
      return;
    }
    if (!args.force) {
      die(`${destination} already exists. Re-run with --force to replace it.`);
    }
    rmSync(destination, { recursive: true, force: true });
  }

  if (mode === "link") {
    symlinkSync(source, destination, lstatSync(source).isDirectory() ? "dir" : "file");
    console.log(`LINK ${skillName}: ${destination} -> ${source}`);
    return;
  }

  cpSync(source, destination, {
    recursive: true,
    dereference: false,
    errorOnExist: true,
  });
  console.log(`COPY ${skillName}: ${destination}`);
}

function listSkills() {
  if (!lstatSync(skillsRoot).isDirectory()) {
    return [];
  }

  return readdirSync(skillsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort();
}

function isSameLink(destination, source) {
  try {
    const stat = lstatSync(destination);
    if (!stat.isSymbolicLink()) {
      return false;
    }
    const targetPath = path.resolve(path.dirname(destination), readlinkSync(destination));
    return realpathSync(targetPath) === realpathSync(source);
  } catch {
    return false;
  }
}

function parseArgs(rawArgs) {
  const parsed = {
    all: false,
    force: false,
    skills: [],
  };

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (arg === "--all") {
      parsed.all = true;
    } else if (arg === "--force") {
      parsed.force = true;
    } else if (arg === "--target" || arg === "--mode" || arg === "--dest" || arg === "--project") {
      const value = rawArgs[index + 1];
      if (!value) {
        die(`${arg} requires a value`);
      }
      parsed[arg.slice(2)] = value;
      index += 1;
    } else if (arg.startsWith("--target=")) {
      parsed.target = arg.slice("--target=".length);
    } else if (arg.startsWith("--mode=")) {
      parsed.mode = arg.slice("--mode=".length);
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

function die(message) {
  console.error(message);
  process.exit(1);
}
