import { stat, unlink } from "node:fs/promises";

const SLACK_FILE_SIZE_LIMIT = Number(
	process.env.SLACK_FILE_SIZE_LIMIT_BYTES || "1073741824",
); // 1 GB default

export async function checkFileSize(filePath) {
	try {
		const s = await stat(filePath);
		return s.size;
	} catch {
		return 0;
	}
}

export async function deleteFile(filePath) {
	try {
		await unlink(filePath);
	} catch {
		// ignore
	}
}

export function isFileWithinSlackLimit(size) {
	return size <= SLACK_FILE_SIZE_LIMIT;
}

export function formatBytes(bytes) {
	if (bytes === 0) return "0 B";
	const k = 1024;
	const sizes = ["B", "KB", "MB", "GB", "TB"];
	const i = Math.floor(Math.log(bytes) / Math.log(k));
	return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

export function header(text) {
	return { type: "header", text: { type: "plain_text", text, emoji: true } };
}

export function section(text) {
	return { type: "section", text: { type: "mrkdwn", text } };
}

export function fields(...pairs) {
	return {
		type: "section",
		fields: pairs.map(([title, value]) => ({
			type: "mrkdwn",
			text: `*${title}*\n${value}`,
		})),
	};
}

export function divider() {
	return { type: "divider" };
}

export function context(...items) {
	return {
		type: "context",
		elements: items.map((t) => ({ type: "mrkdwn", text: t })),
	};
}

export function actions(blockId, elements) {
	return { type: "actions", block_id: blockId, elements };
}

export function button(text, actionId, value, style) {
	const b = {
		type: "button",
		text: { type: "plain_text", text },
		value: JSON.stringify(value),
		action_id: actionId,
	};
	if (style) b.style = style;
	return b;
}

/* ------------------------------------------------------------------ */
/*  Pre-built layouts                                                   */
/* ------------------------------------------------------------------ */

export function buildPreDownloadDestinationBlocks(interactionId, url) {
	return [
		section(
			`Ready to download \`${url}\`. Where should the file go after it finishes?`,
		),
		actions(`dest_${interactionId}`, [
			button("This channel", "download_dest_channel", {
				interactionId,
				destination: "channel",
			}),
			button("My DM", "download_dest_dm", { interactionId, destination: "dm" }),
		]),
	];
}

export function buildErrorBlock(message) {
	return [section(`:x: ${message}`)];
}

export function buildDownloadCompleteBlocks(gid, filename, size, destination) {
	const destLabel = destination === "dm" ? "your DM" : "this channel";
	return [
		header(":white_check_mark: Download Complete"),
		fields(
			["GID", `\`${gid}\``],
			["File", `\`${filename}\``],
			["Size", formatBytes(size)],
			["Destination", destLabel],
		),
		divider(),
		section(`:arrow_up: Uploaded to ${destLabel}`),
	];
}

export function buildDownloadErrorBlocks(gid, errorCode, errorMessage) {
	return [
		header(":x: Download Failed"),
		fields(["GID", `\`${gid}\``], ["Error Code", errorCode || "N/A"]),
		section(`:warning: *Message:*\n${errorMessage || "Unknown error"}`),
	];
}

export function buildHealthBlocks(stat, activeTasks) {
	const blocks = [
		header(":white_check_mark: Engine Health"),
		fields(
			["Download Speed", `${formatBytes(Number(stat.downloadSpeed || 0))}/s`],
			["Upload Speed", `${formatBytes(Number(stat.uploadSpeed || 0))}/s`],
			["Active", String(stat.numActive || 0)],
			["Waiting", String(stat.numWaiting || 0)],
			["Stopped", String(stat.numStopped || 0)],
		),
	];

	if (activeTasks && activeTasks.length > 0) {
		blocks.push(divider(), section("*Active Downloads*"));
		for (const task of activeTasks) {
			const total = Number(task.totalLength || 0);
			const completed = Number(task.completedLength || 0);
			const pct = total > 0 ? ((completed / total) * 100).toFixed(1) : "0.0";
			const bar =
				"█".repeat(Math.floor(pct / 10)) +
				"░".repeat(10 - Math.floor(pct / 10));
			blocks.push(
				section(
					`\`${task.gid}\` — *${task.status}* — ${pct}%\n\`${bar}\` ${formatBytes(completed)}/${formatBytes(total)}`,
				),
			);
		}
	} else {
		blocks.push(divider(), section("No active downloads."));
	}

	return blocks;
}

export function buildPingBlocks(latency) {
	return [
		header(":table_tennis_paddle_and_ball: Pong!"),
		fields(
			["Latency", `\`${latency}ms\``],
			["Status", ":large_green_circle: Online"],
		),
		context(`Risuko Slack Bot — ${new Date().toISOString()}`),
	];
}

export function buildHelpBlocks() {
	return [
		header(":wave: Hello! I'm the Risuko Slack Bot."),
		section(
			"I can help you download things via the internet and upload them to slack. Here are some commands to get you started:",
		),
		fields(
			["/risuko-ping", "Check if I'm responsive and see the latency."],
			["/risuko-health", "Get the current health status of the Risuko engine."],
			["/risuko-download <URL>", "Start a new download by providing a URL."],
		),
		divider(),
		context(
			"Feel free to reach out if you have any questions or need assistance!",
		),
        context(
			"Here: https://github.com/YueMiyuki",
		),
	];
}
