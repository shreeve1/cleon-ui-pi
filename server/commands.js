import fs from "fs/promises";
import path from "path";
import os from "os";

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
		console.warn(`[Commands] Failed to parse ${filePath}:`, err.message);
		return null;
	}
}

/**
 * Parse a Pi/Claude skill file and extract metadata
 * @param {string} filePath - Path to SKILL.md or a standalone .md skill file
 * @param {string} fallbackName - Name to use when frontmatter has no name
 * @param {string} source - Source identifier
 * @returns {Promise<Object|null>} Skill object or null if parsing fails
 */
async function parseSkillFile(filePath, fallbackName, source) {
	try {
		const content = await fs.readFile(filePath, "utf-8");
		const frontmatter = parseFrontmatter(content);
		const name = frontmatter.name || fallbackName;

		return {
			name: `/${name}`,
			description: frontmatter.description || `Run ${fallbackName} skill`,
			path: filePath,
			source,
		};
	} catch (err) {
		if (err.code !== "ENOENT") {
			console.warn(`[Skills] Failed to parse ${filePath}:`, err.message);
		}
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
			console.warn(`[Commands] Error reading ${directory}:`, err.message);
		}
	}

	return commands;
}

/**
 * Get project-specific commands from <projectPath>/.pi/commands/
 * @param {string} projectPath - The project's filesystem path
 * @returns {Promise<Array>} Array of project command objects
 */
export async function getProjectCommands(projectPath) {
	if (!projectPath) return [];

	const projectDir = path.join(projectPath, ".pi", "commands");
	return discoverCommands(projectDir, "project");
}

/**
 * Get project-specific skills from <projectPath>/.pi/skills/
 * Only includes top-level skills that have a SKILL.md file.
 * @param {string} projectPath - The project's filesystem path
 * @returns {Promise<Array>} Array of project skill objects
 */
export async function getProjectSkills(projectPath) {
	if (!projectPath) return [];

	const skillsDir = path.join(projectPath, ".pi", "skills");
	return discoverSkills(skillsDir, "skill");
}

/**
 * Get skills from a directory (Pi skill format)
 * Only includes top-level skills that have a SKILL.md file.
 * @param {string} skillsDir - Path to skills directory
 * @param {string} source - Source identifier
 * @returns {Promise<Array>} Array of skill objects
 */
async function discoverSkills(skillsDir, source) {
	const skills = [];

	try {
		const entries = await fs.readdir(skillsDir, { withFileTypes: true });

		for (const entry of entries) {
			// Skip hidden entries and common non-skill directories
			if (entry.name.startsWith(".") || entry.name === "node_modules") continue;

			if (entry.isDirectory()) {
				const skillFile = path.join(skillsDir, entry.name, "SKILL.md");
				const skill = await parseSkillFile(skillFile, entry.name, source).catch(
					() => null,
				);
				if (skill) skills.push(skill);
				continue;
			}

			// Claude also supports standalone skill files like netbird-troubleshoot.md
			if (
				entry.isFile() &&
				entry.name.endsWith(".md") &&
				entry.name !== "SKILL.md"
			) {
				const filePath = path.join(skillsDir, entry.name);
				const fallbackName = path.basename(entry.name, ".md");
				const skill = await parseSkillFile(filePath, fallbackName, source);
				if (skill) skills.push(skill);
			}
		}
	} catch (err) {
		if (err.code !== "ENOENT") {
			console.warn(`[Skills] Error reading ${skillsDir}:`, err.message);
		}
	}

	return skills;
}

/**
 * Get skills from ~/.pi/agent/skills/
 * Only includes top-level skills that have a SKILL.md file.
 * @returns {Promise<Array>} Array of pi skill objects
 */
export async function getPiSkills() {
	const skillsDir = path.join(os.homedir(), ".pi", "agent", "skills");
	return discoverSkills(skillsDir, "skill");
}

/**
 * Get skills from ~/.pi/agent/extensions/<extension>/skills/
 * @returns {Promise<Array>} Array of pi extension skill objects
 */
export async function getPiExtensionSkills() {
	const extensionsDir = path.join(os.homedir(), ".pi", "agent", "extensions");
	const skills = [];

	try {
		const entries = await fs.readdir(extensionsDir, { withFileTypes: true });

		for (const entry of entries) {
			if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
			const extensionSkillsDir = path.join(extensionsDir, entry.name, "skills");
			skills.push(...(await discoverSkills(extensionSkillsDir, "skill")));
		}
	} catch (err) {
		if (err.code !== "ENOENT") {
			console.warn(`[Skills] Error reading ${extensionsDir}:`, err.message);
		}
	}

	return skills;
}

/**
 * Get skills from ~/.claude/skills/
 * @returns {Promise<Array>} Array of Claude skill objects
 */
export async function getClaudeSkills() {
	const skillsDir = path.join(os.homedir(), ".claude", "skills");
	return discoverSkills(skillsDir, "skill");
}

/**
 * Get prompt templates from ~/.pi/agent/prompts/
 * These are markdown files that serve as reusable prompts.
 * @returns {Promise<Array>} Array of prompt template objects
 */
export async function getPiPrompts() {
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
				console.warn(`[Prompts] Failed to parse ${filePath}:`, err.message);
			}
		}
	} catch (err) {
		if (err.code !== "ENOENT") {
			console.warn(`[Prompts] Error reading ${promptsDir}:`, err.message);
		}
	}

	return prompts;
}

/**
 * Get all commands merged (pi prompts + extension skills + global skills + project skills + project commands, with project taking precedence)
 * @param {string} projectPath - Optional project path
 * @returns {Promise<Array>} Merged array of commands
 */
export async function getAllCommands(projectPath) {
	const [
		projectCommands,
		projectSkills,
		piSkills,
		piExtensionSkills,
		claudeSkills,
		piPrompts,
	] = await Promise.all([
		getProjectCommands(projectPath),
		getProjectSkills(projectPath),
		getPiSkills(),
		getPiExtensionSkills(),
		getClaudeSkills(),
		getPiPrompts(),
	]);

	const commandMap = new Map();

	// Pi prompts first (lowest precedence)
	for (const prompt of piPrompts) {
		commandMap.set(prompt.name, prompt);
	}

	// Bundled extension skills override prompts
	for (const skill of piExtensionSkills) {
		commandMap.set(skill.name, skill);
	}

	// Claude skills override bundled extension skills
	for (const skill of claudeSkills) {
		commandMap.set(skill.name, skill);
	}

	// Pi skills override Claude/extension skills
	for (const skill of piSkills) {
		commandMap.set(skill.name, skill);
	}

	// Project skills override global skills
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
