import type { WebSocketServer, ServerOptions } from "ws";
import type { CorsOptions } from "cors";
import * as dotenv from 'dotenv';
dotenv.config();
export interface IConfig {
	readonly host: string;
	readonly port: number;
	readonly expire_timeout: number;
	readonly alive_timeout: number;
	readonly key: string;
	readonly path: string;
	readonly concurrent_limit: number;
	readonly allow_discovery: boolean;
	readonly proxied: boolean | string;
	readonly cleanup_out_msgs: number;
	readonly ssl?: {
		key: string;
		cert: string;
	};
	readonly generateClientId?: () => string;
	readonly createWebSocketServer?: (options: ServerOptions) => WebSocketServer;
	readonly corsOptions: CorsOptions;
}

const defaultConfig: IConfig = {
	host: "::",
	port: 9000,
	expire_timeout: 5000,
	alive_timeout: 90000,
	key: "peerjs",
	path: "/",
	concurrent_limit: 5000,
	allow_discovery: false,
	proxied: false,
	cleanup_out_msgs: 1000,
	corsOptions: { origin: true },
};

const getEnvOrExit = (key: string, defaultValue: string = "", exit: boolean = true): string => {
	const value = process.env[key];
	const result = value || defaultValue;
	if ((!result || result === "") && exit) {
		console.error(`Required env var '${key}' missing`);
		process.exit(1);
	}
	return result;
}

export const CONFIGS = {
	common: {
		concurrent_test: getEnvOrExit("CONCURRENT_TEST", "true"),
	},
	redis: {
		useCluster: getEnvOrExit('REDIS_CLUSTER', 'false'),
		clusterNodes: getEnvOrExit('REDIS_CLUSTER_NODES', '[{"host":"127.0.0.1","port":6379}]'),
		host: getEnvOrExit('REDIS_HOST', 'localhost'),
		port: Number(getEnvOrExit('REDIS_PORT', '6379')),
		password: getEnvOrExit("REDIS_PASSWORD", "", false),
		user: getEnvOrExit("REDIS_USER", "", false),
		tls: getEnvOrExit("REDIS_TLS", "false", false),
	}
}

export default defaultConfig;
