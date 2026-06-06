import path from "node:path";
import {
	addUri,
	tellStatus,
	DEFAULT_DOWNLOAD_DIR,
	onEvent,
} from "../risuko.js";
import {
	checkFileSize,
	isFileWithinSlackLimit,
	formatBytes,
	deleteFile,
	buildErrorBlock,
	buildDownloadCompleteBlocks,
	buildDownloadErrorBlocks,
	header,
	section,
	fields,
} from "../utils/slack.js";
import { compressAndPickSmallest } from "../utils/compress.js";

const activeDownloads = new Map(); // gid -> { userId, channelId, messageTs, destination, filePath, fileSize, uploadFilename }
const pendingDownloads = new Map(); // interactionId -> { url, options, userId, channelId, messageTs }

function generateId() {
	return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function parseEventPayload(arg1, arg2) {
	const raw =
		typeof arg1 === "string" && arg1.includes(",")
			? arg1
			: typeof arg2 === "string" && arg2.includes(",")
				? arg2
				: typeof arg1 === "string"
					? arg1
					: typeof arg2 === "string"
						? arg2
						: String(arg1 || arg2 || "");

	const [event, ...rest] = raw.split(",");
	return { event: event?.trim() || "", gid: rest.join(",").trim() };
}

export function registerDownloadCallbacks(client) {
	onEvent(async (arg1, arg2) => {
		const { event, gid } = parseEventPayload(arg1, arg2);
		const ctx = activeDownloads.get(gid);
		if (!ctx) return;

		try {
			if (event === "risuko.onDownloadStart") {
				await client.chat.update({
					channel: ctx.channelId,
					ts: ctx.messageTs,
					text: `Download started (GID: \`${gid}\`).`,
					blocks: [
						header(":arrow_down: Downloading..."),
						section(`GID: \`${gid}\``),
						section(
							":hourglass_flowing_sand: Download has started. I'll upload it automatically when complete.",
						),
					],
				});
			}

			if (event === "risuko.onDownloadComplete") {
				const status = await tellStatus(gid);
				const filePath = resolveDownloadPath(status, ctx);

				let finalPath = filePath;
				try {
					finalPath = await compressAndPickSmallest(filePath);
				} catch (err) {
					console.error("Compression failed:", err.message);
				}

				const finalSize = await checkFileSize(finalPath);
				const uploadFilename = path.basename(finalPath);

				if (!isFileWithinSlackLimit(finalSize)) {
					await deleteFile(finalPath);
					activeDownloads.delete(gid);
					await client.chat.update({
						channel: ctx.channelId,
						ts: ctx.messageTs,
						text: `Download \`${gid}\` too large (${formatBytes(finalSize)}). File deleted.`,
						blocks: [
							header(":x: Too Big for Slack"),
							fields(["GID", `\`${gid}\``], ["Size", formatBytes(finalSize)]),
							section(
								":warning: Exceeds Slack upload limit. Temp file deleted.",
							),
						],
					});
					return;
				}

				try {
					await uploadToDestination(
						client,
						ctx,
						finalPath,
						uploadFilename,
						finalSize,
					);
					await client.chat.update({
						channel: ctx.channelId,
						ts: ctx.messageTs,
						text: `Downloaded *${uploadFilename}* (${formatBytes(finalSize)}) and uploaded to ${ctx.destination === "dm" ? "your DM" : "this channel"}.`,
						blocks: buildDownloadCompleteBlocks(
							gid,
							uploadFilename,
							finalSize,
							ctx.destination,
						),
					});
				} catch (err) {
					console.error(`Upload failed GID=${gid}:`, err.message);
					await client.chat.update({
						channel: ctx.channelId,
						ts: ctx.messageTs,
						text: `Download \`${gid}\` completed, but upload failed: ${err.message}`,
						blocks: [header(":x: Upload Failed"), section(err.message)],
					});
				}

				await deleteFile(finalPath);
				activeDownloads.delete(gid);
			}

			if (event === "risuko.onDownloadError") {
				const status = await tellStatus(gid);
				const filePath = resolveDownloadPath(status, ctx);
				await deleteFile(filePath);
				await deleteFile(`${filePath}.gz`);
				activeDownloads.delete(gid);
				await client.chat.update({
					channel: ctx.channelId,
					ts: ctx.messageTs,
					text: `Download \`${gid}\` failed: ${status.errorMessage || "Unknown error"}`,
					blocks: buildDownloadErrorBlocks(
						gid,
						status.errorCode,
						status.errorMessage,
					),
				});
			}
		} catch (handlerErr) {
			console.error(`[onEvent Error] ${event} ${gid}:`, handlerErr);
		}
	});
}

function resolveDownloadPath(status, ctx) {
	const files = status.files || [];
	return files[0]?.path
		? path.resolve(files[0].path)
		: path.join(DEFAULT_DOWNLOAD_DIR, ctx.filename || "");
}

async function uploadToDestination(client, ctx, filePath, filename, size) {
	const comment = `Downloaded: ${filename} (${formatBytes(size)})`;
	if (ctx.destination === "channel") {
		await client.files.uploadV2({
			channel_id: ctx.channelId,
			file: filePath,
			filename,
			initial_comment: comment,
		});
	} else if (ctx.destination === "dm") {
		const im = await client.conversations.open({ users: ctx.userId });
		await client.files.uploadV2({
			channel_id: im.channel.id,
			file: filePath,
			filename,
			initial_comment: comment,
		});
	}
}

export async function handleDownload({ command, ack, respond, client }) {
	await ack();

	const text = (command.text || "").trim();
	if (!text) {
		await respond({
			text: "Usage: `/download <url> [options]`",
			blocks: buildErrorBlock(
				"Usage: `/download <url>` — Please provide a URL to download.",
			),
		});
		return;
	}

	const url = text.split(/\s+/)[0];
	const options = {};
	const dirFlag = text.match(/--dir\s+(\S+)/);
	if (dirFlag) options.dir = dirFlag[1];
	const outFlag = text.match(/--out\s+(\S+)/);
	if (outFlag) options.out = outFlag[1];

	const interactionId = generateId();

	const msg = await client.chat.postMessage({
		channel: command.channel_id,
		text: `Ready to download \`${url}\`. Where should the file go?`,
		blocks: buildPreDownloadDestinationBlocks(interactionId, url),
	});

	pendingDownloads.set(interactionId, {
		url,
		options,
		userId: command.user_id,
		channelId: command.channel_id,
		messageTs: msg.ts,
	});
}

export async function startDownloadFromSelection({
	interactionId,
	destination,
	client,
	body,
}) {
	const pending = pendingDownloads.get(interactionId);
	if (!pending) {
		await client.chat.postMessage({
			channel: body.channel.id,
			text: "This download request has expired or already started.",
		});
		return;
	}
	pendingDownloads.delete(interactionId);

	const { url, options, userId, channelId, messageTs } = pending;

	await client.chat.update({
		channel: channelId,
		ts: messageTs,
		text: `Downloading \`${url}\`...`,
		blocks: [
			header(":arrow_down: Downloading..."),
			section(`\`${url}\``),
			divider(),
			section(
				":hourglass_flowing_sand: Risuko engine is downloading the file. I\'ll upload it automatically when it\'s ready.",
			),
		],
	});

	let gid;
	try {
		gid = await addUri([url], {
			dir: options.dir || DEFAULT_DOWNLOAD_DIR,
			out: options.out,
		});
	} catch (err) {
		await client.chat.update({
			channel: channelId,
			ts: messageTs,
			text: `Failed to start download: ${err.message}`,
			blocks: buildErrorBlock(`Failed to start download: ${err.message}`),
		});
		return;
	}

	activeDownloads.set(gid, {
		userId,
		channelId,
		messageTs,
		destination,
		filename: options.out,
	});
}

export { activeDownloads, pendingDownloads };
