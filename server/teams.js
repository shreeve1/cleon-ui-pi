import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

const globalAgentsDir = path.join(os.homedir(), '.pi', 'agent', 'agents');

function parseSimpleYamlTeams(raw) {
  const teams = {};
  let currentTeam = null;

  const lines = String(raw || '').split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith('#')) continue;

    const teamMatch = line.match(/^([A-Za-z0-9_-]+):\s*$/);
    if (teamMatch) {
      currentTeam = teamMatch[1];
      teams[currentTeam] = [];
      continue;
    }

    const memberMatch = line.match(/^\s*-\s*([A-Za-z0-9._-]+)\s*$/);
    if (memberMatch && currentTeam) {
      teams[currentTeam].push(memberMatch[1]);
    }
  }

  return teams;
}

function parseFrontmatter(raw) {
  const match = String(raw || '').match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: String(raw || '') };

  const fmRaw = match[1];
  const body = match[2] || '';
  const frontmatter = {};

  for (const line of fmRaw.split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1].trim();
    let value = kv[2].trim();

    if (value.startsWith('[') && value.endsWith(']')) {
      value = value
        .slice(1, -1)
        .split(',')
        .map(v => v.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean);
    }

    frontmatter[key] = value;
  }

  return { frontmatter, body };
}

async function fileExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function loadTeams() {
  const teamsYamlPath = path.join(globalAgentsDir, 'teams.yaml');

  try {
    const raw = await fs.readFile(teamsYamlPath, 'utf8');
    const teams = parseSimpleYamlTeams(raw);
    return { teams, source: teamsYamlPath };
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      console.warn('[teams] Failed to read teams.yaml:', error.message || error);
    }
    return { teams: {}, source: null, error: 'teams.yaml not found or unreadable' };
  }
}

export async function loadAgentDefinition(agentName, projectPath = process.cwd()) {
  const candidateDirs = [
    globalAgentsDir,
    path.join(projectPath, '.pi', 'agents'),
    path.join(projectPath, '.claude', 'agents'),
  ];

  const fileName = `${agentName}.md`;

  for (const dir of candidateDirs) {
    const filePath = path.join(dir, fileName);
    if (!(await fileExists(filePath))) continue;

    try {
      const raw = await fs.readFile(filePath, 'utf8');
      const { frontmatter, body } = parseFrontmatter(raw);

      const toolsRaw = frontmatter.tools;
      const tools = Array.isArray(toolsRaw)
        ? toolsRaw
        : typeof toolsRaw === 'string' && toolsRaw.length > 0
          ? toolsRaw.split(',').map(t => t.trim()).filter(Boolean)
          : [];

      return {
        name: frontmatter.name || agentName,
        description: frontmatter.description || '',
        model: frontmatter.model || '',
        tools,
        systemPrompt: body.trim(),
        file: filePath,
      };
    } catch (error) {
      console.warn(`[teams] Failed to parse agent definition ${filePath}:`, error.message || error);
      return null;
    }
  }

  return null;
}

export async function getTeamRoster(teamName, projectPath = process.cwd()) {
  const { teams } = await loadTeams();
  const members = teams[teamName] || [];

  const defs = [];
  for (const memberName of members) {
    const def = await loadAgentDefinition(memberName, projectPath);
    if (def) defs.push(def);
  }

  return {
    name: teamName,
    members: defs,
  };
}
