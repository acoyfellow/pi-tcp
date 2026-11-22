import { SESSION_NAME_PATTERN } from "./protocol";

const encoder = new TextEncoder();

export function sameSecret(given: string, expected: string): boolean {
	const left = encoder.encode(given);
	const right = encoder.encode(expected);
	if (expected.length === 0 || left.length !== right.length) {
		return false;
	}
	let difference = 0;
	for (const [index, byte] of left.entries()) {
		difference |= byte ^ (right[index] ?? 0);
	}
	return difference === 0;
}

export function validSessionName(name: string): boolean {
	return SESSION_NAME_PATTERN.test(name);
}
