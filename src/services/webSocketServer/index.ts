import { EventEmitter } from "node:events";
import type { IncomingMessage } from "node:http";
import type WebSocket from "ws";
import { Errors, MessageType } from "../../enums.ts";
import type { IClient } from "../../models/client.ts";
import { Client } from "../../models/client.ts";
import { CONFIGS, type IConfig } from "../../config/index.ts";
import type { IRealm } from "../../models/realm.ts";
import { WebSocketServer as Server } from "ws";
import type { Server as HttpServer } from "node:http";
import type { Server as HttpsServer } from "node:https";
import { IMessage } from "../../models/message.js";
import { cache } from "../../db/redis.ts";

export interface IWebSocketServer extends EventEmitter {
	readonly path: string;
}

type CustomConfig = Pick<
	IConfig,
	"path" | "key" | "concurrent_limit" | "createWebSocketServer"
>;

const WS_PATH = "peerjs";

// 定义获取客户端 IP 的函数
export function getIp(req: any): string {
	const headers = req.headers as any;

	if (headers['cf-connecting-ip']) {
		return headers['cf-connecting-ip'] as string;
	}

	if (headers['x-forwarded-for']) {
		return (headers['x-forwarded-for'] as string).split(',')[0]?.trim() ?? "";
	}

	if (headers['x-real-ip']) {
		return (headers['x-real-ip'] as string).split(':')[0]?.trim() ?? "";
	}

	const connection = req.connection || req.socket || req.info;
	return (connection?.remoteAddress || '').replace('::ffff:', '');
}

const IPv4Regex = /^(?!10(?:\.\d{1,3}){3})(?!192\.168(?:\.\d{1,3}){2})(?!172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2})(?!127(?:\.\d{1,3}){3})(?!0(?:\.\d{1,3}){3})(?!255\.255\.255\.255)(?:[1-9]\d?|1\d{2}|2[0-4]\d|25[0-5])(?:\.(?:\d{1,2}|1\d{2}|2[0-4]\d|25[0-5])){3}$/;
// 正则匹配全球单播地址（2000::/3）
const IPv6Regex = /^(?:2[0-9A-Fa-f]|3[0-9A-Fa-f])[0-9A-Fa-f]{0,3}(:[0-9A-Fa-f]{1,4}){0,7}(:|::)?([0-9A-Fa-f]{1,4}(:[0-9A-Fa-f]{1,4}){0,6})?$/;

export function isPublicIP(ip: string) {
	return isPublicIPv4(ip) || isPublicIPv6(ip) || CONFIGS.common.concurrent_test === 'true';
}

function isPublicIPv4(ip: string) {
	return IPv4Regex.test(ip);
}

function isPublicIPv6(ip: string) {
	// 检查是否为全球单播范围
	if (!IPv6Regex.test(ip)) return false;
	// 检查非公网范围（私有、链路本地、多播等）
	if (
		ip.startsWith("fc") || // ULA 私有地址
		ip.startsWith("fd") || // ULA 私有地址
		ip.startsWith("fe8") || // 链路本地地址
		ip.startsWith("ff") || // 多播地址
		ip === "::1" // 回环地址
	) {
		return false;
	}
	return true;
}

export class WebSocketServer extends EventEmitter implements IWebSocketServer {
	public readonly path: string;
	private readonly realm: IRealm;
	private readonly config: CustomConfig;
	public readonly socketServer: Server;

	constructor({
		server,
		realm,
		config,
	}: {
		server: HttpServer | HttpsServer;
		realm: IRealm;
		config: CustomConfig;
	}) {
		super();

		this.setMaxListeners(0);

		this.realm = realm;
		this.config = config;

		const path = this.config.path;
		this.path = `${path}${path.endsWith("/") ? "" : "/"}${WS_PATH}`;

		const options: WebSocket.ServerOptions = {
			path: this.path,
			server,
		};

		this.socketServer = config.createWebSocketServer
			? config.createWebSocketServer(options)
			: new Server(options);

		this.socketServer.on("connection", (socket, req) => {
			this._onSocketConnection(socket, req);
		});
		this.socketServer.on("error", (error: Error) => {
			this._onSocketError(error);
		});
	}

	private async _onSocketConnection(socket: WebSocket, req: IncomingMessage): Promise<void> {
		// An unhandled socket error might crash the server. Handle it first.
		socket.on("error", (error) => {
			this._onSocketError(error);
		});

		const ip = getIp(req);
		if (!isPublicIP(ip)) {
			this._sendErrorAndClose(socket, Errors.INVALID_IP_ADDRESS);
			return;
		}

		// We are only interested in the query, the base url is therefore not relevant
		if (req.url) {
			console.log(req.url ?? "", "https://peerjs");
		}
		const { searchParams } = new URL(req.url ?? "", "https://peerjs");

		const { id, token, key } = Object.fromEntries(searchParams.entries());

		if (!id || !token || !key) {
			this._sendErrorAndClose(socket, Errors.INVALID_WS_PARAMETERS);
			return;
		}

		if (key !== this.config.key) {
			this._sendErrorAndClose(socket, Errors.INVALID_KEY);
			return;
		}

		let tapUUID = null;
		let nodeId = null;
		let startNode = false;
		try {
			// 用户uuid, 节点id, 调用tap开始返回的uuid
			const { userId: userUUID, nodeId: clientId, uuid } = JSON.parse(Buffer.from(token, "base64").toString("utf-8"));

			if (!userUUID || !clientId || !uuid) {
				this._sendErrorAndClose(socket, Errors.INVALID_TOKEN);
				return;
			}

			const userId = await cache.getUserIdByUUID(userUUID);
			if (!userId) {
				console.log(`userId not found: ${userUUID}`);
				this._sendErrorAndClose(socket, Errors.INVALID_TOKEN);
				return;
			}

			nodeId = await cache.getCacheUserNodeId({ clientId, ip, userId });
			if (!nodeId) {
				console.log(`nodeId not found: ${clientId}`);
				this._sendErrorAndClose(socket, Errors.INVALID_TOKEN);
				return;
			}

			const nodeListStr = await cache.getTapNodeList(uuid);
			if (!nodeListStr) {
				console.log(`nodeList not found: ${uuid}`);
				this._sendErrorAndClose(socket, Errors.INVALID_TOKEN);
				return;
			}

			const nodeList = nodeListStr.split(",");
			if (!nodeList.includes(`${nodeId}`)) {
				// 检查是否是发起者
				const nodeCache = await cache.getNodeTapCache(nodeId);
				console.log(`nodeCache: ${nodeCache} uuid: ${uuid}`);
				if (nodeCache != null && (`${nodeCache}`.toUpperCase() == `${uuid}`.toUpperCase())) {
					console.log(`nodeId: ${nodeId} is start node`);
					startNode = true;
				} else {
					console.log(`nodeId not in nodeList and not start node: ${nodeId}`);
					this._sendErrorAndClose(socket, Errors.INVALID_TOKEN);
					return;
				}
			}

			tapUUID = uuid;
		} catch (error) {
			this._sendErrorAndClose(socket, Errors.INVALID_TOKEN);
			return;
		}

		const client = this.realm.getClientById(id);

		if (client) {
			if (token !== client.getToken()) {
				// ID-taken, invalid token
				socket.send(
					JSON.stringify({
						type: MessageType.ID_TAKEN,
						payload: { msg: "ID is taken" },
					}),
				);

				socket.close();
				return;
			}
			if (!startNode) {
				await cache.addTapPeersSet(tapUUID, nodeId, id);
			}
			this._configureWS(socket, client);
			return;
		}

		await this._registerClient({ socket, id, token, nodeId, tapUUID, startNode });
	}

	private _onSocketError(error: Error): void {
		// handle error
		this.emit("error", error);
	}

	private async _registerClient({
		socket,
		id,
		token,
		nodeId,
		tapUUID,
		startNode
	}: {
		socket: WebSocket;
		id: string;
		token: string;
		nodeId: number;
		tapUUID: string;
		startNode: boolean
	}): Promise<void> {
		// Check concurrent limit
		const clientsCount = this.realm.getClientsIds().length;

		if (clientsCount >= this.config.concurrent_limit) {
			this._sendErrorAndClose(socket, Errors.CONNECTION_LIMIT_EXCEED);
			return;
		}

		const newClient: IClient = new Client({ id, token });
		this.realm.setClient(newClient, id);
		socket.send(JSON.stringify({ type: MessageType.OPEN }));
		if (!startNode) {
			await cache.addTapPeersSet(tapUUID, nodeId, id);
		}
		this._configureWS(socket, newClient);
	}

	private _configureWS(socket: WebSocket, client: IClient): void {
		client.setSocket(socket);

		// Cleanup after a socket closes.
		socket.on("close", () => {
			if (client.getSocket() === socket) {
				this.realm.removeClientById(client.getId());
				this.emit("close", client);
			}
		});

		// Handle messages from peers.
		socket.on("message", (data) => {
			try {
				// eslint-disable-next-line @typescript-eslint/no-base-to-string
				const message = JSON.parse(data.toString()) as Writable<IMessage>;
				message.src = client.getId();
				this.emit("message", client, message);
			} catch (e) {
				this.emit("error", e);
			}
		});

		this.emit("connection", client);
	}

	private _sendErrorAndClose(socket: WebSocket, msg: Errors): void {
		socket.send(
			JSON.stringify({
				type: MessageType.ERROR,
				payload: { msg },
			}),
		);

		socket.close();
	}
}

type Writable<T> = {
	-readonly [K in keyof T]: T[K];
};
