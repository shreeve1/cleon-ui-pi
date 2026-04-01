import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';
import { getTeamRoster } from './teams.js';

const dispatcherPath = path.join(os.homedir(), '.pi', 'agent', 'agents', 'dispatcher.md');

async function loadDispatcherPrompt() {
  try {
    return await fs.readFile(dispatcherPath, 'utf8');
  } catch {
    return 'You are a dispatcher. Delegate work to specialist agents using dispatch_agent.';
  }
}

export async function createDispatcherSession(team, projectPath) {
  const roster = await getTeamRoster(team, projectPath);
  const dispatcherGuide = await loadDispatcherPrompt();

  const membersText = roster.members
    .map(m => `- ${m.name}: ${m.description || 'specialist'}`)
    .join('\n');

  const systemPrompt = `${dispatcherGuide.trim()}\n\nActive team: ${team}\nMembers:\n${membersText || '- (none)'}`;

  const dispatchAgentTool = {
    name: 'dispatch_agent',
    description: 'Dispatch a task to a specialist team member',
    parameters: {
      type: 'object',
      properties: {
        agent: { type: 'string', description: 'Agent name to dispatch to' },
        task: { type: 'string', description: 'Task for the specialist' },
      },
      required: ['agent', 'task'],
    },
    async execute(_toolCallId, params) {
      const agentName = String(params?.agent || '').trim();
      const task = String(params?.task || '').trim();

      if (!agentName || !task) {
        return { content: [{ type: 'text', text: 'Missing required params: agent and task' }], isError: true };
      }

      const agent = roster.members.find(m => m.name.toLowerCase() === agentName.toLowerCase());
      if (!agent) {
        return { content: [{ type: 'text', text: `Unknown team agent: ${agentName}` }], isError: true };
      }

      const args = [
        '--mode', 'json',
        '-p',
        '--no-extensions',
      ];

      if (agent.model) {
        args.push('--model', agent.model);
      }

      if (agent.tools?.length) {
        args.push('--tools', agent.tools.join(','));
      }

      args.push(task);

      try {
        const resultText = await new Promise((resolve, reject) => {
          const child = spawn('pi', args, { cwd: projectPath });
          let stdout = '';
          let stderr = '';

          child.stdout.on('data', (d) => { stdout += String(d); });
          child.stderr.on('data', (d) => { stderr += String(d); });
          child.on('error', reject);
          child.on('close', (code) => {
            if (code === 0) {
              resolve(stdout.trim() || '(no output)');
            } else {
              reject(new Error(stderr.trim() || `pi exited with code ${code}`));
            }
          });
        });

        return {
          content: [{ type: 'text', text: `Agent ${agent.name} completed task.\n\n${resultText}` }],
          isError: false,
        };
      } catch (error) {
        const msg = error?.code === 'ENOENT'
          ? 'pi binary not found in PATH'
          : (error?.message || String(error));
        return {
          content: [{ type: 'text', text: `Dispatch failed for ${agent.name}: ${msg}` }],
          isError: true,
        };
      }
    },
  };

  return {
    team,
    roster,
    systemPrompt,
    customTools: [dispatchAgentTool],
    initialActiveToolNames: ['dispatch_agent'],
    // Fallback for SDK/tool gating edge-cases
    toolGatingFallback: {
      allowedTools: ['dispatch_agent'],
      mode: 'strict',
    },
  };
}
