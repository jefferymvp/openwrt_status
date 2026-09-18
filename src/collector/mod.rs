pub mod client;
pub mod cpu;
pub mod network;
pub mod system;
pub mod thermal;

pub use client::get_client_status;
pub use cpu::get_cpu_status;
pub use network::{get_network_status, init_network_sampler};
pub use system::get_system_info;
pub use thermal::get_thermal_status;

/// 辅助保留小数位数
pub(crate) fn round_float(val: f64, precision: u32) -> f64 {
    let factor = 10f64.powi(precision as i32);
    (val * factor).round() / factor
}
