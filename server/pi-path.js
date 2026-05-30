/**
 * Pi session directory name codec.
 *
 * Pi stores sessions under ~/.pi/agent/sessions/<dirName>/
 * where dirName is the project path encoded as --Users-james-project--.
 * This module centralises that encoding so it's defined once.
 */

import { promises as fs } from "fs";
import path from "path";

/**
 * Encode a project path to Pi's session directory name format.
 * e.g. /Users/james/myproject → --Users-james-myproject--
 *
 * @param {string} projectPath - Absolute path (must start with /)
 * @returns {string} Encoded directory name
 */
export function encode(projectPath) {
	return "--" + projectPath.slice(1).replace(/\//g, "-") + "--";
}

/**
 * Decode a Pi session directory name back to a project path.
 * e.g. --Users-james-myproject-- → /Users/james/myproject
 *
 * Note: lossy for paths that contain actual dashes.
 *
 * @param {string} dirName - Pi session directory name
 * @returns {string} Decoded project path
 */
export function decode(dirName) {
	return "/" + dirName.slice(2, -2).replace(/-/g, "/");
}

/**
 * Check whether a string looks like a Pi session directory name.
 *
 * @param {string} name - String to check
 * @returns {boolean}
 */
export function isPiDirName(name) {
	return name.startsWith("--") && name.endsWith("--");
}

/**
 * Extract the actual project path from Pi session files.
 * Reads the JSONL session header for { type: "session", cwd: "..." }.
 * Falls back to decoding the directory name.
 *
 * @param {string} piDir - Absolute path to the session directory
 * @param {string} dirName - The Pi session directory name
 * @returns {Promise<string>} Resolved project path
 */
export async function extractProjectPath(piDir, dirName) {
	try {
		const files = await fs.readdir(piDir);
		const jsonlFiles = files.filter((f) => f.endsWith(".jsonl"));

		for (const jsonlFile of jsonlFiles) {
			try {
				const content = await fs.readFile(path.join(piDir, jsonlFile), "utf8");
				const firstLine = content.split("\n")[0];
				if (!firstLine) continue;

				const entry = JSON.parse(firstLine);
				if (entry.type === "session" && entry.cwd) {
					return entry.cwd;
				}
			} catch {
				/* skip malformed */
			}
		}

		return decode(dirName);
	} catch {
		return decode(dirName);
	}
}
