import { invoke, isTauri } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";

/** A message sent to the desktop AI provider command. */
export interface DesktopChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** Provider configuration stored by the desktop application. */
export interface DesktopAiSettings {
  apiKeyConfigured: boolean;
  model: string;
  baseUrl: string;
}

export interface DesktopAiSettingsUpdate {
  apiKey?: string | null;
  model: string;
  baseUrl: string;
}

export interface DesktopChatRequest {
  messages: DesktopChatMessage[];
  responseFormat?: Record<string, unknown>;
}

/** Matches the content envelope used by the web AI client. */
export interface DesktopChatResponse {
  content: string;
}

const SCENE_FILTER = [{ name: "SimuStyle Scene", extensions: ["simu", "json"] }];

/** True only when this frontend is running inside a Tauri shell. */
export function isDesktopRuntime(): boolean {
  return isTauri();
}

function requireDesktop(): void {
  if (!isDesktopRuntime()) {
    throw new Error("This feature is available in the SimuStyle desktop app.");
  }
}

/** Ask the operating system to choose a scene file to open; null means cancelled. */
export async function chooseSceneToOpen(): Promise<string | null> {
  requireDesktop();
  const selected = await open({ multiple: false, filters: SCENE_FILTER });
  return typeof selected === "string" ? selected : null;
}

/** Ask the operating system where to save a scene; null means cancelled. */
export async function chooseSceneToSave(defaultName = "scene.simu"): Promise<string | null> {
  requireDesktop();
  return await save({ defaultPath: defaultName, filters: SCENE_FILTER });
}

/** Read serialized scene JSON from a path selected by chooseSceneToOpen(). */
export async function readSceneFile(path: string): Promise<string> {
  requireDesktop();
  return invoke<string>("read_scene_file", { path });
}

/** Write serialized scene JSON to a path selected by chooseSceneToSave(). */
export async function writeSceneFile(path: string, contents: string): Promise<void> {
  requireDesktop();
  await invoke<void>("write_scene_file", { path, contents });
}

/** Read the desktop app's persisted AI provider settings. */
export async function getDesktopAiSettings(): Promise<DesktopAiSettings> {
  requireDesktop();
  return invoke<DesktopAiSettings>("get_ai_settings");
}

/** Persist AI provider settings in the desktop app. */
export async function saveDesktopAiSettings(settings: DesktopAiSettingsUpdate): Promise<DesktopAiSettings> {
  requireDesktop();
  return invoke<DesktopAiSettings>("save_ai_settings", { settings });
}

/** Send a chat completion request through the desktop provider implementation. */
export async function desktopChat(request: DesktopChatRequest): Promise<DesktopChatResponse> {
  requireDesktop();
  return invoke<DesktopChatResponse>("ai_chat", { request });
}
