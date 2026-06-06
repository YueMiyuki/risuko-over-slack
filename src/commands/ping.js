import { buildPingBlocks } from "../utils/slack.js";

export async function handlePing({ ack, respond }) {
	const start = Date.now();
	await ack();
	const latency = Date.now() - start;

	await respond({
		blocks: buildPingBlocks(latency),
	});
}
