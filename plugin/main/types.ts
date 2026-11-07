import { EventHandler } from '@create-figma-plugin/utilities'
import { FromPluginMessage } from '@shared/types'


export interface StartTaskHandler extends EventHandler {
  name: 'START_TASK'
  taskId: string
  command: string
  args: any
}

export interface TaskFinishedHandler extends EventHandler, FromPluginMessage {
  name: 'TASK_FINISHED'
}

export interface TaskFailedHandler extends EventHandler, FromPluginMessage {
  name: 'TASK_FAILED'
}

// UI → main: ask for the file name and the pairing token saved for this server + file
export interface RequestPluginInfoHandler extends EventHandler {
  name: 'REQUEST_PLUGIN_INFO'
  handler: (serverUrl: string) => void
}

// main → UI
export interface PluginInfoHandler extends EventHandler {
  name: 'PLUGIN_INFO'
  handler: (info: { fileName: string; pluginToken: string | null }) => void
}

// UI → main: save (or clear with null) the pairing token for this server + file
export interface SavePluginTokenHandler extends EventHandler {
  name: 'SAVE_PLUGIN_TOKEN'
  handler: (serverUrl: string, token: string | null) => void
}

export type SceneNodeType =   | 'RECTANGLE'
  | 'RECTANGLE'
  | 'CIRCLE'
  | 'ELLIPSE'
  | 'VECTOR'
  | 'TEXT'
  | 'FRAME'
  | 'GROUP'
  | 'STAMP'
  | 'CONNECTOR'
  | 'STAR';