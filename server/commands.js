import fs from "fs/promises";
import path from "path";
import os from "os";
import logger from "./logger.js";

/**
 * Parse YAML frontmatter from a markdown file content
 * @param {string} content - The markdown file content
 * @returns {Object} Parsed frontmatter as an object
 */
function parseFrontmatter(content) {
	const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	if (!match) return {};

	const frontmatter = {};
	const lines = match[1].split("\n");

	for (const line of lines) {
		const colonIndex = line.indexOf(":");
		if (colonIndex > 0) {
			const key = line.slice(0, colonIndex).trim();
			const value = line.slice(colonIndex + 1).trim();
			// Remove quotes if present
			frontmatter[key] = value.replace(/^["']|["']$/g, "");
		}
	}

	return frontmatter;
}

async function readJsonFile(filePath) {
	try {
		return JSON.parse(await fs.readFile(filePath, "utf-8"));
	} catch (err) {
		if (err.code !== "ENOENT") {
			logger.warn(`[Commands] Failed to read ${filePath}:`, err.message);
		}
		return {};
	}
}

function resolveConfiguredPath(configPath, baseDir) {
	if (!configPath || typeof configPath !== "string") return null;

	if (configPath === "~") return os.homedir();
	if (configPath.startsWith("~/")) {
		return path.join(os.homedir(), configPath.slice(2));
	}
	if (configPath.startsWith("~")) {
		return path.join(os.homedir(), configPath.slice(1));
	}
	if (path.isAbsolute(configPath)) return configPath;

	return path.resolve(baseDir, configPath);
}

async function pathExists(filePath) {
	try {
		await fs.access(filePath);
		return true;
	} catch {
		return false;
	}
}

async function findGitRepoRoot(startDir) {
	let current = path.resolve(startDir);

	while (true) {
		if (await pathExists(path.join(current, ".git"))) return current;

		const parent = path.dirname(current);
		if (parent === current) return null;
		current = parent;
	}
}

async function getAncestorAgentsSkillDirs(projectPath) {
	if (!projectPath) return [];

	const dirs = [];
	const repoRoot = await findGitRepoRoot(projectPath);
	let current = path.resolve(projectPath);

	while (true) {
		dirs.push(path.join(current, ".agents", "skills"));
		if (repoRoot && current === repoRoot) break;

		const parent = path.dirname(current);
		if (parent === current) break;
		current = parent;
	}

	return dirs;
}

/**
 * Parse a command file and extract metadata
 * @param {string} filePath - Path to the markdown command file
 * @returns {Promise<Object|null>} Command object or null if parsing fails
 */
async function parseCommandFile(filePath) {
	try {
		const content = await fs.readFile(filePath, "utf-8");
		const frontmatter = parseFrontmatter(content);
		const fileName = path.basename(filePath, ".md");

		return {
			name: `/${fileName}`,
			description: frontmatter.description || `Run ${fileName} command`,
			path: filePath,
		};
	} catch (err) {
		logger.warn(`[Commands] Failed to parse ${filePath}:`, err.message);
		return null;
	}
}

/**
 * Parse a Pi skill file and extract metadata for Pi's /skill:name command.
 * @param {string} filePath - Path to the markdown skill file
 * @param {string} source - Source identifier
 * @returns {Promise<Object|null>} Skill command object or null if parsing fails
 */
async function parseSkillFile(filePath, source) {
	try {
		const content = await fs.readFile(filePath, "utf-8");
		const frontmatter = parseFrontmatter(content);
		const fileName = path.basename(filePath, ".md");
		const fallbackName =
			fileName === "SKILL" ? path.basename(path.dirname(filePath)) : fileName;
		const skillName = frontmatter.name || fallbackName;

		return {
			name: `/skill:${skillName}`,
			description: frontmatter.description || `Run ${skillName} skill`,
			path: filePath,
			source,
		};
	} catch (err) {
		logger.warn(`[Skills] Failed to parse ${filePath}:`, err.message);
		return null;
	}
}

/**
 * Discover all command files in a directory
 * @param {string} directory - Path to scan for .md files
 * @param {string} source - Source identifier ('global' or 'project')
 * @returns {Promise<Array>} Array of command objects
 */
async function discoverCommands(directory, source) {
	const commands = [];

	try {
		const entries = await fs.readdir(directory, { withFileTypes: true });

		for (const entry of entries) {
			if (entry.isFile() && entry.name.endsWith(".md")) {
				const filePath = path.join(directory, entry.name);
				const command = await parseCommandFile(filePath);

				if (command) {
					commands.push({
						...command,
						source,
					});
				}
			}
		}
	} catch (err) {
		// Directory doesn't exist or can't be read - that's OK
		if (err.code !== "ENOENT") {
			logger.warn(`[Commands] Error reading ${directory}:`, err.message);
		}
	}

	return commands;
}

/**
 * Get project-specific commands from <projectPath>/.pi/commands/
 * @param {string} projectPath - The project's filesystem path
 * @returns {Promise<Array>} Array of project command objects
 */
async function getProjectCommands(projectPath) {
	if (!projectPath) return [];

	const projectDir = path.join(projectPath, ".pi", "commands");
	return discoverCommands(projectDir, "project");
}

/**
 * Get project-specific skills from <projectPath>/.pi/skills/
 * @param {string} projectPath - The project's filesystem path
 * @returns {Promise<Array>} Array of project skill objects
 */
async function getProjectSkills(projectPath) {
	if (!projectPath) return [];

	const skillsDir = path.join(projectPath, ".pi", "skills");
	return discoverSkillPath(skillsDir, "skill");
}

/**
 * Discover skills from a file or directory path.
 * Pi discovery supports direct root .md files and recursive SKILL.md files.
 * @param {string} skillPath - Path to a skill file or skill directory
 * @param {string} source - Source identifier
 * @returns {Promise<Array>} Array of skill objects
 */
async function discoverSkillPath(skillPath, source) {
	try {
		const stats = await fs.stat(skillPath);
		if (stats.isFile() && skillPath.endsWith(".md")) {
			const skill = await parseSkillFile(skillPath, source);
			return skill ? [skill] : [];
		}
		if (stats.isDirectory()) {
			return discoverSkills(skillPath, source, true);
		}
	} catch (err) {
		if (err.code !== "ENOENT") {
			logger.warn(`[Skills] Error reading ${skillPath}:`, err.message);
		}
	}

	return [];
}

/**
 * Get skills from a directory (Pi skill format).
 * @param {string} skillsDir - Path to skills directory
 * @param {string} source - Source identifier
 * @param {boolean} includeRootFiles - Include direct .md children at this directory level
 * @returns {Promise<Array>} Array of skill objects
 */
async function discoverSkills(skillsDir, source, includeRootFiles = true) {
	const skills = [];

	try {
		const entries = await fs.readdir(skillsDir, { withFileTypes: true });

		for (const entry of entries) {
			// Skip hidden entries and common non-skill directories
			if (entry.name.startsWith(".") || entry.name === "node_modules") continue;

			const entryPath = path.join(skillsDir, entry.name);
			let isDirectory = entry.isDirectory();
			let isFile = entry.isFile();

			if (entry.isSymbolicLink()) {
				try {
					const stats = await fs.stat(entryPath);
					isDirectory = stats.isDirectory();
					isFile = stats.isFile();
				} catch {
					continue;
				}
			}

			if (isDirectory) {
				skills.push(...(await discoverSkills(entryPath, source, false)));
				continue;
			}

			if (!isFile) continue;

			const isRootMarkdown = includeRootFiles && entry.name.endsWith(".md");
			const isNestedSkill = !includeRootFiles && entry.name === "SKILL.md";
			if (!isRootMarkdown && !isNestedSkill) continue;

			const skill = await parseSkillFile(entryPath, source);
			if (skill) skills.push(skill);
		}
	} catch (err) {
		if (err.code !== "ENOENT") {
			logger.warn(`[Skills] Error reading ${skillsDir}:`, err.message);
		}
	}

	return skills;
}

async function discoverExtensionSkillDirs(rootDir) {
	const skillDirs = [];

	async function walk(directory) {
		let entries;
		try {
			entries = await fs.readdir(directory, { withFileTypes: true });
		} catch (err) {
			if (err.code !== "ENOENT") {
				logger.warn(`[Skills] Error reading ${directory}:`, err.message);
			}
			return;
		}

		for (const entry of entries) {
			if (entry.name.startsWith(".") || entry.name === "node_modules") continue;

			const entryPath = path.join(directory, entry.name);
			let isDirectory = entry.isDirectory();
			if (entry.isSymbolicLink()) {
				try {
					isDirectory = (await fs.stat(entryPath)).isDirectory();
				} catch {
					continue;
				}
			}
			if (!isDirectory) continue;

			if (entry.name === "skills") {
				skillDirs.push(entryPath);
			} else {
				await walk(entryPath);
			}
		}
	}

	await walk(rootDir);
	return skillDirs;
}

async function getConfiguredSkillPaths(projectPath) {
	const home = os.homedir();
	const agentDir = path.join(home, ".pi", "agent");
	const globalSettings = await readJsonFile(
		path.join(agentDir, "settings.json"),
	);
	const projectSettingsPath = projectPath
		? path.join(projectPath, ".pi", "settings.json")
		: null;
	const projectSettings = projectSettingsPath
		? await readJsonFile(projectSettingsPath)
		: {};

	const enableSkillCommands =
		projectSettings.enableSkillCommands ??
		globalSettings.enableSkillCommands ??
		true;
	if (!enableSkillCommands) return [];

	const globalSkillPaths = Array.isArray(globalSettings.skills)
		? globalSettings.skills
		: [];
	const projectSkillPaths = Array.isArray(projectSettings.skills)
		? projectSettings.skills
		: [];
	const projectBaseDir = projectPath
		? path.join(projectPath, ".pi")
		: process.cwd();

	return [
		...projectSkillPaths.map((skillPath) =>
			resolveConfiguredPath(skillPath, projectBaseDir),
		),
		...globalSkillPaths.map((skillPath) =>
			resolveConfiguredPath(skillPath, agentDir),
		),
	].filter(Boolean);
}

/**
 * Get skills from Pi's discovered skill locations.
 * Mirrors the common Pi locations used by the SDK: ~/.pi/agent/skills,
 * ~/.agents/skills, project ancestor .agents/skills, configured settings
 * paths, and extension package skills under ~/.pi/agent/extensions/.
 * @param {string} projectPath - Optional project path
 * @returns {Promise<Array>} Array of pi skill objects
 */
async function getPiSkills(projectPath = null) {
	const home = os.homedir();
	const agentDir = path.join(home, ".pi", "agent");
	const extensionSkillDirs = await discoverExtensionSkillDirs(
		path.join(agentDir, "extensions"),
	);
	const ancestorAgentsDirs = await getAncestorAgentsSkillDirs(projectPath);
	const configuredSkillPaths = await getConfiguredSkillPaths(projectPath);

	const skillPaths = [
		path.join(agentDir, "skills"),
		path.join(home, ".agents", "skills"),
		...ancestorAgentsDirs,
		...extensionSkillDirs,
		...configuredSkillPaths,
	];

	const skillGroups = await Promise.all(
		skillPaths.map((skillPath) => discoverSkillPath(skillPath, "skill")),
	);

	return skillGroups.flat();
}

/**
 * Get prompt templates from ~/.pi/agent/prompts/
 * These are markdown files that serve as reusable prompts.
 * @returns {Promise<Array>} Array of prompt template objects
 */
async function getPiPrompts() {
	const promptsDir = path.join(os.homedir(), ".pi", "agent", "prompts");
	const prompts = [];

	try {
		const entries = await fs.readdir(promptsDir, { withFileTypes: true });

		for (const entry of entries) {
			if (!entry.isFile() || !entry.name.endsWith(".md")) continue;

			const filePath = path.join(promptsDir, entry.name);
			try {
				const content = await fs.readFile(filePath, "utf-8");
				const frontmatter = parseFrontmatter(content);
				const fileName = path.basename(entry.name, ".md");

				prompts.push({
					name: `/${fileName}`,
					description:
						frontmatter.description || `Run ${fileName} prompt template`,
					path: filePath,
					source: "pi-prompt",
				});
			} catch (err) {
				logger.warn(`[Prompts] Failed to parse ${filePath}:`, err.message);
			}
		}
	} catch (err) {
		if (err.code !== "ENOENT") {
			logger.warn(`[Prompts] Error reading ${promptsDir}:`, err.message);
		}
	}

	return prompts;
}

/**
 * Get all commands merged (pi prompts + pi skills + project skills + project commands, with project taking precedence)
 * @param {string} projectPath - Optional project path
 * @returns {Promise<Array>} Merged array of commands
 */
export async function getAllCommands(projectPath) {
	const [projectCommands, projectSkills, piSkills, piPrompts] =
		await Promise.all([
			getProjectCommands(projectPath),
			getProjectSkills(projectPath),
			getPiSkills(projectPath),
			getPiPrompts(),
		]);

	const commandMap = new Map();

	// Pi prompts first (lowest precedence)
	for (const prompt of piPrompts) {
		commandMap.set(prompt.name, prompt);
	}

	// Pi skills override prompts
	for (const skill of piSkills) {
		commandMap.set(skill.name, skill);
	}

	// Project skills override pi skills
	for (const skill of projectSkills) {
		commandMap.set(skill.name, skill);
	}

	// Project commands override everything
	for (const cmd of projectCommands) {
		commandMap.set(cmd.name, cmd);
	}

	// Convert back to array and sort by name
	return Array.from(commandMap.values()).sort((a, b) =>
		a.name.localeCompare(b.name),
	);
}
