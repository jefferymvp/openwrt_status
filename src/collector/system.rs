use std::fs;

use chrono::Utc;

use super::round_float;
use crate::model::SystemInfo;

/// 获取系统基础状态概览
pub fn get_system_info() -> SystemInfo {
    let hostname = read_hostname();
    let (uptime_seconds, uptime_format) = parse_uptime();
    let (load_avg_1, load_avg_5, load_avg_15) = parse_loadavg();
    let (total_memory_kb, free_memory_kb, avail_memory_kb, memory_usage_percent) = parse_meminfo();

    SystemInfo {
        hostname,
        current_time: Utc::now(),
        uptime_seconds,
        uptime_format,
        load_avg_1,
        load_avg_5,
        load_avg_15,
        total_memory_kb,
        free_memory_kb,
        avail_memory_kb,
        memory_usage_percent,
    }
}

fn read_hostname() -> String {
    if let Ok(name) = fs::read_to_string("/proc/sys/kernel/hostname") {
        let trimmed = name.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }
    std::env::var("HOSTNAME")
        .or_else(|_| std::env::var("COMPUTERNAME"))
        .unwrap_or_else(|_| "OpenWrt".to_string())
}

fn parse_uptime() -> (i64, String) {
    let content = match fs::read_to_string("/proc/uptime") {
        Ok(c) => c,
        Err(_) => return (0, "unknown".to_string()),
    };

    let first_field = content.split_whitespace().next().unwrap_or("0");
    let total_sec = first_field.parse::<f64>().map(|f| f as i64).unwrap_or(0);

    let days = total_sec / 86400;
    let hours = (total_sec % 86400) / 3600;
    let minutes = (total_sec % 3600) / 60;
    let seconds = total_sec % 60;

    let format = if days > 0 {
        format!("{}天 {}小时 {}分 {}秒", days, hours, minutes, seconds)
    } else if hours > 0 {
        format!("{}小时 {}分 {}秒", hours, minutes, seconds)
    } else {
        format!("{}分 {}秒", minutes, seconds)
    };

    (total_sec, format)
}

fn parse_loadavg() -> (f64, f64, f64) {
    let content = match fs::read_to_string("/proc/loadavg") {
        Ok(c) => c,
        Err(_) => return (0.0, 0.0, 0.0),
    };

    let fields: Vec<&str> = content.split_whitespace().collect();
    if fields.len() < 3 {
        return (0.0, 0.0, 0.0);
    }

    let l1 = fields[0].parse::<f64>().unwrap_or(0.0);
    let l5 = fields[1].parse::<f64>().unwrap_or(0.0);
    let l15 = fields[2].parse::<f64>().unwrap_or(0.0);

    (round_float(l1, 2), round_float(l5, 2), round_float(l15, 2))
}

fn parse_meminfo() -> (u64, u64, u64, f64) {
    let content = match fs::read_to_string("/proc/meminfo") {
        Ok(c) => c,
        Err(_) => return (0, 0, 0, 0.0),
    };

    let mut total = 0u64;
    let mut free = 0u64;
    let mut avail = 0u64;

    for line in content.lines() {
        if let Some((key, val)) = line.split_once(':') {
            let key = key.trim();
            let num = val
                .split_whitespace()
                .next()
                .and_then(|s| s.parse::<u64>().ok())
                .unwrap_or(0);

            match key {
                "MemTotal" => total = num,
                "MemFree" => free = num,
                "MemAvailable" => avail = num,
                _ => {}
            }
        }
    }

    let mut usage_percent = 0.0;
    if total > 0 {
        let used = if avail > 0 {
            total.saturating_sub(avail)
        } else {
            total.saturating_sub(free)
        };
        usage_percent = round_float((used as f64 / total as f64) * 100.0, 1);
    }

    (total, free, avail, usage_percent)
}
