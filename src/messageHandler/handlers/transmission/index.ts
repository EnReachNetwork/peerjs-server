import { MessageType } from "../../../enums.ts";
import type { IClient } from "../../../models/client.ts";
import type { IMessage } from "../../../models/message.ts";
import type { IRealm } from "../../../models/realm.ts";

export const TransmissionHandler = ({
	realm,
}: {
	realm: IRealm;
}): ((client: IClient | undefined, message: IMessage) => boolean) => {
	const handle = (client: IClient | undefined, message: IMessage) => {
		const type = message.type;
		const srcId = message.src;
		const dstId = message.dst;

		const destinationClient = realm.getClientById(dstId);

		// User is connected!
		if (destinationClient) {
			const socket = destinationClient.getSocket();
			try {
				if (socket) {
					const data = JSON.stringify(message);

					socket.send(data);
				} else {
					// Neither socket no res available. Peer dead?
					throw new Error("Peer dead");
				}
			} catch (e) {
				// This happens when a peer disconnects without closing connections and
				// the associated WebSocket has not closed.
				// Tell other side to stop trying.
				if (socket) {
					socket.close();
				} else {
					realm.removeClientById(destinationClient.getId());
				}

				handle(client, {
					type: MessageType.LEAVE,
					src: dstId,
					dst: srcId,
				});
			}
		} else {
			if (type === MessageType.LEAVE && !dstId) {
				realm.removeClientById(srcId);
			} else {
				// Unavailable destination specified with message LEAVE or EXPIRE
				// Ignore
			}
		}

		return true;
	};

	return handle;
};
