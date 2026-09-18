use axum::extract::{Query, State};
use axum::http::{header, Request, StatusCode};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::json;
use tower_http::cors::CorsLayer;

use crate::collector;
use crate::model::{
    AllStatusResponse, BaseResponse, CPUStatus, ClientStatus, NetworkStatus, ThermalStatus,
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

async fn handle_health() -> Json<serde_json::Value> {
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
            "/api/v1/health"
        ]
    }))
}
