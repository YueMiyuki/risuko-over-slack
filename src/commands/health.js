import { getGlobalStat, tellActive } from "../risuko.js";
import { buildHealthBlocks, buildErrorBlock } from "../utils/slack.js";

export async function handleHealth({ ack, respond }) {
	await ack();

	let stat;
	let active;
	try {
		stat = await getGlobalStat();
		active = await tellActive([
			"gid",
			"status",
			"totalLength",
			"completedLength",
		]);
	} catch (err) {
		await respond({
			text: `:x: Engine health check failed: ${err.message}`,
			blocks: buildErrorBlock(
				`Engine health check failed:\n\`\`\`${err.message}\`\`\``,
			),
		});
		return;
	}

	await respond({
		text: `Engine Health — Active: ${stat.numActive || 0} | Waiting: ${stat.numWaiting || 0}`,
		blocks: buildHealthBlocks(stat, active),
	});
}
