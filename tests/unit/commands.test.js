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
		await mkdir(path.join(home, ".pi", "agent"), { recursive: true });
		await writeFile(
			path.join(home, ".pi", "agent", "settings.json"),
			JSON.stringify({ skills: ["~/.claude/skills"] }),
		);

		const commands = await getAllCommands("/tmp/project");
		const names = commands.map((cmd) => cmd.name);

		expect(names).toContain("/skill:dotfiles");
		expect(names).toContain("/skill:gitnexus-cli");
		expect(names).toContain("/skill:research");
		expect(names).toContain("/skill:diagnose");
	});
});
