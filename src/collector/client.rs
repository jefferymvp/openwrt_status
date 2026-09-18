use std::collections::HashMap;
use std::fs;
use std::path::Path;

use chrono::{DateTime, TimeZone, Utc};

use crate::model::{ClientItem, ClientStatus};

const DHCP_PATHS: &[&str] = &[
    "/tmp/dhcp.leases",
    "/var/lib/misc/dnsmasq.leases",
    "/etc/dnsmasq/leases",
];

/// 获取当前连接的客户端列表及统计
pub fn get_client_status() -> ClientStatus {
    let mut client_map: HashMap<String, ClientItem> = HashMap::new();

    // 1. 解析 DHCP 租约
    parse_dhcp_leases(&mut client_map);

    // 2. 解析 /proc/net/arp 补充 ARP 缓存中的局域网设备
    parse_arp_table(&mut client_map);

    let mut clients: Vec<ClientItem> = client_map.into_values().collect();
    // 按 IP 地址排序
    clients.sort_by(|a, b| a.ip_address.cmp(&b.ip_address));

    ClientStatus {
        total_clients: clients.len(),
        clients,
    }
}

fn parse_dhcp_leases(client_map: &mut HashMap<String, ClientItem>) {
    for path_str in DHCP_PATHS {
        let path = Path::new(path_str);
        if !path.exists() {
            continue;
        }

        let content = match fs::read_to_string(path) {
            Ok(c) => c,
            Err(_) => continue,
        };

        let now = Utc::now().timestamp();

        for line in content.lines() {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }

            // 格式: <expiry_ts> <mac> <ip> <hostname> <client_id>
            let fields: Vec<&str> = line.split_whitespace().collect();
            if fields.len() < 4 {
                continue;
            }

            let expiry_ts = fields[0].parse::<i64>().unwrap_or(0);
            if expiry_ts > 0 && expiry_ts < now {
                // 已过期租约忽略
                continue;
            }

            let mac = fields[1].to_lowercase();
            let ip = fields[2].to_string();
            let mut hostname = fields[3].to_string();
            if hostname == "*" {
                hostname.clear();
            }

            let expires_at = if expiry_ts > 0 {
                Utc.timestamp_opt(expiry_ts, 0)
                    .single()
                    .map(|dt: DateTime<Utc>| dt.format("%Y-%m-%d %H:%M:%S").to_string())
            } else {
                Some("Never".to_string())
            };

            client_map.insert(
                mac.clone(),
                ClientItem {
                    ip_address: ip,
                    mac_address: mac,
                    hostname: if hostname.is_empty() {
                        None
                    } else {
                        Some(hostname)
                    },
                    expires_at,
                    source: "dhcp".to_string(),
                },
            );
        }
        return;
    }
}

fn parse_arp_table(client_map: &mut HashMap<String, ClientItem>) {
    let content = match fs::read_to_string("/proc/net/arp") {
        Ok(c) => c,
        Err(_) => return,
    };

    let mut lines = content.lines();
    // 跳过首行表头
    lines.next();

    for line in lines {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        // 格式: IP address   HW type   Flags   HW address   Mask   Device
        let fields: Vec<&str> = line.split_whitespace().collect();
        if fields.len() < 4 {
            continue;
        }

        let ip = fields[0];
        let flags = fields[2];
        let mac = fields[3].to_lowercase();

        // 0x2 表示有效解析记录
        if flags != "0x2" || mac == "00:00:00:00:00:00" {
            continue;
        }

        if let Some(existing) = client_map.get_mut(&mac) {
            if existing.ip_address.is_empty() {
                existing.ip_address = ip.to_string();
            }
        } else {
            client_map.insert(
                mac.clone(),
                ClientItem {
                    ip_address: ip.to_string(),
                    mac_address: mac,
                    hostname: None,
                    expires_at: None,
                    source: "arp".to_string(),
                },
            );
        }
    }
}
