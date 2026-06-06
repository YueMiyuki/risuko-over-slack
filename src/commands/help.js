import { buildHelpBlocks } from "../utils/slack.js";

export async function handleHelp({ ack, respond }) {
	await ack();
	await respond({
		blocks: buildHelpBlocks(),
	});
}
