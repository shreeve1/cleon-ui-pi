import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { getAllCommands } from "../../server/commands.js";

const tempDirs = [];

async function createTempHome() {
	const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "cleon-commands-"));
	tempDirs.push(tempHome);
	vi.spyOn(os, "homedir").mockReturnValue(tempHome);
	return tempHome;
}

async function writeFile(filePath, content) {
	await fs.mkdir(path.dirname(filePath), { recursive: true });
	await fs.writeFile(filePath, content, "utf-8");
}

function skillContent(name, description) {
	return `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`;
}

afterEach(async () => {
	vi.restoreAllMocks();
	await Promise.all(
		tempDirs
			.splice(0)
			.map((dir) => fs.rm(dir, { recursive: true, force: true })),
	);
});

describe("getAllCommands", () => {
	it("includes Claude directory skills from ~/.claude/skills", async () => {
		const home = await createTempHome();
		await writeFile(
			path.join(home, ".claude", "skills", "diagnose", "SKILL.md"),
			skillContent("diagnose", "Diagnose bugs"),
		);

		const commands = await getAllCommands();

		expect(commands).toContainEqual(
			expect.objectContaining({
				name: "/diagnose",
				description: "Diagnose bugs",
				source: "skill",
			}),
		);
	});

	it("includes standalone Claude skill files from ~/.claude/skills", async () => {
		const home = await createTempHome();
		await writeFile(
			path.join(home, ".claude", "skills", "netbird-troubleshoot.md"),
			skillContent("netbird-troubleshoot", "Diagnose NetBird VPN"),
		);

		const commands = await getAllCommands();

		expect(commands).toContainEqual(
			expect.objectContaining({
				name: "/netbird-troubleshoot",
				description: "Diagnose NetBird VPN",
				source: "skill",
			}),
		);
	});

	it("includes Pi extension skills from ~/.pi/agent/extensions/*/skills", async () => {
		const home = await createTempHome();
		await writeFile(
			path.join(
				home,
				".pi",
				"agent",
				"extensions",
				"rpiv-pi",
				"skills",
				"research",
				"SKILL.md",
			),
			skillContent("research", "Research codebase area"),
		);

		const commands = await getAllCommands();

		expect(commands).toContainEqual(
			expect.objectContaining({
				name: "/research",
				description: "Research codebase area",
				source: "skill",
			}),
		);
	});

	it("lets project commands override global skills with same name", async () => {
		const home = await createTempHome();
		const projectPath = path.join(home, "project");

		await writeFile(
			path.join(home, ".claude", "skills", "diagnose", "SKILL.md"),
			skillContent("diagnose", "Global diagnose skill"),
		);
		await writeFile(
			path.join(projectPath, ".pi", "commands", "diagnose.md"),
			"---\ndescription: Project diagnose command\n---\n\n# Diagnose\n",
		);

		const commands = await getAllCommands(projectPath);
		const diagnose = commands.find((cmd) => cmd.name === "/diagnose");

		expect(diagnose).toMatchObject({
			name: "/diagnose",
			description: "Project diagnose command",
			source: "project",
		});
	});
});
