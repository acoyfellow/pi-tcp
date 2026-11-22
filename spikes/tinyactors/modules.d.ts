declare module "*.scxml" {
	const text: string;
	export default text;
}

declare module "@tinyactors/wasm/tinyactors.wasm" {
	const module: WebAssembly.Module;
	export default module;
}
