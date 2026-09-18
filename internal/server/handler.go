package server

import (
	"encoding/json"
	"net/http"

	"github.com/jefferymvp/openwrt_status/internal/collector"
	"github.com/jefferymvp/openwrt_status/internal/model"
)

// RegisterRoutes 注册所有 HTTP 路由
func RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/api/v1/status", handleAllStatus)
	mux.HandleFunc("/api/v1/cpu", handleCPUStatus)
	mux.HandleFunc("/api/v1/thermal", handleThermalStatus)
	mux.HandleFunc("/api/v1/clients", handleClientStatus)
	mux.HandleFunc("/api/v1/network", handleNetworkStatus)
	mux.HandleFunc("/api/v1/health", handleHealth)
	// 根路径引导
	mux.HandleFunc("/", handleIndex)
}

func writeJSON(w http.ResponseWriter, statusCode int, data interface{}) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(statusCode)
	_ = json.NewEncoder(w).Encode(model.BaseResponse{
		Code:    statusCode,
		Message: "success",
		Data:    data,
	})
}

func handleAllStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
		return
	}

	response := model.AllStatusResponse{
		System:  collector.GetSystemInfo(),
		CPU:     collector.GetCPUStatus(),
		Thermal: collector.GetThermalStatus(),
		Clients: collector.GetClientStatus(),
		Network: collector.GetNetworkStatus(),
	}

	writeJSON(w, http.StatusOK, response)
}

func handleCPUStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
		return
	}
	writeJSON(w, http.StatusOK, collector.GetCPUStatus())
}

func handleThermalStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
		return
	}
	writeJSON(w, http.StatusOK, collector.GetThermalStatus())
}

func handleClientStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
		return
	}
	writeJSON(w, http.StatusOK, collector.GetClientStatus())
}

func handleNetworkStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
		return
	}
	writeJSON(w, http.StatusOK, collector.GetNetworkStatus())
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{
		"status":  "ok",
		"service": "openwrt_status",
	})
}

func handleIndex(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" {
		http.NotFound(w, r)
		return
	}

	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"service": "OpenWrt System Status API",
		"endpoints": []string{
			"/api/v1/status",
			"/api/v1/cpu",
			"/api/v1/thermal",
			"/api/v1/clients",
			"/api/v1/network",
			"/api/v1/health",
		},
	})
}
