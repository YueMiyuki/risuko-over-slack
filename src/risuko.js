import risuko from "@risuko/risuko-js";

const {
	startEngine,
	stopEngine,
	addUri,
	tellStatus,
	tellActive,
	getGlobalStat,
	onEvent,
} = risuko;
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const DEFAULT_DOWNLOAD_DIR =
	process.env.DOWNLOAD_DIR || path.join(tmpdir(), "risuko-slack");

export async function initEngine() {
	await mkdir(DEFAULT_DOWNLOAD_DIR, { recursive: true });
	await startEngine({
		rpcPort: Number(process.env.RISUKO_RPC_PORT || 16800),
		enableRpc: process.env.RISUKO_ENABLE_RPC !== "false",
	});
}

export async function shutdownEngine() {
	await stopEngine();
}

export {
	addUri,
	tellStatus,
	tellActive,
	getGlobalStat,
	onEvent,
	DEFAULT_DOWNLOAD_DIR,
};
