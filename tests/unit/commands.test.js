import { mkdtemp, mkdir, writeFile, rm } from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { getAllCommands } from "../../server/commands.js";

const tempHomes = [];
const originalHome = process.env.HOME;

async function createSkill(root, name, description = `${name} skill`) {
	const skillDir = path.join(root, name);
	await mkdir(skillDir, { recursive: true });
	await writeFile(
		path.join(skillDir, "SKILL.md"),
		`---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`,
	);
}

afterEach(async () => {
	process.env.HOME = originalHome;
	await Promise.all(
		tempHomes.map((dir) => rm(dir, { recursive: true, force: true })),
	);
	tempHomes.length = 0;
});

describe("getAllCommands skill discovery", () => {
	it("mirrors Pi skill locations and settings skill paths", async () => {
		const home = await mkdtemp(path.join(os.tmpdir(), "cleon-commands-"));
		tempHomes.push(home);
		process.env.HOME = home;

		await createSkill(path.join(home, ".pi", "agent", "skills"), "dotfiles");
		await createSkill(path.join(home, ".agents", "skills"), "gitnexus-cli");
		await createSkill(
			path.join(home, ".pi", "agent", "extensions", "rpiv-pi", "skills"),
			"research",
		);
		await createSkill(path.join(home, ".claude", "skills"), "diagnose");

		// Case A — no-git project: findGitRepoRoot returns null, falls back to
		// projectPath itself, so <project>/.claude/skills resolves.
		const project = await mkdtemp(path.join(os.tmpdir(), "cleon-project-"));
		tempHomes.push(project);
		await createSkill(
			path.join(project, ".claude", "skills"),
			"symphony-suite",
		);

		// Case B — git-rooted project: skill lives at the git root, but
		// getAllCommands receives a NESTED subdir, so resolution only works if
		// findGitRepoRoot walks up to the root containing .git.
		const gitRoot = await mkdtemp(path.join(os.tmpdir(), "cleon-gitroot-"));
		tempHomes.push(gitRoot);
		await mkdir(path.join(gitRoot, ".git"));
		await mkdir(path.join(gitRoot, "sub", "dir"), { recursive: true });
		await createSkill(path.join(gitRoot, ".claude", "skills"), "rooted-suite");

		// Empty settings: pins ~/.claude/skills via the explicit getPiSkills
		// entry, NOT via getConfiguredSkillPaths (which would mask it).
		await mkdir(path.join(home, ".pi", "agent"), { recursive: true });
		await writeFile(
			path.join(home, ".pi", "agent", "settings.json"),
			JSON.stringify({}),
		);

		// Case B call: nested path forces git-root walk-up.
		const commands = await getAllCommands(path.join(gitRoot, "sub", "dir"));
		const names = commands.map((cmd) => cmd.name);

		expect(names).toContain("/skill:dotfiles");
		expect(names).toContain("/skill:gitnexus-cli");
		expect(names).toContain("/skill:research");
		expect(names).toContain("/skill:diagnose");
		expect(names).toContain("/skill:rooted-suite");
		// Case A resolves via a separate call (no-git fallback path).
		const fallback = await getAllCommands(project);
		expect(fallback.map((c) => c.name)).toContain("/skill:symphony-suite");
	});
});
