export function sameSecret(given: string, expected: string): boolean {
	const a = new TextEncoder().encode(given);
	const b = new TextEncoder().encode(expected);
	if (!expected || a.length !== b.length) return false;
	let difference = 0;
	for (let index = 0; index < a.length; index++) difference |= a[index] ^ b[index];
	return difference === 0;
}

const SESSION_NAME = /^[a-z0-9][a-z0-9-]{0,62}$/;

export function validSessionName(name: string): boolean {
	return SESSION_NAME.test(name);
}
