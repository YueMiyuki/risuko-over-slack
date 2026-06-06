import "dotenv/config";
import { App } from "@slack/bolt";
import { initEngine, shutdownEngine } from "./risuko.js";
import { handlePing } from "./commands/ping.js";
import { handleHealth } from "./commands/health.js";
import { handleHelp } from "./commands/help.js";
import {
	handleDownload,
	registerDownloadCallbacks,
	startDownloadFromSelection,
	pendingDownloads,
} from "./commands/download.js";
import {
	buildErrorBlock,
	buildPreDownloadDestinationBlocks,
	buildHealthBlocks,
	buildPingBlocks,
	buildHelpBlocks,
} from "./utils/slack.js";

function requireEnv(name) {
	const value = process.env[name];
	if (!value) {
		console.error(`Missing required environment variable: ${name}`);
		process.exit(1);
	}
	return value;
}

const SLACK_BOT_TOKEN = requireEnv("SLACK_BOT_TOKEN");
const SLACK_APP_TOKEN = requireEnv("SLACK_APP_TOKEN");
const SLACK_SIGNING_SECRET = requireEnv("SLACK_SIGNING_SECRET");

const app = new App({
	token: SLACK_BOT_TOKEN,
	appToken: SLACK_APP_TOKEN,
	signingSecret: SLACK_SIGNING_SECRET,
	socketMode: true,
});

app.command("/risuko-ping", handlePing);
app.command("/risuko-health", handleHealth);
app.command("/risuko-download", handleDownload);
app.command("/risuko-help", handleHelp);


app.action("download_dest_channel", async ({ ack, body, client }) => {
	await ack();
	const { interactionId } = JSON.parse(body.actions[0].value);
	await startDownloadFromSelection({
		interactionId,
		destination: "channel",
		client,
		body,
	});
});

app.action("download_dest_dm", async ({ ack, body, client }) => {
	await ack();
	const { interactionId } = JSON.parse(body.actions[0].value);
	await startDownloadFromSelection({
		interactionId,
		destination: "dm",
		client,
		body,
	});
});

async function main() {
	console.log("Starting Risuko engine...");
	try {
		await initEngine();
		console.log("Risuko engine started.");
	} catch (err) {
		console.error("Failed to start Risuko engine:", err);
		process.exit(1);
	}

	registerDownloadCallbacks(app.client);

	await app.start();
	console.log("Slack bot is running in Socket Mode.");
}

async function shutdown() {
	console.log("\nShutting down...");
	try {
		await shutdownEngine();
		console.log("Risuko engine stopped.");
	} catch {}
	await app.stop();
	process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

main().catch((err) => {
	console.error("Unhandled error:", err);
	process.exit(1);
});
