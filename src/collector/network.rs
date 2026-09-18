use std::collections::HashMap;
use std::fs;
use std::sync::Arc;
use std::time::Duration;

use chrono::{DateTime, Utc};
use tokio::sync::RwLock;

use super::round_float;
use crate::model::{InterfaceThroughput, NetworkStatus};

#[derive(Debug, Clone)]
struct RawNetDev {
    rx_bytes: u64,
    rx_packets: u64,
    rx_errors: u64,
    tx_bytes: u64,
    tx_packets: u64,
    tx_errors: u64,
    timestamp: DateTime<Utc>,
}

#[derive(Clone)]
pub struct NetworkSampler {
    status: Arc<RwLock<NetworkStatus>>,
}

static SAMPLER: tokio::sync::OnceCell<NetworkSampler> = tokio::sync::OnceCell::const_new();

/// 初始化全局网卡采样器并启动后台异步任务
pub async fn init_network_sampler(interval: Duration) -> NetworkSampler {
    SAMPLER
        .get_or_init(|| async {
            let initial_status = NetworkStatus {
                timestamp: Utc::now(),
                interfaces: Vec::new(),
            };
            let status = Arc::new(RwLock::new(initial_status));
            let sampler = NetworkSampler {
                status: status.clone(),
            };

            // 启动后台采样协程
            tokio::spawn(async move {
                let mut last_raw: HashMap<String, RawNetDev> = HashMap::new();
                let mut ticker = tokio::time::interval(interval);

                loop {
                    ticker.tick().await;
                    let now = Utc::now();
                    let current_raws = read_proc_net_dev(now);

                    let mut interfaces = Vec::new();
                    for (iface_name, current) in &current_raws {
                        let mut rx_rate = 0.0;
                        let mut tx_rate = 0.0;

                        if let Some(last) = last_raw.get(iface_name) {
                            let duration_sec =
                                (current.timestamp - last.timestamp).num_milliseconds() as f64
                                    / 1000.0;
                            if duration_sec > 0.0 {
                                if current.rx_bytes >= last.rx_bytes {
                                    rx_rate =
                                        (current.rx_bytes - last.rx_bytes) as f64 / duration_sec;
                                }
                                if current.tx_bytes >= last.tx_bytes {
                                    tx_rate =
                                        (current.tx_bytes - last.tx_bytes) as f64 / duration_sec;
                                }
                            }
                        }

                        let rx_kbps = round_float(rx_rate * 8.0 / 1000.0, 2);
                        let tx_kbps = round_float(tx_rate * 8.0 / 1000.0, 2);
                        let rx_mbps = round_float(rx_kbps / 1000.0, 2);
                        let tx_mbps = round_float(tx_kbps / 1000.0, 2);

                        interfaces.push(InterfaceThroughput {
                            interface: iface_name.clone(),
                            rx_bytes_per_sec: round_float(rx_rate, 2),
                            tx_bytes_per_sec: round_float(tx_rate, 2),
                            rx_kbps,
                            tx_kbps,
                            rx_mbps,
                            tx_mbps,
                            rx_total_bytes: current.rx_bytes,
                            tx_total_bytes: current.tx_bytes,
                            rx_total_packets: current.rx_packets,
                            tx_total_packets: current.tx_packets,
                            rx_errors: current.rx_errors,
                            tx_errors: current.tx_errors,
                            timestamp: now,
                        });
                    }

                    // 接口按名称排序
                    interfaces.sort_by(|a, b| a.interface.cmp(&b.interface));

                    *status.write().await = NetworkStatus {
                        timestamp: now,
                        interfaces,
                    };

                    last_raw = current_raws;
                }
            });

            sampler
        })
        .await
        .clone()
}

/// 获取最新网络状态快照
pub async fn get_network_status() -> NetworkStatus {
    if let Some(sampler) = SAMPLER.get() {
        sampler.status.read().await.clone()
    } else {
        let now = Utc::now();
        NetworkStatus {
            timestamp: now,
            interfaces: Vec::new(),
        }
    }
}

fn read_proc_net_dev(now: DateTime<Utc>) -> HashMap<String, RawNetDev> {
    let mut results = HashMap::new();
    let content = match fs::read_to_string("/proc/net/dev") {
        Ok(c) => c,
        Err(_) => return results,
    };

    let mut lines = content.lines();
    // 跳过前两行表头
    lines.next();
    lines.next();

    for line in lines {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        if let Some((iface, data)) = line.split_once(':') {
            let iface = iface.trim().to_string();
            let fields: Vec<&str> = data.split_whitespace().collect();
            if fields.len() < 16 {
                continue;
            }

            let rx_bytes = fields[0].parse::<u64>().unwrap_or(0);
            let rx_packets = fields[1].parse::<u64>().unwrap_or(0);
            let rx_errors = fields[2].parse::<u64>().unwrap_or(0);
            let tx_bytes = fields[8].parse::<u64>().unwrap_or(0);
            let tx_packets = fields[9].parse::<u64>().unwrap_or(0);
            let tx_errors = fields[10].parse::<u64>().unwrap_or(0);

            results.insert(
                iface,
                RawNetDev {
                    rx_bytes,
                    rx_packets,
                    rx_errors,
                    tx_bytes,
                    tx_packets,
                    tx_errors,
                    timestamp: now,
                },
            );
        }
    }

    results
}
