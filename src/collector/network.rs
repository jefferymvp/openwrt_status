use std::collections::HashMap;
use std::fs;
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use chrono::{DateTime, Utc};
use tokio::sync::{Notify, RwLock};
use tracing::info;

use super::round_float;
use crate::model::{InterfaceThroughput, NetworkStatus};

/// 客户端无请求判定超时间隔（秒）：超过该时间无客户端访问则自动暂停定时采样进入休眠
pub const CLIENT_INACTIVITY_TIMEOUT_SECS: i64 = 10;

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
    last_touch: Arc<AtomicI64>,
    notify: Arc<Notify>,
    is_sleeping: Arc<AtomicBool>,
}

static SAMPLER: tokio::sync::OnceCell<NetworkSampler> = tokio::sync::OnceCell::const_new();

/// 通知有客户端活跃连接（刷新活跃时间并在休眠时唤醒采样器）
pub fn touch_client_activity() {
    if let Some(sampler) = SAMPLER.get() {
        let now_ts = Utc::now().timestamp();
        sampler.last_touch.store(now_ts, Ordering::Relaxed);
        if sampler.is_sleeping.load(Ordering::Relaxed) {
            sampler.notify.notify_one();
        }
    }
}

/// 初始化全局网卡采样器（初始处于休眠状态，等待客户端连接时激活）
pub async fn init_network_sampler(interval: Duration) -> NetworkSampler {
    SAMPLER
        .get_or_init(|| async {
            let initial_status = NetworkStatus {
                timestamp: Utc::now(),
                interfaces: Vec::new(),
            };
            let status = Arc::new(RwLock::new(initial_status));
            let last_touch = Arc::new(AtomicI64::new(0));
            let notify = Arc::new(Notify::new());
            let is_sleeping = Arc::new(AtomicBool::new(true));

            let sampler = NetworkSampler {
                status: status.clone(),
                last_touch: last_touch.clone(),
                notify: notify.clone(),
                is_sleeping: is_sleeping.clone(),
            };

            // 启动后台采样协程（按需采集）
            tokio::spawn(async move {
                let mut last_raw: HashMap<String, RawNetDev> = HashMap::new();

                loop {
                    let now_ts = Utc::now().timestamp();
                    let last = last_touch.load(Ordering::Relaxed);

                    // 若无客户端连接（未收到过请求，或距离上次请求超过判定窗口），进入休眠等待
                    if last == 0 || (now_ts - last) >= CLIENT_INACTIVITY_TIMEOUT_SECS {
                        if !is_sleeping.load(Ordering::Relaxed) {
                            is_sleeping.store(true, Ordering::Relaxed);
                            info!(
                                "No client connected in {}s, network sampler entering idle sleep mode.",
                                CLIENT_INACTIVITY_TIMEOUT_SECS
                            );
                        }
                        notify.notified().await;
                        is_sleeping.store(false, Ordering::Relaxed);
                        info!("Client connected! Network sampler awakened, resuming periodic sampling.");
                        last_raw.clear();
                    }

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
                    tokio::time::sleep(interval).await;
                }
            });

            sampler
        })
        .await
        .clone()
}

/// 获取最新网络状态快照
pub async fn get_network_status() -> NetworkStatus {
    touch_client_activity();
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
