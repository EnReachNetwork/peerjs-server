export enum Errors {
	INVALID_KEY = "Invalid key provided",
	INVALID_TOKEN = "Invalid token provided",
	INVALID_USERID = "Invalid user id",
	INVALID_NODE_ID = "Invalid node id",
	INVALID_TAP_UUID = "Invalid tap uuid",
	INVALID_WS_PARAMETERS = "No id, token, or key supplied to websocket server",
	INVALID_IP_ADDRESS = "Invalid IP address",
	CONNECTION_LIMIT_EXCEED = "Server has reached its concurrent user limit",
	SERVER_ERROR = "Server error",
}

export enum MessageType {
	OPEN = "OPEN",
	LEAVE = "LEAVE",
	CANDIDATE = "CANDIDATE",
	OFFER = "OFFER",
	ANSWER = "ANSWER",
	EXPIRE = "EXPIRE",
	HEARTBEAT = "HEARTBEAT",
	ID_TAKEN = "ID-TAKEN",
	ERROR = "ERROR",
}
