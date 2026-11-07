import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Server } from "socket.io";
import { config } from "./config.js";
import { TaskQueue } from "./task-manager.js";
import { SocketManager } from "./socket-manager.js";
import { Orchestrator } from "./orchestrator.js";
import { ConnectionRegistry, type RegistryMode } from "./pairing/connection-registry.js";
import { SessionTaskRunner, type SessionContext } from "./session.js";
import { registerConnectionTools } from "./tools/session/connection-tools.js";
import { getSelection } from "./tools/read/get-selection.js";
import { getNodeInfo } from "./tools/read/get-node-info.js";
import { createRectangle } from "./tools/create/create-rectangle.js";
import { moveNode } from "./tools/update/move-node.js";
import { resizeNode } from "./tools/update/resize-node.js";
import { deleteNode } from "./tools/delete/delete-node.js";
import { cloneNode } from "./tools/create/clone-node.js";
import { createFrame } from "./tools/create/create-frame.js";
import { createText } from "./tools/create/create-text.js";
import { setFillColor } from "./tools/update/set-fill-color.js";
import { setStrokeColor } from "./tools/update/set-stroke-color.js";
import { setCornerRadius } from "./tools/update/set-corner-radius.js";
import { setLayout } from "./tools/update/set-layout.js";
import { getAllComponents } from "./tools/read/get-all-components.js";
import { createInstance } from "./tools/create/create-instance.js";
import { addComponentProperty } from "./tools/create/add-component-property.js";
import { editComponentProperty } from "./tools/update/edit-component-property.js";
import { deleteComponentProperty } from "./tools/delete/delete-component-property.js";
import { setInstanceProperties } from "./tools/update/set-instance-properties.js";
import { createComponent } from "./tools/create/create-component.js";
import { setParentId } from "./tools/update/set-parent-id.js";
import { setNodeComponentPropertyReferences } from "./tools/update/set-node-component-property-references.js";
import { getPages } from "./tools/read/get-pages.js";
import { createImage } from "./tools/create/create-image.js";
import { addPrototypeLink } from "./tools/create/add-prototype-link.js";

// Shared state (socket.io listeners, task queue, plugin connections). Create ONCE per process.
export interface FigmaBridge {
    queue: TaskQueue;
    registry: ConnectionRegistry;
}

export function createFigmaBridge(io: Server, mode: RegistryMode): FigmaBridge {
    const queue = new TaskQueue(config.TASK_TIMEOUT_MS);
    const socketManager = new SocketManager(io);
    new Orchestrator(socketManager, queue);
    const registry = new ConnectionRegistry(io, mode);
    return { queue, registry };
}

// An McpServer can only be connected to one transport, so create one per session.
// `context` identifies the user of the session and the Figma file it is paired with.
export function createMcpServer(bridge: FigmaBridge, context: SessionContext = {}): McpServer {
    const taskManager = new SessionTaskRunner(bridge.queue, bridge.registry, context);

    const mcpServer = new McpServer({
        name: `MCP Server for Figma`,
        description: "Model Context Protocol Server for Figma",
        version: "0.1.1",
    });
 
    // Register tools

    // Session tools (pairing with a Figma file)
    if (!bridge.registry.isLocal) {
        registerConnectionTools(mcpServer, taskManager, bridge.registry);
    }

    // Create tools
    createRectangle(mcpServer, taskManager);
    cloneNode(mcpServer, taskManager);
    createFrame(mcpServer, taskManager);
    createText(mcpServer, taskManager);
    createInstance(mcpServer, taskManager);
    addComponentProperty(mcpServer, taskManager);
    createComponent(mcpServer, taskManager);
    createImage(mcpServer, taskManager);
    addPrototypeLink(mcpServer, taskManager);
    // Read tools
    getSelection(mcpServer, taskManager);
    getNodeInfo(mcpServer, taskManager);
    getAllComponents(mcpServer, taskManager);
    getPages(mcpServer, taskManager);

    // Update tools
    moveNode(mcpServer, taskManager);
    resizeNode(mcpServer, taskManager);
    setFillColor(mcpServer, taskManager);
    setStrokeColor(mcpServer, taskManager);
    setCornerRadius(mcpServer, taskManager);
    setLayout(mcpServer, taskManager);
    editComponentProperty(mcpServer, taskManager);
    setInstanceProperties(mcpServer, taskManager);
    setParentId(mcpServer, taskManager);
    setNodeComponentPropertyReferences(mcpServer, taskManager);
    // Delete tools
    deleteNode(mcpServer, taskManager);
    deleteComponentProperty(mcpServer, taskManager);

    return mcpServer;
}
