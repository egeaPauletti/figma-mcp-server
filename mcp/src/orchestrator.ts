import type { SocketManager } from "./socket-manager.js";
import type { StartTaskMessage, TaskQueue } from "./task-manager.js";

export class Orchestrator {

    constructor(socketManager: SocketManager, taskQueue: TaskQueue) {
        // Task added → send start-task only to the plugin the task is addressed to
        taskQueue.onTaskAdded((task) => {
            const message: StartTaskMessage = { id: task.id, command: task.command, args: task.args };
            if (!socketManager.sendTo(task.socketId, 'start-task', message)) {
                throw new Error("The Figma plugin is no longer connected");
            }
        });

        // Plugin answered → complete the task (only if it came from the same socket)
        socketManager.onTaskFinished((socketId, task) => {
            taskQueue.completeFromSocket(socketId, task.taskId, task.content, false);
        });

        socketManager.onTaskError((socketId, task) => {
            taskQueue.completeFromSocket(socketId, task.taskId, task.content, true);
        });

        // Plugin disconnected → fail its pending tasks immediately
        socketManager.onDisconnect((socketId) => {
            taskQueue.failTasksForSocket(socketId, "The Figma plugin disconnected before finishing the task");
        });
    }
}
