use std::convert::Infallible;
use std::time::Duration;

use axum::extract::{Query, State};
use axum::http::{header, Request, StatusCode};
use axum::middleware::Next;
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::json;
use tokio_stream::wrappers::ReceiverStream;
use tower_http::cors::CorsLayer;

use crate::collector;
use crate::model::{
    AllStatusResponse, BaseResponse, CPUStatus, ClientStatus, ExecRequest, ExecStreamMessage,
    NetworkStatus, ThermalStatus,
};

#[derive(Clone)]
pub struct AppState {
    pub token: Option<String>,
}

#[derive(Deserialize)]
pub struct AuthQuery {
    pub token: Option<String>,
}

pub fn create_router(state: AppState) -> Router {
    let auth_state = state.clone();

    let api_routes = Router::new()
        .route("/status", get(handle_all_status))
        .route("/cpu", get(handle_cpu_status))
        .route("/thermal", get(handle_thermal_status))
        .route("/clients", get(handle_client_status))
        .route("/network", get(handle_network_status))
        .route("/exec", post(handle_exec_command))
        .route_layer(axum::middleware::from_fn_with_state(
            auth_state,
            auth_middleware,
        ))
        .route("/health", get(handle_health));

    Router::new()
        .nest("/api/v1", api_routes)
        .route("/", get(handle_index))
        .layer(CorsLayer::permissive())
        .with_state(state)
}

async fn auth_middleware(
    State(state): State<AppState>,
    Query(query): Query<AuthQuery>,
    req: Request<axum::body::Body>,
    next: Next,
) -> Result<Response, Response> {
    if let Some(required_token) = &state.token {
        let auth_header = req
            .headers()
            .get(header::AUTHORIZATION)
            .and_then(|h| h.to_str().ok());

        let mut token_valid = false;

        if let Some(h) = auth_header {
            if let Some(bearer_token) = h.strip_prefix("Bearer ") {
                if bearer_token == required_token {
                    token_valid = true;
                }
            }
        }

        if !token_valid {
            if let Some(q_token) = &query.token {
                if q_token == required_token {
                    token_valid = true;
                }
            }
        }

        if !token_valid {
            let body = Json(BaseResponse::<()>::error(
                401,
                "Unauthorized: invalid or missing token",
            ));
            return Err((StatusCode::UNAUTHORIZED, body).into_response());
        }
    }

    // 通过鉴权，记录客户端活跃状态，按需唤醒数据采集器
    collector::touch_client_activity();

    Ok(next.run(req).await)
}

async fn handle_all_status() -> Json<BaseResponse<AllStatusResponse>> {
    let response = AllStatusResponse {
        system: collector::get_system_info(),
        cpu: collector::get_cpu_status(),
        thermal: collector::get_thermal_status(),
        clients: collector::get_client_status(),
        network: collector::get_network_status().await,
    };
    Json(BaseResponse::success(response))
}

async fn handle_cpu_status() -> Json<BaseResponse<CPUStatus>> {
    Json(BaseResponse::success(collector::get_cpu_status()))
}

async fn handle_thermal_status() -> Json<BaseResponse<ThermalStatus>> {
    Json(BaseResponse::success(collector::get_thermal_status()))
}

async fn handle_client_status() -> Json<BaseResponse<ClientStatus>> {
    Json(BaseResponse::success(collector::get_client_status()))
}

async fn handle_network_status() -> Json<BaseResponse<NetworkStatus>> {
    Json(BaseResponse::success(
        collector::get_network_status().await,
    ))
}

async fn handle_exec_command(
    Json(payload): Json<ExecRequest>,
) -> Sse<ReceiverStream<Result<Event, Infallible>>> {
    collector::touch_client_activity();
    let (tx, rx) = tokio::sync::mpsc::channel::<Result<Event, Infallible>>(32);

    tokio::spawn(async move {
        let start_instant = std::time::Instant::now();
        let timeout_secs = payload.timeout.unwrap_or(120).max(1);
        let max_timeout = Duration::from_secs(timeout_secs);

        #[cfg(target_os = "windows")]
        let mut child_cmd = tokio::process::Command::new("cmd");
        #[cfg(target_os = "windows")]
        child_cmd.arg("/C").arg(&payload.command);

        #[cfg(not(target_os = "windows"))]
        let mut child_cmd = tokio::process::Command::new("sh");
        #[cfg(not(target_os = "windows"))]
        child_cmd.arg("-c").arg(&payload.command);

        child_cmd.kill_on_drop(true);
        let child_res = child_cmd
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn();

        let child = match child_res {
            Ok(c) => c,
            Err(e) => {
                let err_msg = ExecStreamMessage::Error {
                    status: "failed".to_string(),
                    message: format!("无法启动命令: {}", e),
                };
                if let Ok(event) = Event::default().json_data(&err_msg) {
                    let _ = tx.send(Ok(event)).await;
                }
                return;
            }
        };

        // 每5秒向客户端发送一次执行状态心跳，避免响应超时
        let mut heartbeat_ticker = tokio::time::interval(Duration::from_secs(5));
        heartbeat_ticker.tick().await; // 跳过第一次即时触发

        let wait_fut = child.wait_with_output();
        tokio::pin!(wait_fut);

        let output_res = loop {
            tokio::select! {
                _ = heartbeat_ticker.tick() => {
                    let elapsed = start_instant.elapsed().as_secs();
                    let status_msg = ExecStreamMessage::Status {
                        status: "running".to_string(),
                        elapsed_seconds: elapsed,
                        message: format!("命令正在服务器端执行中 (已执行 {} 秒)...", elapsed),
                    };
                    if let Ok(event) = Event::default().json_data(&status_msg) {
                        if tx.send(Ok(event)).await.is_err() {
                            // 客户端已主动断开，返回即可，kill_on_drop保证子进程自动终止
                            return;
                        }
                    }
                }
                res = &mut wait_fut => {
                    break res;
                }
                _ = tokio::time::sleep(max_timeout) => {
                    let err_msg = ExecStreamMessage::Error {
                        status: "timeout".to_string(),
                        message: format!("命令执行超时 (超过 {} 秒)", timeout_secs),
                    };
                    if let Ok(event) = Event::default().json_data(&err_msg) {
                        let _ = tx.send(Ok(event)).await;
                    }
                    // 超时退出，kill_on_drop保证子进程自动终止
                    return;
                }
            }
        };

        let elapsed_seconds = start_instant.elapsed().as_secs_f64();
        match output_res {
            Ok(output) => {
                let exit_code = output.status.code().unwrap_or(-1);
                let stdout = String::from_utf8_lossy(&output.stdout).to_string();
                let stderr = String::from_utf8_lossy(&output.stderr).to_string();
                let result_msg = ExecStreamMessage::Result {
                    status: "completed".to_string(),
                    exit_code,
                    success: output.status.success(),
                    stdout,
                    stderr,
                    elapsed_seconds: (elapsed_seconds * 100.0).round() / 100.0,
                };
                if let Ok(event) = Event::default().json_data(&result_msg) {
                    let _ = tx.send(Ok(event)).await;
                }
            }
            Err(e) => {
                let err_msg = ExecStreamMessage::Error {
                    status: "error".to_string(),
                    message: format!("读取命令执行结果失败: {}", e),
                };
                if let Ok(event) = Event::default().json_data(&err_msg) {
                    let _ = tx.send(Ok(event)).await;
                }
            }
        }
    });

    let stream = ReceiverStream::new(rx);
    Sse::new(stream).keep_alive(KeepAlive::default())
}

async fn handle_health() -> Json<serde_json::Value> {
    collector::touch_client_activity();
    Json(json!({
        "code": 200,
        "message": "success",
        "data": {
            "status": "ok",
            "service": "openwrt_status",
            "runtime": "rust"
        }
    }))
}

async fn handle_index() -> Json<serde_json::Value> {
    Json(json!({
        "service": "OpenWrt System Status API (Rust)",
        "endpoints": [
            "/api/v1/status",
            "/api/v1/cpu",
            "/api/v1/thermal",
            "/api/v1/clients",
            "/api/v1/network",
            "/api/v1/exec",
            "/api/v1/health"
        ]
    }))
}
