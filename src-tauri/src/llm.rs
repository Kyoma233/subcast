//! Streaming chat with the user's own model service: OpenAI-compatible `/chat/completions` (DeepSeek, SiliconFlow,
//! OpenRouter, Ollama, OpenAI, Kimi…) or Anthropic's Messages API. Keys live in the system keychain.
use crate::net;
use anyhow::{anyhow, Result};
use futures_util::StreamExt;
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, Ordering};

const KEYRING_SERVICE: &str = "ai.qiaomu.subcast";

/// Where keys live on phones: there is no system keychain to talk to, so they go in a 0600 file inside the app's
/// private data directory (which no other app can read on Android or iOS).
#[cfg(any(target_os = "android", target_os = "ios"))]
pub mod keystore_dir {
    use std::path::PathBuf;
    use std::sync::OnceLock;
    static DIR: OnceLock<PathBuf> = OnceLock::new();
    pub fn set(dir: PathBuf) { let _ = DIR.set(dir); }
    pub fn get() -> Option<PathBuf> { DIR.get().cloned() }
}

#[cfg(any(target_os = "android", target_os = "ios"))]
fn key_file(provider: &str) -> Option<std::path::PathBuf> {
    let dir = keystore_dir::get()?.join("keys");
    let _ = std::fs::create_dir_all(&dir);
    Some(dir.join(format!("{}.key", provider.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_').collect::<String>())))
}

pub fn set_key(provider: &str, key: &str) -> Result<()> {
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        let path = key_file(provider).ok_or_else(|| anyhow!("密钥目录未就绪"))?;
        if key.is_empty() {
            let _ = std::fs::remove_file(&path);
        } else {
            std::fs::write(&path, key)?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
            }
        }
        return Ok(());
    }
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        let entry = keyring::Entry::new(KEYRING_SERVICE, provider)?;
        if key.is_empty() {
            let _ = entry.delete_credential();
        } else {
            entry.set_password(key)?;
        }
        Ok(())
    }
}

pub fn get_key(provider: &str) -> Option<String> {
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        let path = key_file(provider)?;
        return std::fs::read_to_string(path).ok().map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    }
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        keyring::Entry::new(KEYRING_SERVICE, provider).ok()?.get_password().ok()
    }
}

/// OpenCode Go/Zen refuses requests without this header (it drives prompt-cache routing).
/// Any stable value passes; a per-install id from the keychain gives the best cache affinity.
fn opencode_session() -> &'static str {
    static ID: once_cell::sync::Lazy<String> = once_cell::sync::Lazy::new(|| {
        if let Some(v) = get_key("opencode-session").filter(|v| !v.is_empty()) { return v; }
        let v = uuid::Uuid::new_v4().to_string();
        let _ = set_key("opencode-session", &v);
        v
    });
    &ID
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Provider {
    pub id: String,
    pub protocol: String,
    pub base_url: String,
    pub model: String,
}

#[derive(Deserialize, Clone, Debug)]
pub struct Message {
    pub role: String,
    pub content: String,
}

fn needs_opencode_session(base_url: &str) -> bool { base_url.contains("opencode.ai") }

fn openai_url(base: &str) -> String {
    let b = base.trim().trim_end_matches('/');
    if b.ends_with("/chat/completions") { b.to_string() } else { format!("{b}/chat/completions") }
}

fn anthropic_url(base: &str) -> String {
    let b = base.trim().trim_end_matches('/');
    let b = if b.is_empty() { "https://api.anthropic.com" } else { b };
    if b.ends_with("/messages") { b.to_string() } else if b.ends_with("/v1") { format!("{b}/messages") } else { format!("{b}/v1/messages") }
}

fn api_error(status: u16, body: &str) -> anyhow::Error {
    let msg = serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|v| v["error"]["message"].as_str().or_else(|| v["error"].as_str()).or_else(|| v["message"].as_str()).map(String::from))
        .unwrap_or_else(|| body.chars().take(200).collect());
    match status {
        401 | 403 => anyhow!("API Key 无效或没有权限：{msg}"),
        404 => anyhow!("模型或地址不存在：{msg}"),
        429 => anyhow!("请求太频繁或额度不足：{msg}"),
        _ => anyhow!("模型服务出错（{status}）：{msg}"),
    }
}

/// Streams one reply; `on_delta` gets each piece of text. Returns the whole text.
pub async fn chat(p: &Provider, system: &str, messages: &[Message], max_tokens: u32, json_mode: bool, cancel: &AtomicBool, mut on_delta: impl FnMut(&str)) -> Result<String> {
    let key = get_key(&p.id);
    let anthropic = p.protocol == "anthropic";
    let req = if anthropic {
        let key = key.ok_or_else(|| anyhow!("请先在设置里填写 API Key"))?;
        let msgs: Vec<Value> = messages.iter().map(|m| json!({"role": m.role, "content": m.content})).collect();
        net::client()
            .post(anthropic_url(&p.base_url))
            .header("x-api-key", key)
            .header("anthropic-version", "2023-06-01")
            .json(&json!({ "model": p.model, "max_tokens": max_tokens, "system": system, "messages": msgs, "stream": true }))
    } else {
        let mut msgs = vec![json!({"role": "system", "content": system})];
        msgs.extend(messages.iter().map(|m| json!({"role": m.role, "content": m.content})));
        let mut body = json!({ "model": p.model, "messages": msgs, "stream": true, "max_tokens": max_tokens });
        if json_mode { body["response_format"] = json!({"type": "json_object"}); }
        let mut r = net::client().post(openai_url(&p.base_url)).json(&body);
        if needs_opencode_session(&p.base_url) { r = r.header("x-opencode-session", opencode_session()); }
        if let Some(k) = key.filter(|k| !k.is_empty()) { r = r.bearer_auth(k); }
        r
    };
    let res = req.send().await.map_err(|e| anyhow!("连不上模型服务：{e}"))?;
    let status = res.status();
    if !status.is_success() {
        let body = res.text().await.unwrap_or_default();
        return Err(api_error(status.as_u16(), &body));
    }
    let mut stream = res.bytes_stream();
    let mut buf = String::new();
    let mut full = String::new();
    while let Some(chunk) = stream.next().await {
        if cancel.load(Ordering::Relaxed) { return Err(anyhow!("已停止")); }
        buf.push_str(&String::from_utf8_lossy(&chunk.map_err(|e| anyhow!("连接中断：{e}"))?));
        while let Some(pos) = buf.find('\n') {
            let line = buf[..pos].trim().to_string();
            buf.drain(..=pos);
            let Some(data) = line.strip_prefix("data:") else { continue };
            let data = data.trim();
            if data == "[DONE]" { return Ok(full); }
            let Ok(v) = serde_json::from_str::<Value>(data) else { continue };
            let piece = if anthropic {
                match v["type"].as_str() {
                    Some("content_block_delta") => v["delta"]["text"].as_str().map(String::from),
                    Some("error") => return Err(anyhow!("模型服务出错：{}", v["error"]["message"].as_str().unwrap_or("未知错误"))),
                    _ => None,
                }
            } else {
                if let Some(e) = v["error"]["message"].as_str() { return Err(anyhow!("模型服务出错：{e}")); }
                v["choices"][0]["delta"]["content"].as_str().map(String::from)
            };
            if let Some(piece) = piece.filter(|p| !p.is_empty()) {
                full.push_str(&piece);
                on_delta(&piece);
            }
        }
    }
    if full.is_empty() { return Err(anyhow!("模型没有返回内容")); }
    Ok(full)
}
