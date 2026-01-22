//! LSP transport layer.
//!
//! Handles JSON-RPC message framing over stdio (Content-Length headers).

use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::Value as JsonValue;
use std::io::{BufRead, BufReader, Write};
use std::process::{ChildStdin, ChildStdout};
use std::sync::mpsc;
use std::thread;

/// A JSON-RPC request.
#[derive(Debug, Clone, Serialize)]
pub struct Request {
    pub jsonrpc: &'static str,
    pub id: u64,
    pub method: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub params: Option<JsonValue>,
}

impl Request {
    pub fn new(id: u64, method: impl Into<String>, params: Option<JsonValue>) -> Self {
        Self {
            jsonrpc: "2.0",
            id,
            method: method.into(),
            params,
        }
    }
}

/// A JSON-RPC notification (no id, no response expected).
#[derive(Debug, Clone, Serialize)]
pub struct Notification {
    pub jsonrpc: &'static str,
    pub method: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub params: Option<JsonValue>,
}

impl Notification {
    pub fn new(method: impl Into<String>, params: Option<JsonValue>) -> Self {
        Self {
            jsonrpc: "2.0",
            method: method.into(),
            params,
        }
    }
}

/// A JSON-RPC response.
#[derive(Debug, Clone, Deserialize)]
pub struct Response {
    #[allow(dead_code)]
    pub jsonrpc: String,
    pub id: Option<u64>,
    #[serde(default)]
    pub result: Option<JsonValue>,
    #[serde(default)]
    pub error: Option<ResponseError>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ResponseError {
    pub code: i32,
    pub message: String,
    #[serde(default)]
    pub data: Option<JsonValue>,
}

impl std::fmt::Display for ResponseError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "LSP error {}: {}", self.code, self.message)
    }
}

/// An incoming message from the server.
#[derive(Debug, Clone, Deserialize)]
pub struct IncomingMessage {
    #[allow(dead_code)]
    pub jsonrpc: String,
    /// Present for requests and responses, absent for notifications
    pub id: Option<u64>,
    /// Present for requests and notifications
    pub method: Option<String>,
    /// Present for requests and notifications
    pub params: Option<JsonValue>,
    /// Present for successful responses
    pub result: Option<JsonValue>,
    /// Present for error responses
    pub error: Option<ResponseError>,
}

impl IncomingMessage {
    /// Check if this is a response (has id and no method).
    pub fn is_response(&self) -> bool {
        self.id.is_some() && self.method.is_none()
    }

    /// Check if this is a notification (has method and no id).
    pub fn is_notification(&self) -> bool {
        self.method.is_some() && self.id.is_none()
    }

    /// Convert to Response if this is a response.
    pub fn into_response(self) -> Option<Response> {
        if self.is_response() {
            Some(Response {
                jsonrpc: self.jsonrpc,
                id: self.id,
                result: self.result,
                error: self.error,
            })
        } else {
            None
        }
    }
}

/// Write an LSP message to the server's stdin.
pub fn write_message<W: Write>(writer: &mut W, content: &[u8]) -> std::io::Result<()> {
    write!(writer, "Content-Length: {}\r\n\r\n", content.len())?;
    writer.write_all(content)?;
    writer.flush()
}

/// Send a request to the server.
pub fn send_request<W: Write>(writer: &mut W, request: &Request) -> std::io::Result<()> {
    let content = serde_json::to_vec(request)?;
    write_message(writer, &content)
}

/// Send a notification to the server.
pub fn send_notification<W: Write>(
    writer: &mut W,
    notification: &Notification,
) -> std::io::Result<()> {
    let content = serde_json::to_vec(notification)?;
    write_message(writer, &content)
}

/// Read a single LSP message from a buffered reader.
/// Returns the raw JSON value.
pub fn read_message<R: BufRead>(reader: &mut R) -> std::io::Result<JsonValue> {
    // Read headers
    let mut content_length: Option<usize> = None;

    loop {
        let mut header = String::new();
        reader.read_line(&mut header)?;

        // Empty line (just \r\n) signals end of headers
        if header == "\r\n" || header == "\n" {
            break;
        }

        // Parse Content-Length header
        let header = header.trim();
        if let Some(len_str) = header.strip_prefix("Content-Length:") {
            content_length = Some(
                len_str
                    .trim()
                    .parse()
                    .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?,
            );
        }
        // Ignore other headers (Content-Type, etc.)
    }

    let content_length = content_length.ok_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "Missing Content-Length header",
        )
    })?;

    // Read body
    let mut body = vec![0u8; content_length];
    reader.read_exact(&mut body)?;

    // Parse JSON
    serde_json::from_slice(&body)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))
}

/// Parse a JSON value into a typed result.
pub fn parse_result<T: DeserializeOwned>(value: JsonValue) -> Result<T, String> {
    serde_json::from_value(value).map_err(|e| format!("Failed to parse response: {}", e))
}

/// A message reader that runs in a background thread and sends messages through a channel.
pub struct MessageReader {
    receiver: mpsc::Receiver<IncomingMessage>,
    _handle: thread::JoinHandle<()>,
}

impl MessageReader {
    /// Spawn a background thread to read messages from the server's stdout.
    pub fn spawn(stdout: ChildStdout) -> Self {
        let (sender, receiver) = mpsc::channel();

        let handle = thread::spawn(move || {
            let mut reader = BufReader::new(stdout);
            loop {
                match read_message(&mut reader) {
                    Ok(value) => {
                        match serde_json::from_value::<IncomingMessage>(value) {
                            Ok(msg) => {
                                if sender.send(msg).is_err() {
                                    // Receiver dropped, exit
                                    break;
                                }
                            }
                            Err(e) => {
                                eprintln!("LSP: Failed to parse message: {}", e);
                            }
                        }
                    }
                    Err(e) => {
                        // EOF or error, server probably exited
                        eprintln!("LSP: Read error: {}", e);
                        break;
                    }
                }
            }
        });

        Self {
            receiver,
            _handle: handle,
        }
    }

    /// Try to receive a message without blocking.
    pub fn try_recv(&self) -> Option<IncomingMessage> {
        self.receiver.try_recv().ok()
    }

    /// Receive a message, blocking until one is available.
    pub fn recv(&self) -> Option<IncomingMessage> {
        self.receiver.recv().ok()
    }

    /// Receive a message with a timeout.
    pub fn recv_timeout(&self, timeout: std::time::Duration) -> Option<IncomingMessage> {
        self.receiver.recv_timeout(timeout).ok()
    }
}

/// A message writer for sending requests/notifications to the server.
pub struct MessageWriter {
    stdin: ChildStdin,
}

impl MessageWriter {
    pub fn new(stdin: ChildStdin) -> Self {
        Self { stdin }
    }

    pub fn send_request(&mut self, request: &Request) -> std::io::Result<()> {
        send_request(&mut self.stdin, request)
    }

    pub fn send_notification(&mut self, notification: &Notification) -> std::io::Result<()> {
        send_notification(&mut self.stdin, notification)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_write_message() {
        let mut buf = Vec::new();
        write_message(&mut buf, b"hello").unwrap();
        assert_eq!(buf, b"Content-Length: 5\r\n\r\nhello");
    }

    #[test]
    fn test_read_message() {
        let data = b"Content-Length: 13\r\n\r\n{\"test\": 123}";
        let mut reader = BufReader::new(&data[..]);
        let value = read_message(&mut reader).unwrap();
        assert_eq!(value, serde_json::json!({"test": 123}));
    }

    #[test]
    fn test_read_message_with_extra_headers() {
        let data = b"Content-Length: 13\r\nContent-Type: application/json\r\n\r\n{\"test\": 456}";
        let mut reader = BufReader::new(&data[..]);
        let value = read_message(&mut reader).unwrap();
        assert_eq!(value, serde_json::json!({"test": 456}));
    }

    #[test]
    fn test_request_serialization() {
        let req = Request::new(1, "test/method", Some(serde_json::json!({"foo": "bar"})));
        let json = serde_json::to_string(&req).unwrap();
        assert!(json.contains("\"jsonrpc\":\"2.0\""));
        assert!(json.contains("\"id\":1"));
        assert!(json.contains("\"method\":\"test/method\""));
    }

    #[test]
    fn test_notification_serialization() {
        let notif = Notification::new("test/notify", None);
        let json = serde_json::to_string(&notif).unwrap();
        assert!(json.contains("\"jsonrpc\":\"2.0\""));
        assert!(json.contains("\"method\":\"test/notify\""));
        assert!(!json.contains("\"id\""));
    }

    #[test]
    fn test_incoming_message_is_response() {
        let msg = IncomingMessage {
            jsonrpc: "2.0".to_string(),
            id: Some(1),
            method: None,
            params: None,
            result: Some(serde_json::json!({})),
            error: None,
        };
        assert!(msg.is_response());
        assert!(!msg.is_notification());
    }

    #[test]
    fn test_incoming_message_is_notification() {
        let msg = IncomingMessage {
            jsonrpc: "2.0".to_string(),
            id: None,
            method: Some("test".to_string()),
            params: Some(serde_json::json!({})),
            result: None,
            error: None,
        };
        assert!(!msg.is_response());
        assert!(msg.is_notification());
    }
}
