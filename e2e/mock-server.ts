/**
 * Stands in for both Together.AI and the Slack webhook during e2e runs, so tests are
 * deterministic and never reach a real service. Run with `node e2e/mock-server.ts`.
 *
 * Tests script the model one round at a time (`POST /__script`) and read back what the
 * app sent (`GET /__requests`, `GET /__slack`).
 */
import { createServer, type IncomingMessage } from "node:http";

export type ScriptedToolCall = { name: string; args: unknown };

/** One model round: optional text, then optional tool calls. */
export type ScriptStep = { text?: string; tools?: ScriptedToolCall[] };

const PORT = Number(process.env.MOCK_PORT ?? 4010);

const state = {
	script: [] as ScriptStep[],
	requests: [] as unknown[],
	slack: [] as unknown[],
};

const readJson = async (req: IncomingMessage): Promise<unknown> => {
	const chunks: Buffer[] = [];

	for await (const chunk of req) {
		chunks.push(chunk as Buffer);
	}

	const body = Buffer.concat(chunks).toString();

	return body ? JSON.parse(body) : undefined;
};

const frame = (data: unknown): string => `data: ${JSON.stringify(data)}\n\n`;

const streamStep = (step: ScriptStep): string => {
	const words = (step.text ?? "").split(/(?<= )/).filter(Boolean);
	const text = words.map((content) => frame({ choices: [{ delta: { content } }] }));
	const tools = (step.tools ?? []).map((tool, index) =>
		frame({
			choices: [
				{
					delta: {
						tool_calls: [
							{
								index,
								id: `call_${state.requests.length}_${index}`,
								function: {
									name: tool.name,
									arguments: JSON.stringify(tool.args),
								},
							},
						],
					},
				},
			],
		}),
	);

	return `${[...text, ...tools].join("")}data: [DONE]\n\n`;
};

createServer(async (req, res) => {
	const { method, url } = req;

	if (method === "POST" && url === "/v1/chat/completions") {
		state.requests.push(await readJson(req));

		const step = state.script.shift() ?? { text: "(no scripted reply)" };

		res.writeHead(200, { "Content-Type": "text/event-stream" });
		res.end(streamStep(step));

		return;
	}

	if (method === "POST" && url === "/slack") {
		state.slack.push(await readJson(req));
		res.writeHead(200).end("ok");

		return;
	}

	if (method === "POST" && url === "/__script") {
		state.script = (await readJson(req)) as ScriptStep[];
		res.writeHead(204).end();

		return;
	}

	if (method === "POST" && url === "/__reset") {
		state.script = [];
		state.requests = [];
		state.slack = [];
		res.writeHead(204).end();

		return;
	}

	if (method === "GET" && (url === "/__requests" || url === "/__slack")) {
		res.writeHead(200, { "Content-Type": "application/json" });
		res.end(JSON.stringify(url === "/__slack" ? state.slack : state.requests));

		return;
	}

	res.writeHead(404).end();
}).listen(PORT, "127.0.0.1", () => {
	console.log(`[mock] listening on http://127.0.0.1:${PORT}`);
});
