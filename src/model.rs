use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BaseResponse<T> {
    pub code: u16,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<T>,
}

impl<T> BaseResponse<T> {
    pub fn success(data: T) -> Self {
        Self {
            code: 200,
            message: "success".to_string(),
            data: Some(data),
        }
    }

    pub fn error(code: u16, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            data: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CPUCoreInfo {
    pub core_id: usize,
    pub frequency_mhz: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CPUStatus {
    pub model_name: String,
    pub cores: usize,
    pub avg_frequency_mhz: f64,
    pub core_list: Vec<CPUCoreInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThermalItem {
    pub name: String,
    pub temperature: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub r#type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThermalStatus {
    pub sensors: Vec<ThermalItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClientItem {
    pub ip_address: String,
    pub mac_address: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hostname: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<String>,
    pub source: String, // "dhcp" 或 "arp"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClientStatus {
    pub total_clients: usize,
    pub clients: Vec<ClientItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InterfaceThroughput {
    pub interface: String,

    pub rx_bytes_per_sec: f64,
    pub tx_bytes_per_sec: f64,
    pub rx_kbps: f64,
    pub tx_kbps: f64,
    pub rx_mbps: f64,
    pub tx_mbps: f64,

    pub rx_total_bytes: u64,
    pub tx_total_bytes: u64,
    pub rx_total_packets: u64,
    pub tx_total_packets: u64,
    pub rx_errors: u64,
    pub tx_errors: u64,

    pub timestamp: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetworkStatus {
    pub timestamp: DateTime<Utc>,
    pub interfaces: Vec<InterfaceThroughput>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemInfo {
    pub hostname: String,
    pub current_time: DateTime<Utc>,
    pub uptime_seconds: i64,
    pub uptime_format: String,
    pub load_avg_1: f64,
    pub load_avg_5: f64,
    pub load_avg_15: f64,
    pub total_memory_kb: u64,
    pub free_memory_kb: u64,
    pub avail_memory_kb: u64,
    pub memory_usage_percent: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AllStatusResponse {
    pub system: SystemInfo,
    pub cpu: CPUStatus,
    pub thermal: ThermalStatus,
    pub clients: ClientStatus,
    pub network: NetworkStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecRequest {
    pub command: String,
    #[serde(default)]
    pub timeout: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ExecStreamMessage {
    #[serde(rename = "status")]
    Status {
        status: String,
        elapsed_seconds: u64,
        message: String,
    },
    #[serde(rename = "result")]
    Result {
        status: String,
        exit_code: i32,
        success: bool,
        stdout: String,
        stderr: String,
        elapsed_seconds: f64,
    },
    #[serde(rename = "error")]
    Error {
        status: String,
        message: String,
    },
}
