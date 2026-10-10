use std::{fs, path::{Path, PathBuf}};

use keyring::Entry;
use reqwest::header::{AUTHORIZATION, CONTENT_TYPE};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};
use url::Url;

const KEYRING_SERVICE: &str = "com.simustyle.editor";
const KEYRING_USER: &str = "ai-api-key";
const CONFIG_FILE: &str = "settings.json";
const MAX_CHAT_BYTES: usize = 1024 * 1024;
const MAX_SCENE_BYTES: u64 = 10 * 1024 * 1024;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AiSettings {
    model: String,
    base_url: String,
}

impl Default for AiSettings {
    fn default() -> Self {
        Self {
            model: "gpt-4o-mini".to_string(),
            base_url: "https://api.openai.com/v1".to_string(),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PublicAiSettings {
    api_key_configured: bool,
    model: String,
    base_url: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AiSettingsUpdate {
    #[serde(default)]
    api_key: Option<Option<String>>,
    model: String,
    base_url: String,
}

#[derive(Deserialize)]
struct ChatRequest {
    messages: Vec<ChatMessage>,
    #[serde(rename = "responseFormat")]
    response_format: Option<Value>,
}

#[derive(Deserialize)]
struct ChatMessage {
    role: String,
    content: String,
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| format!("Could not locate the application settings directory: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("Could not create the application settings directory: {e}"))?;
    Ok(dir.join(CONFIG_FILE))
}

fn read_settings(app: &AppHandle) -> Result<AiSettings, String> {
    let path = settings_path(app)?;
    match fs::read(&path) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|e| format!("Could not read AI settings: {e}")),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(AiSettings::default()),
        Err(error) => Err(format!("Could not read AI settings: {error}")),
    }
}

fn write_settings(app: &AppHandle, settings: &AiSettings) -> Result<(), String> {
    let path = settings_path(app)?;
    let bytes = serde_json::to_vec_pretty(settings).map_err(|e| format!("Could not encode AI settings: {e}"))?;
    fs::write(&path, bytes).map_err(|e| format!("Could not save AI settings: {e}"))
}

fn api_key_entry() -> Result<Entry, String> {
    Entry::new(KEYRING_SERVICE, KEYRING_USER).map_err(|e| format!("Could not access the operating system credential store: {e}"))
}

fn validate_settings(settings: &AiSettings) -> Result<(), String> {
    let model = settings.model.trim();
    if model.is_empty() || model.len() > 200 {
        return Err("Enter a model name between 1 and 200 characters.".to_string());
    }
    let base = settings.base_url.trim();
    if base.len() > 2048 {
        return Err("AI base URL is too long.".to_string());
    }
    let parsed = Url::parse(base).map_err(|_| "AI base URL must be a valid HTTP or HTTPS URL.".to_string())?;
    if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().is_none() {
        return Err("AI base URL must be a valid HTTP or HTTPS URL.".to_string());
    }
    Ok(())
}

#[tauri::command]
fn get_ai_settings(app: AppHandle) -> Result<PublicAiSettings, String> {
    let settings = read_settings(&app)?;
    let api_key_configured = match api_key_entry()?.get_password() {
        Ok(key) => !key.is_empty(),
        Err(keyring::Error::NoEntry) => false,
        Err(error) => return Err(format!("Could not read the API key from the operating system credential store: {error}")),
    };
    Ok(PublicAiSettings {
        api_key_configured,
        model: settings.model,
        base_url: settings.base_url,
    })
}

#[tauri::command]
fn save_ai_settings(app: AppHandle, settings: AiSettingsUpdate) -> Result<PublicAiSettings, String> {
    let next = AiSettings {
        model: settings.model.trim().to_string(),
        base_url: settings.base_url.trim().trim_end_matches('/').to_string(),
    };
    validate_settings(&next)?;

    if let Some(api_key) = settings.api_key {
        match api_key.as_deref().map(str::trim).filter(|key| !key.is_empty()) {
            Some(key) => {
                if key.len() > 4096 {
                    return Err("API key is too long.".to_string());
                }
                api_key_entry()?.set_password(key).map_err(|e| format!("Could not save the API key to the operating system credential store: {e}"))?;
            }
            None => {
                match api_key_entry()?.delete_credential() {
                    Ok(()) | Err(keyring::Error::NoEntry) => {}
                    Err(error) => return Err(format!("Could not delete the API key from the operating system credential store: {error}")),
                }
            }
        }
    }

    write_settings(&app, &next)?;
    get_ai_settings(app)
}

#[tauri::command]
fn delete_ai_api_key() -> Result<(), String> {
    match api_key_entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(format!("Could not delete the API key from the operating system credential store: {error}")),
    }
}

#[tauri::command]
async fn ai_chat(app: AppHandle, request: ChatRequest) -> Result<Value, String> {
    let messages = request.messages;
    if messages.len() < 2 || messages.len() > 8 || messages.iter().any(|message| {
        !matches!(message.role.as_str(), "system" | "user" | "assistant") || message.content.len() > 50_000
    }) {
        return Err("AI request must contain 2–8 system, user, or assistant messages, each at most 50,000 characters.".to_string());
    }
    let response_format = request.response_format;
    if response_format.as_ref().is_some_and(|format| !format.is_object()) {
        return Err("AI request requires a JSON response format object.".to_string());
    }
    let mut body = json!({ "messages": messages.iter().map(|message| json!({ "role": message.role, "content": message.content })).collect::<Vec<_>>() });
    if let Some(format) = response_format {
        body["response_format"] = format;
    }
    let encoded = serde_json::to_vec(&body).map_err(|e| format!("Could not encode AI request: {e}"))?;
    if encoded.len() > MAX_CHAT_BYTES {
        return Err("AI request body exceeds 1 MiB.".to_string());
    }

    let settings = read_settings(&app)?;
    validate_settings(&settings)?;
    let api_key = api_key_entry()?.get_password().map_err(|error| match error {
        keyring::Error::NoEntry => "AI is not configured. Add an API key in AI Settings.".to_string(),
        other => format!("Could not read the API key from the operating system credential store: {other}"),
    })?;
    let endpoint = format!("{}/chat/completions", settings.base_url.trim_end_matches('/'));
    body["model"] = json!(settings.model);

    let response = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| format!("Could not create AI provider request: {e}"))?
        .post(endpoint)
        .header(AUTHORIZATION, format!("Bearer {api_key}"))
        .header(CONTENT_TYPE, "application/json")
        .json(&body)
        .send().await.map_err(|error| {
            if error.is_timeout() { "AI provider request timed out.".to_string() }
            else { "Could not reach the configured AI provider.".to_string() }
        })?;
    let status = response.status();
    let bytes = response.bytes().await.map_err(|_| "Could not read the AI provider response.".to_string())?;
    if bytes.len() > MAX_CHAT_BYTES * 2 {
        return Err("AI provider response exceeds 2 MiB.".to_string());
    }
    let payload: Value = serde_json::from_slice(&bytes).map_err(|_| "AI provider returned invalid JSON.".to_string())?;
    if !status.is_success() {
        let message = payload.pointer("/error/message").and_then(Value::as_str)
            .map(|value| value.chars().take(500).collect::<String>())
            .unwrap_or_else(|| format!("AI provider returned HTTP {}.", status.as_u16()));
        return Err(message);
    }
    let content = payload.pointer("/choices/0/message/content").and_then(Value::as_str)
        .ok_or_else(|| "AI provider returned no message content.".to_string())?;
    Ok(json!({ "content": content }))
}

fn scene_path(path: &str) -> Result<PathBuf, String> {
    let target = Path::new(path);
    let extension = target.extension().and_then(|extension| extension.to_str()).unwrap_or_default();
    if !target.is_absolute() || !(extension.eq_ignore_ascii_case("json") || extension.eq_ignore_ascii_case("simu")) {
        return Err("Choose an absolute path to a .simu or .json scene file.".to_string());
    }
    Ok(target.to_path_buf())
}

#[tauri::command]
fn read_scene_file(path: String) -> Result<String, String> {
    let path = scene_path(&path)?;
    let metadata = fs::metadata(&path).map_err(|e| format!("Could not open scene file: {e}"))?;
    if metadata.len() > MAX_SCENE_BYTES {
        return Err("Scene file exceeds the 10 MiB limit.".to_string());
    }
    let contents = fs::read_to_string(path).map_err(|e| format!("Could not read scene file: {e}"))?;
    serde_json::from_str::<Value>(&contents).map_err(|e| format!("Scene file must contain valid JSON: {e}"))?;
    Ok(contents)
}

#[tauri::command]
fn write_scene_file(path: String, contents: String) -> Result<(), String> {
    let path = scene_path(&path)?;
    if contents.len() as u64 > MAX_SCENE_BYTES {
        return Err("Scene file exceeds the 10 MiB limit.".to_string());
    }
    serde_json::from_str::<Value>(&contents).map_err(|e| format!("Scene content must be valid JSON: {e}"))?;
    fs::write(path, contents).map_err(|e| format!("Could not save scene file: {e}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            ai_chat,
            get_ai_settings,
            save_ai_settings,
            delete_ai_api_key,
            read_scene_file,
            write_scene_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running SimuStyle");
}
