use std::net::SocketAddr;
use std::time::Duration;

use clap::Parser;
use tracing::info;

mod collector;
mod model;
mod server;

#[derive(Parser, Debug)]
#[command(
    name = "openwrt_status",
    version = "1.0.0",
    about = "Lightweight OpenWrt System Status API Backend written in Rust"
)]
struct Args {
    /// HTTP 服务监听端口
    #[arg(short, long, env = "STATUS_PORT", default_value_t = 9090)]
    port: u16,

    /// HTTP 服务监听地址
    #[arg(long, env = "STATUS_HOST", default_value = "0.0.0.0")]
    host: String,

    /// 网卡吞吐量采样间隔 (秒)
    #[arg(short, long, env = "STATUS_INTERVAL", default_value_t = 1.0)]
    interval: f64,

    /// API 访问认证 Token (留空则不开启鉴权)
    #[arg(short, long, env = "STATUS_TOKEN")]
    token: Option<String>,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // 初始化日志记录
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info".into()),
        )
        .init();

    let args = Args::parse();

    info!(
        "Starting openwrt_status (Rust edition) v{}...",
        env!("CARGO_PKG_VERSION")
    );

    // 启动网络接口后台异步采样器
    let interval_duration = Duration::from_secs_f64(args.interval.max(0.1));
    collector::init_network_sampler(interval_duration).await;
    info!(
        "Network sampler started with interval: {:.1}s",
        args.interval
    );

    let state = server::AppState {
        token: args.token.clone(),
    };

    if args.token.is_some() {
        info!("API authentication enabled (Token protected)");
    } else {
        info!("API authentication disabled (Public access)");
    }

    let app = server::create_router(state);

    let addr: SocketAddr = format!("{}:{}", args.host, args.port).parse()?;
    info!("HTTP Server listening on http://{}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;

    info!("openwrt_status stopped cleanly.");
    Ok(())
}

async fn shutdown_signal() {
    let ctrl_c = async {
        tokio::signal::ctrl_c()
            .await
            .expect("Failed to listen for Ctrl+C");
    };

    #[cfg(unix)]
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("Failed to listen for SIGTERM")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => info!("Received Ctrl+C, shutting down gracefully..."),
        _ = terminate => info!("Received SIGTERM, shutting down gracefully..."),
    }
}
