import Redis, { Cluster } from "ioredis";
import { CONFIGS } from "../config/index.ts";
import { IRealm } from "../models/realm.ts";
import { MessageHandler } from "../messageHandler/index.ts";
import { IMessage } from "../models/message.ts";
import { MessageType } from "../enums.ts";

const createRedis = (): Redis.Redis | Cluster => {
    if (CONFIGS.redis.useCluster === 'true') {
        const clusterNodes = JSON.parse(CONFIGS.redis.clusterNodes);
        let redisOptions: any = {};
        if (CONFIGS.redis.password != "") {
            redisOptions = {
                ...redisOptions,
                password: CONFIGS.redis.password
            }
        }
        if (CONFIGS.redis.tls === 'true') {
            redisOptions = {
                ...redisOptions,
                tls: {}
            }
        }
        return new Redis.Cluster(clusterNodes, {
            redisOptions
        });
    } else {
        let config: any = {
            host: CONFIGS.redis.host,
            port: Number(CONFIGS.redis.port)
        }
        if (CONFIGS.redis.tls === 'true') {
            config = {
                ...config,
                tls: {}
            }
        }
        if (CONFIGS.redis.password != "") {
            config = {
                ...config,
                password: CONFIGS.redis.password
            }
        }
        return new Redis.Redis(config);
    }
}

const REDIS = {
    IP_KEY: 'IP::KEY',
    USER_CACHE_KEY: 'USER::MAP::CACHE',
    NODE_EVENT_LIST: 'NODE::EVENT::LIST',
    NODE_UPLOAD_SET: 'NODE::UPLOAD::SET',
    NODE_UPLOAD_LIST: 'NODE::UPLOAD::LIST',
    NODE_KEY: 'NODE::KEY',
    REGION_HOUR_MAP: 'REGION::HOUR::MAP',
    UPTIME_HOUR_SET: 'UPTIME::HOUR::SET',
    UPTIME_HOUR_MAP: 'UPTIME::HOUR::MAP',
    WS_DELAY_MAP: 'WS::DELAY::MAP',
    EMAIL_QUEUE: 'EMAIL::QUEUE',
    USER_INVITE_CODE: 'USER::INVITE_CODE',
    USER_ACCESS_TOKEN: 'USER::ACCESSTOKEN',
    USER_AUTH_TOKEN: 'USER::AUTH_TOKEN',
    AUTH_TOKEN_USER: 'AUTH_TOKEN::USER',
    TRENDING_REWARDS_MAP: 'TRENDING::REWARDS::MAP',
    USER_NODE_LIST_QUERY: 'USER::NODE::LIST::QUERY',
    USER_INFO: 'USER::INFO',
    USER_ACTIVE_CODE: 'USER::ACTIVE::CODE',
    USER_RESET_CODE: 'USER::RESET::CODE',
    NODE_TAP_CACHE: 'NODE::TAP::CACHE',
    NODE_PEER_ID: 'NODE::PEER::ID',
    TAP_NODE_LIST_CACHE: 'TAP::NODE::LIST::CACHE',
    NODE_TAP_SORTED_SET: 'NODE::TAP::SORTED::SET',
    TAP_PEERS_SET: 'TAP::PEERS::SET',
    TAP_QUERY_FROM: 'TAP::QUERY::FROM',
    TAP_CHANNEL_MSG: 'TAP::CHANNEL::MSG',
}

const parseId = (id: string | null): number | null => {
    if (id !== null) {
        return parseInt(id);
    }
    return null;
}

const getUserIdByUUID = async (uuid: string): Promise<number | null> => {
    return parseId(await redis.get(`${REDIS.USER_CACHE_KEY}::${uuid}`));
}

const getCacheUserNodeId = async (clientInfo: { clientId: any, ip: any, userId: any }) => {
    return parseId(await redis.get(`${REDIS.NODE_KEY}::${clientInfo.userId}_${clientInfo.clientId}_${clientInfo.ip}`));
}

const getTapNodeList = async (uuid: string) => {
    return redis.get(`${REDIS.TAP_NODE_LIST_CACHE}::${uuid}`);
}

const addTapPeersSet = async (uuid: string, nodeId: number, peerId: string) => {
    return redis.hset(`${REDIS.TAP_PEERS_SET}::${uuid}`, nodeId, peerId);
}

const setNodePeerId = async (nodeId: number, peerId: string) => {
    return redis.set(`${REDIS.NODE_PEER_ID}::${nodeId}`, peerId);
}

const deleteNodePeerId = async (nodeId: number) => {
    return redis.del(`${REDIS.NODE_PEER_ID}::${nodeId}`);
}

const getNodeTapCache = async (nodeId: number) => {
    return redis.get(`${REDIS.NODE_TAP_CACHE}::${nodeId}`);
}

const publishMessage = async (message: string, channel: string = REDIS.TAP_CHANNEL_MSG) => {
    return redis.publish(channel, message);
}

const subscribeMessage = async (realm: IRealm, handler: MessageHandler, channel: string = REDIS.TAP_CHANNEL_MSG) => {
    const subRedis = redis.duplicate();
    await subRedis.subscribe(channel);
    subRedis.on("message", (_channel, data) => {
        // eslint-disable-next-line @typescript-eslint/no-base-to-string
        console.log(`Received data: ${data.toString()}`);
        const message = JSON.parse(data.toString()) as Writable<IMessage>;
        if (message.dst) {
            const client = realm.getClientById(message.dst);
            if (client) {
                console.log(`dst: ${message.dst} client: ${client.getId()}`);
                handler.handle(client, message);
            }
        } else {
            if (message.src && message.type === MessageType.LEAVE) {
                const client = realm.getClientById(message.src);
                if (client) {
                    handler.handle(client, message);
                }
            }
        }
    });
}

type Writable<T> = {
    -readonly [K in keyof T]: T[K];
};

export const redis = createRedis();

export const cache = {
    setNodePeerId,
    deleteNodePeerId,
    getUserIdByUUID,
    getCacheUserNodeId,
    getNodeTapCache,
    getTapNodeList,
    addTapPeersSet,
    publishMessage,
    subscribeMessage
}