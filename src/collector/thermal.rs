use std::fs;
use std::path::Path;

use super::round_float;
use crate::model::{ThermalItem, ThermalStatus};

/// 获取系统所有温度传感器的温度数据
pub fn get_thermal_status() -> ThermalStatus {
    let mut sensors = Vec::new();

    // 1. 读取 /sys/class/thermal/thermal_zone*
    sensors.extend(read_thermal_zones());

    // 2. 读取 /sys/class/hwmon/hwmon*
    sensors.extend(read_hwmon());

    ThermalStatus { sensors }
}

fn read_thermal_zones() -> Vec<ThermalItem> {
    let mut results = Vec::new();
    let base_path = Path::new("/sys/class/thermal");
    if !base_path.exists() {
        return results;
    }

    let entries = match fs::read_dir(base_path) {
        Ok(e) => e,
        Err(_) => return results,
    };

    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if !name.starts_with("thermal_zone") {
            continue;
        }

        let type_path = entry.path().join("type");
        let temp_path = entry.path().join("temp");

        let type_name = fs::read_to_string(&type_path)
            .map(|s| s.trim().to_string())
            .unwrap_or_else(|_| name.clone());

        if let Ok(temp_str) = fs::read_to_string(&temp_path) {
            if let Ok(raw_temp) = temp_str.trim().parse::<i64>() {
                if raw_temp > 0 {
                    results.push(ThermalItem {
                        name: format!("{} ({})", type_name, name),
                        temperature: normalize_temperature(raw_temp),
                        r#type: Some("thermal_zone".to_string()),
                    });
                }
            }
        }
    }

    results
}

fn read_hwmon() -> Vec<ThermalItem> {
    let mut results = Vec::new();
    let base_path = Path::new("/sys/class/hwmon");
    if !base_path.exists() {
        return results;
    }

    let entries = match fs::read_dir(base_path) {
        Ok(e) => e,
        Err(_) => return results,
    };

    for entry in entries.flatten() {
        let hwmon_dir_name = entry.file_name().to_string_lossy().to_string();
        if !hwmon_dir_name.starts_with("hwmon") {
            continue;
        }

        let hwmon_name = fs::read_to_string(entry.path().join("name"))
            .map(|s| s.trim().to_string())
            .unwrap_or_else(|_| hwmon_dir_name.clone());

        let sub_entries = match fs::read_dir(entry.path()) {
            Ok(se) => se,
            Err(_) => continue,
        };

        for sub in sub_entries.flatten() {
            let sub_name = sub.file_name().to_string_lossy().to_string();
            // 匹配类似 temp1_input, temp2_input
            if sub_name.starts_with("temp") && sub_name.ends_with("_input") {
                let idx = sub_name
                    .trim_start_matches("temp")
                    .trim_end_matches("_input");
                let label_path = entry.path().join(format!("temp{}_label", idx));
                let label = fs::read_to_string(&label_path)
                    .map(|s| s.trim().to_string())
                    .unwrap_or_else(|_| format!("Sensor {}", idx));

                if let Ok(temp_str) = fs::read_to_string(sub.path()) {
                    if let Ok(raw_temp) = temp_str.trim().parse::<i64>() {
                        if raw_temp > 0 {
                            results.push(ThermalItem {
                                name: format!("{} - {}", hwmon_name, label),
                                temperature: normalize_temperature(raw_temp),
                                r#type: Some("hwmon".to_string()),
                            });
                        }
                    }
                }
            }
        }
    }

    results
}

fn normalize_temperature(raw: i64) -> f64 {
    if raw > 1000 {
        round_float(raw as f64 / 1000.0, 1)
    } else {
        round_float(raw as f64, 1)
    }
}
