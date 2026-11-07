import { generateUUID } from "./utils.js";

type TaskStatus = "pending" | "completed" | "failed" | "timed_out";

export interface TaskResult {
    isError: boolean;
    content?: any;
}

// What the tools see: run a command in "the" Figma plugin of the current session.
// Each MCP session gets its own implementation (see session.ts) that knows which plugin to target.
export interface TaskManager {
    runTask<TResult, TArgs>(command: string, args: TArgs): Promise<TResult>;
}

export interface Task {
    id: string;
    socketId: string;
    command: string;
    args: any;
    status: TaskStatus;
    createdAt: Date;
    resolve: (result: TaskResult) => void;
    timer: ReturnType<typeof setTimeout>;
}

// Message sent to the plugin. Only plain data, never the resolve/timer handles.
export interface StartTaskMessage {
    id: string;
    command: string;
    args: any;
}

// Task queue shared by the whole process.
// A task is addressed to a single plugin socket and can only be completed by that socket.
export class TaskQueue {
    private tasks = new Map<string, Task>();
    private _onTaskAddedCallback?: (task: Task) => void;

    constructor(private readonly timeoutMs: number) { }

    public runTaskOn(socketId: string, command: string, args: unknown): Promise<TaskResult> {
        return new Promise<TaskResult>((resolve) => {
            const id = generateUUID();
            const timer = setTimeout(() => {
                this.finish(id, "timed_out", { error: `Task timed out after ${this.timeoutMs}ms` });
            }, this.timeoutMs);

            const task: Task = {
                id,
                socketId,
                command,
                args,
                status: "pending",
                createdAt: new Date(),
                resolve,
                timer,
            };
            this.tasks.set(id, task);

            try {
                this._onTaskAddedCallback?.(task);
            } catch (error) {
                this.finish(id, "failed", { error: error instanceof Error ? error.message : String(error) });
            }
        });
    }

    // Register a callback for when a task is added
    public onTaskAdded(callback: (task: Task) => void) {
        this._onTaskAddedCallback = callback;
    }

    // Called when a plugin answers. Answers from a socket that did not receive the task are ignored.
    public completeFromSocket(socketId: string, taskId: string, content: any, isError: boolean) {
        const task = this.tasks.get(taskId);
        if (!task) {
            console.error("Answer for unknown or already finished task", taskId);
            return;
        }
        if (task.socketId !== socketId) {
            console.error("Ignoring answer for task", taskId, "from socket", socketId, "(task belongs to", task.socketId, ")");
            return;
        }
        this.finish(taskId, isError ? "failed" : "completed", content);
    }

    // Plugin went away: fail its pending tasks right away instead of waiting for the timeout.
    public failTasksForSocket(socketId: string, reason: string) {
        for (const task of this.tasks.values()) {
            if (task.socketId === socketId) {
                this.finish(task.id, "failed", { error: reason });
            }
        }
    }

    private finish(id: string, status: Exclude<TaskStatus, "pending">, content: any) {
        const task = this.tasks.get(id);
        if (!task) return;
        this.tasks.delete(id);
        clearTimeout(task.timer);
        task.status = status;
        task.resolve({ isError: status !== "completed", content });
    }
}
