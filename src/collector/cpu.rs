use std::fs;
use std::path::Path;

use regex::Regex;

use super::round_float;
use crate::model::{CPUCoreInfo, CPUStatus};

/// 获取 CPU 型号、核心数与各核频率
pub fn get_cpu_status() -> CPUStatus {
    let mut core_list = read_sysfs_cpu_freq();
    let (model_name_opt, cpuinfo_cores) = parse_proc_cpuinfo();

    let model_name = model_name_opt.unwrap_or_else(|| {
        format!(
            "{} ({} Logical Cores)",
            std::env::consts::ARCH,
            num_cpus()
        )
    });

    if core_list.is_empty() {
        if !cpuinfo_cores.is_empty() {
            core_list = cpuinfo_cores;
        } else {
            let total = num_cpus();
            for i in 0..total {
                core_list.push(CPUCoreInfo {
                    core_id: i,
                    frequency_mhz: 0.0,
                });
            }
        }
    }

    let cores = if core_list.is_empty() {
        num_cpus()
    } else {
        core_list.len()
    };

    let valid_freqs: Vec<f64> = core_list
        .iter()
        .map(|c| c.frequency_mhz)
        .filter(|&f| f > 0.0)
        .collect();

    let avg_frequency_mhz = if !valid_freqs.is_empty() {
        let sum: f64 = valid_freqs.iter().sum();
        round_float(sum / valid_freqs.len() as f64, 2)
    } else {
        0.0
    };

    CPUStatus {
        model_name,
        cores,
        avg_frequency_mhz,
        core_list,
    }
}

/// 尝试从 /sys/devices/system/cpu/cpu*/cpufreq 读取各核频率
fn read_sysfs_cpu_freq() -> Vec<CPUCoreInfo> {
    let mut results = Vec::new();
    let base_path = Path::new("/sys/devices/system/cpu");
    if !base_path.exists() {
        return results;
    }

    let entries = match fs::read_dir(base_path) {
        Ok(e) => e,
        Err(_) => return results,
    };

    let cpu_re = Regex::new(r"^cpu(\d+)$").unwrap();

    let mut cpu_dirs = Vec::new();
    for entry in entries.flatten() {
        let file_name = entry.file_name().to_string_lossy().to_string();
        if let Some(caps) = cpu_re.captures(&file_name) {
            if let Ok(core_id) = caps[1].parse::<usize>() {
                cpu_dirs.push((core_id, entry.path()));
            }
        }
    }

    // 按 core_id 升序排列
    cpu_dirs.sort_by_key(|k| k.0);

    for (core_id, path) in cpu_dirs {
        let cur_freq_path = path.join("cpufreq/scaling_cur_freq");
        let info_freq_path = path.join("cpufreq/cpuinfo_cur_freq");

        let freq_khz = read_first_int(&[&cur_freq_path, &info_freq_path]);
        if let Some(khz) = freq_khz {
            results.push(CPUCoreInfo {
                core_id,
                frequency_mhz: round_float(khz as f64 / 1000.0, 2),
            });
        }
    }

    results
}

/// 解析 /proc/cpuinfo 获取型号与频率
fn parse_proc_cpuinfo() -> (Option<String>, Vec<CPUCoreInfo>) {
    let content = match fs::read_to_string("/proc/cpuinfo") {
        Ok(c) => c,
        Err(_) => return (None, Vec::new()),
    };

    let mut model_name = None;
    let mut freqs = Vec::new();
    let mut current_core_id: Option<usize> = None;
    let mut current_freq: Option<f64> = None;

    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() {
            if let (Some(id), Some(freq)) = (current_core_id, current_freq) {
                freqs.push(CPUCoreInfo {
                    core_id: id,
                    frequency_mhz: round_float(freq, 2),
                });
                current_core_id = None;
                current_freq = None;
            }
            continue;
        }

        if let Some((key, val)) = line.split_once(':') {
            let key = key.trim().to_lowercase();
            let val = val.trim();

            if model_name.is_none() {
                match key.as_str() {
                    "model name" | "system type" | "cpu model" | "hardware" => {
                        model_name = Some(val.to_string());
                    }
                    _ => {}
                }
            }

            if key == "processor" {
                if let Ok(id) = val.parse::<usize>() {
                    current_core_id = Some(id);
                }
            }

            match key.as_str() {
                "cpu mhz" => {
                    if let Ok(f) = val.parse::<f64>() {
                        current_freq = Some(f);
                    }
                }
                "bogomips" => {
                    if current_freq.is_none() {
                        if let Ok(f) = val.parse::<f64>() {
                            current_freq = Some(f);
                        }
                    }
                }
                _ => {}
            }
        }
    }

    if let (Some(id), Some(freq)) = (current_core_id, current_freq) {
        freqs.push(CPUCoreInfo {
            core_id: id,
            frequency_mhz: round_float(freq, 2),
        });
    }

    (model_name, freqs)
}

fn read_first_int(paths: &[&Path]) -> Option<i64> {
    for path in paths {
        if let Ok(content) = fs::read_to_string(path) {
            if let Ok(val) = content.trim().parse::<i64>() {
                return Some(val);
            }
        }
    }
    None
}

fn num_cpus() -> usize {
    std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(1)
}
