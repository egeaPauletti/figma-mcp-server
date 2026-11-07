import type { ConnectionRegistry, PluginConnection } from "./pairing/connection-registry.js";
import type { TaskManager, TaskQueue, TaskResult } from "./task-manager.js";

// State of one MCP session: who is calling and which Figma plugin it talks to.
export interface SessionContext {
    userId?: string;
    email?: string;
    pairingId?: string;
}

export const NOT_CONNECTED_MESSAGE =
    "No Figma file is connected to this session. Ask the user to open the 'Figma MCP Server' plugin in Figma " +
    "and tell you the pairing code it shows, then call the connect-figma tool with that code.";

// TaskManager implementation bound to a session. Tools call runTask() exactly like before,
// but the command is only delivered to the plugin paired with this session.
export class SessionTaskRunner implements TaskManager {
    constructor(
        private readonly queue: TaskQueue,
        private readonly registry: ConnectionRegistry,
        public readonly context: SessionContext
    ) { }

    public resolveTarget(): PluginConnection | undefined {
        if (this.registry.isLocal) return this.registry.getLocal();
        const userId = this.context.userId;
        if (!userId) return undefined;

        if (this.context.pairingId) {
            return this.registry.getForUser(userId, this.context.pairingId);
        }
        // Convenience: if the user has exactly one paired plugin online, use it.
        const online = this.registry.listForUser(userId);
        if (online.length === 1) {
            this.context.pairingId = online[0]!.pairingId!;
            return online[0];
        }
        return undefined;
    }

    public runTask<TResult, TArgs>(command: string, args: TArgs): Promise<TResult> {
        const target = this.resolveTarget();
        if (!target) {
            const result: TaskResult = { isError: true, content: { error: this.notConnectedMessage() } };
            return Promise.resolve(result as TResult);
        }
        return this.queue.runTaskOn(target.socketId, command, args) as Promise<TResult>;
    }

    private notConnectedMessage(): string {
        if (this.registry.isLocal) return "The Figma plugin is not connected. Open the 'Figma MCP Server' plugin in Figma.";
        if (this.context.pairingId) {
            return "The Figma file connected to this session is offline (plugin closed). " +
                "Reopen the plugin, or call list-figma-connections / connect-figma to choose another file.";
        }
        const online = this.context.userId ? this.registry.listForUser(this.context.userId) : [];
        if (online.length > 1) {
            return "More than one Figma file is connected. Call list-figma-connections and then connect-figma with the connectionId to choose one.";
        }
        return NOT_CONNECTED_MESSAGE;
    }
}
