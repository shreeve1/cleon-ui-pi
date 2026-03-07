import fs from 'fs/promises';
import path from 'path';
import os from 'os';

/**
 * Parse YAML frontmatter from a markdown file content
 * @param {string} content - The markdown file content
 * @returns {Object} Parsed frontmatter as an object
 */
function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};

  const frontmatter = {};
  const lines = match[1].split('\n');

  for (const line of lines) {
    const colonIndex = line.indexOf(':');
    if (colonIndex > 0) {
      const key = line.slice(0, colonIndex).trim();
      const value = line.slice(colonIndex + 1).trim();
      // Remove quotes if present
      frontmatter[key] = value.replace(/^["']|["']$/g, '');
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
    const content = await fs.readFile(filePath, 'utf-8');
    const frontmatter = parseFrontmatter(content);
    const fileName = path.basename(filePath, '.md');

    return {
      name: `/${fileName}`,
      description: frontmatter.description || `Run ${fileName} command`,
      path: filePath
    };
  } catch (err) {
    console.warn(`[Commands] Failed to parse ${filePath}:`, err.message);
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
      if (entry.isFile() && entry.name.endsWith('.md')) {
        const filePath = path.join(directory, entry.name);
        const command = await parseCommandFile(filePath);

        if (command) {
          commands.push({
            ...command,
            source
          });
        }
      }
    }
  } catch (err) {
    // Directory doesn't exist or can't be read - that's OK
    if (err.code !== 'ENOENT') {
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

  const projectDir = path.join(projectPath, '.pi', 'commands');
  return discoverCommands(projectDir, 'project');
}

/**
 * Get project-specific skills from <projectPath>/.pi/skills/
 * Only includes top-level skills that have a SKILL.md file.
 * @param {string} projectPath - The project's filesystem path
 * @returns {Promise<Array>} Array of project skill objects
 */
export async function getProjectSkills(projectPath) {
  if (!projectPath) return [];

  const skillsDir = path.join(projectPath, '.pi', 'skills');
  return discoverSkills(skillsDir, 'skill');
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
      if (!entry.isDirectory()) continue;

      // Skip hidden directories and common non-skill directories
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;

      const skillFile = path.join(skillsDir, entry.name, 'SKILL.md');
      try {
        const content = await fs.readFile(skillFile, 'utf-8');
        const frontmatter = parseFrontmatter(content);

        skills.push({
          name: `/${frontmatter.name || entry.name}`,
          description: frontmatter.description || `Run ${entry.name} skill`,
          path: skillFile,
          source
        });
      } catch {
        // No SKILL.md in this directory - skip it
      }
    }
  } catch (err) {
    if (err.code !== 'ENOENT') {
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
  const skillsDir = path.join(os.homedir(), '.pi', 'agent', 'skills');
  return discoverSkills(skillsDir, 'skill');
}

/**
 * Get prompt templates from ~/.pi/agent/prompts/
 * These are markdown files that serve as reusable prompts.
 * @returns {Promise<Array>} Array of prompt template objects
 */
export async function getPiPrompts() {
  const promptsDir = path.join(os.homedir(), '.pi', 'agent', 'prompts');
  const prompts = [];

  try {
    const entries = await fs.readdir(promptsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;

      const filePath = path.join(promptsDir, entry.name);
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        const frontmatter = parseFrontmatter(content);
        const fileName = path.basename(entry.name, '.md');

        prompts.push({
          name: `/${fileName}`,
          description: frontmatter.description || `Run ${fileName} prompt template`,
          path: filePath,
          source: 'pi-prompt'
        });
      } catch (err) {
        console.warn(`[Prompts] Failed to parse ${filePath}:`, err.message);
      }
    }
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.warn(`[Prompts] Error reading ${promptsDir}:`, err.message);
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
  const [projectCommands, projectSkills, piSkills, piPrompts] = await Promise.all([
    getProjectCommands(projectPath),
    getProjectSkills(projectPath),
    getPiSkills(),
    getPiPrompts()
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
    a.name.localeCompare(b.name)
  );
}
