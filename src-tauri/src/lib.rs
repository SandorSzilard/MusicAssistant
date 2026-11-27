use cpal::traits::{DeviceTrait, HostTrait};
use midir::{Ignore, MidiInput, MidiInputConnection, MidiOutput};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::sync::Mutex;
use std::{fs::File, io::Read};
use tauri::{AppHandle, Emitter, State};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HealthInfo {
    app_name: &'static str,
    version: &'static str,
    platform: &'static str,
}

#[tauri::command]
fn health_check() -> HealthInfo {
    HealthInfo {
        app_name: "Music Assistant",
        version: env!("CARGO_PKG_VERSION"),
        platform: std::env::consts::OS,
    }
}

struct MidiInputState {
    connection: Mutex<Option<MidiInputConnection<()>>>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct MidiInputMessage {
    timestamp: u64,
    bytes: Vec<u8>,
}

#[tauri::command]
fn hash_file(path: String) -> Result<String, String> {
    let mut file = File::open(&path).map_err(|e| format!("Cannot open {path}: {e}"))?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 1024 * 128];
    loop {
        let count = file
            .read(&mut buffer)
            .map_err(|e| format!("Read failed: {e}"))?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }
    Ok(hex::encode(hasher.finalize()))
}

#[tauri::command]
fn save_text_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, content).map_err(|e| format!("Could not write {path}: {e}"))
}

#[tauri::command]
fn portable_settings_path() -> Result<String, String> {
    let executable = std::env::current_exe()
        .map_err(|error| format!("Could not determine executable path: {error}"))?;

    let directory = executable
        .parent()
        .ok_or_else(|| "Could not determine executable directory.".to_string())?;

    Ok(directory
        .join("musicassistant.settings")
        .to_string_lossy()
        .into_owned())
}

#[tauri::command]
fn list_audio_files_recursive(path: String) -> Result<Vec<String>, String> {
    fn scan_directory(dir: &std::path::Path, files: &mut Vec<String>) -> Result<(), String> {
        let entries = std::fs::read_dir(dir).map_err(|error| error.to_string())?;

        for entry in entries {
            let entry = entry.map_err(|error| error.to_string())?;
            let path = entry.path();

            if path.is_dir() {
                scan_directory(&path, files)?;
                continue;
            }

            let Some(extension) = path.extension().and_then(|value| value.to_str()) else {
                continue;
            };

            if extension.eq_ignore_ascii_case("mp3") || extension.eq_ignore_ascii_case("wav") {
                files.push(path.to_string_lossy().into_owned());
            }
        }

        Ok(())
    }

    let root = std::path::Path::new(&path);

    if !root.is_dir() {
        return Err("Selected path is not a folder.".to_string());
    }

    let mut files = Vec::new();
    scan_directory(root, &mut files)?;

    Ok(files)
}

#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("Could not read {path}: {e}"))
}

#[tauri::command]
fn list_audio_output_devices() -> Result<Vec<String>, String> {
    let host = cpal::default_host();
    let devices = host
        .output_devices()
        .map_err(|e| format!("Audio device enumeration failed: {e}"))?;
    let mut names = Vec::new();
    for device in devices {
        let name = device
            .description()
            .map(|d| d.name().to_string())
            .unwrap_or_else(|_| "Unknown audio output".to_string());

        names.push(name);
    }
    Ok(names)
}

#[tauri::command]
fn list_midi_output_devices() -> Result<Vec<String>, String> {
    let midi = MidiOutput::new("Music Assistant device scan")
        .map_err(|e| format!("MIDI init failed: {e}"))?;
    let mut names = Vec::new();
    for port in midi.ports() {
        names.push(
            midi.port_name(&port)
                .unwrap_or_else(|_| "Unknown MIDI output".to_string()),
        );
    }
    Ok(names)
}

#[tauri::command]
fn list_midi_input_devices() -> Result<Vec<String>, String> {
    let midi = MidiInput::new("Music Assistant input device scan")
        .map_err(|e| format!("MIDI input init failed: {e}"))?;

    let mut names = Vec::new();

    for port in midi.ports() {
        names.push(
            midi.port_name(&port)
                .unwrap_or_else(|_| "Unknown MIDI input".to_string()),
        );
    }

    Ok(names)
}

#[tauri::command]
fn start_midi_input_listener(
    app: AppHandle,
    state: State<'_, MidiInputState>,
    device_name: String,
) -> Result<(), String> {
    let mut midi = MidiInput::new("Music Assistant MIDI input")
        .map_err(|e| format!("MIDI input init failed: {e}"))?;

    midi.ignore(Ignore::None);

    let port = midi
        .ports()
        .into_iter()
        .find(|port| midi.port_name(port).ok().as_deref() == Some(device_name.as_str()))
        .ok_or_else(|| format!("MIDI input not found: {device_name}"))?;

    let app_handle = app.clone();

    let connection = midi
        .connect(
            &port,
            "music-assistant-midi-input",
            move |timestamp, message, _| {
                let payload = MidiInputMessage {
                    timestamp,
                    bytes: message.to_vec(),
                };

                if let Err(error) = app_handle.emit("midi-input-message", payload) {
                    eprintln!("Failed to emit MIDI input message: {error}");
                }
            },
            (),
        )
        .map_err(|e| format!("MIDI input connect failed: {e}"))?;

    let mut current = state
        .connection
        .lock()
        .map_err(|_| "MIDI input state lock failed".to_string())?;

    *current = Some(connection);

    Ok(())
}

#[tauri::command]
fn stop_midi_input_listener(state: State<'_, MidiInputState>) -> Result<(), String> {
    let mut current = state
        .connection
        .lock()
        .map_err(|_| "MIDI input state lock failed".to_string())?;

    *current = None;

    Ok(())
}

#[tauri::command]
fn send_midi_bytes(device_name: String, bytes: Vec<u8>) -> Result<(), String> {
    if bytes.is_empty() {
        return Err("MIDI byte array is empty".into());
    }
    let midi = MidiOutput::new("Music Assistant test send")
        .map_err(|e| format!("MIDI init failed: {e}"))?;
    let port = midi
        .ports()
        .into_iter()
        .find(|port| midi.port_name(port).ok().as_deref() == Some(device_name.as_str()))
        .ok_or_else(|| format!("MIDI output not found: {device_name}"))?;
    let mut connection = midi
        .connect(&port, "music-assistant-output")
        .map_err(|e| format!("MIDI connect failed: {e}"))?;
    connection
        .send(&bytes)
        .map_err(|e| format!("MIDI send failed: {e}"))?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(MidiInputState {
            connection: Mutex::new(None),
        })
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            health_check,
            hash_file,
            save_text_file,
            read_text_file,
            portable_settings_path,
            list_audio_output_devices,
            list_midi_input_devices,
            list_midi_output_devices,
            start_midi_input_listener,
            stop_midi_input_listener,
            send_midi_bytes,
            list_audio_files_recursive
        ])
        .run(tauri::generate_context!())
        .expect("error while running Music Assistant");
}

#[cfg(test)]
mod tests {
    use super::hash_file;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn hash_file_returns_the_sha256_of_file_contents() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be after the Unix epoch")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("music-assistant-hash-test-{nonce}.bin"));
        std::fs::write(&path, b"abc").expect("temporary test file should be writable");

        let result = hash_file(path.to_string_lossy().into_owned());
        std::fs::remove_file(path).expect("temporary test file should be removable");

        assert_eq!(
            result.expect("hashing the temporary file should succeed"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }
}
