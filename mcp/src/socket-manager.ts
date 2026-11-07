import type { FromPluginMessage } from "@shared/types";
import type { Server } from "socket.io";

type SocketMessage = "start-task";

// Socket manager is the abstraction layer on the top of the socket.io library.
// It receives task answers from the Figma plugins and raises events for the orchestrator to handle.
// It also sends messages to a specific Figma plugin.
export class SocketManager {
    constructor(server: Server) {
        this.server = server;

        this.server.on('connection', (socket) => {
            socket.on('task-finished', (data: FromPluginMessage) => {
                try {
                    this._onTaskFinishedCallback?.(socket.id, data);
                } catch (error) {
                    console.error('Error in task-finished handler:', error);
                }
            });

            socket.on('task-failed', (data: FromPluginMessage) => {
                try {
                    this._onTaskErrorCallback?.(socket.id, data);
                } catch (error) {
                    console.error('Error in task-failed handler:', error);
                }
            });

            socket.on('disconnect', () => {
                try {
                    this._onDisconnectCallback?.(socket.id);
                } catch (error) {
                    console.error('Error in disconnect handler:', error);
                }
            });
        });
    }

    // Sends a message to a single plugin. Returns false when the socket is gone.
    public sendTo(socketId: string, message: SocketMessage, data: any): boolean {
        const socket = this.server.sockets.sockets.get(socketId);
        if (!socket) return false;
        socket.emit(message, data);
        return true;
    }

    private server: Server;

    // Events

    private _onTaskFinishedCallback?: (socketId: string, task: FromPluginMessage) => void;
    public onTaskFinished(callback: (socketId: string, task: FromPluginMessage) => void) {
        this._onTaskFinishedCallback = callback;
    }

    private _onTaskErrorCallback?: (socketId: string, task: FromPluginMessage) => void;
    public onTaskError(callback: (socketId: string, task: FromPluginMessage) => void) {
        this._onTaskErrorCallback = callback;
    }

    private _onDisconnectCallback?: (socketId: string) => void;
    public onDisconnect(callback: (socketId: string) => void) {
        this._onDisconnectCallback = callback;
    }
}
