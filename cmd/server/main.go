package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/jefferymvp/openwrt_status/internal/collector"
	"github.com/jefferymvp/openwrt_status/internal/server"
)

// 编译时通过 -ldflags 注入
var (
	Version   = "v1.0.0-dev"
	GitCommit = "unknown"
	BuildTime = "unknown"
)

func main() {
	var (
		portFlag     = flag.Int("port", getEnvInt("STATUS_PORT", 9090), "HTTP 服务监听端口")
		hostFlag     = flag.String("host", getEnvString("STATUS_HOST", "0.0.0.0"), "HTTP 服务监听地址")
		intervalFlag = flag.Duration("interval", getEnvDuration("STATUS_INTERVAL", 1*time.Second), "网卡吞吐量采样间隔 (例如 1s, 2s)")
		tokenFlag    = flag.String("token", getEnvString("STATUS_TOKEN", ""), "API 访问认证 Token (留空则不开启鉴权)")
		versionFlag  = flag.Bool("version", false, "显示程序版本信息")
	)
	flag.Parse()

	if *versionFlag {
		fmt.Printf("openwrt_status %s (Commit: %s, Built: %s)\n", Version, GitCommit, BuildTime)
		os.Exit(0)
	}

	log.Printf("Starting openwrt_status server (Version: %s, Commit: %s)...", Version, GitCommit)

	// 上下文与优雅停机
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// 初始化网卡流量采样器
	collector.InitNetworkSampler(ctx, *intervalFlag)
	log.Printf("Network throughput sampler initialized with interval: %v", *intervalFlag)

	// 创建 HTTP 路由与中间件
	mux := http.NewServeMux()
	server.RegisterRoutes(mux)

	handler := server.Chain(
		mux,
		server.LoggingAndRecoveryMiddleware,
		server.CORSMiddleware,
		server.AuthMiddleware(*tokenFlag),
	)

	addr := fmt.Sprintf("%s:%d", *hostFlag, *portFlag)
	httpServer := &http.Server{
		Addr:         addr,
		Handler:      handler,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	// 启动 HTTP 服务
	go func() {
		log.Printf("HTTP Server listening on http://%s", addr)
		if *tokenFlag != "" {
			log.Println("API authentication enabled (Token protected)")
		} else {
			log.Println("API authentication disabled (Public access)")
		}

		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("HTTP server failed: %v", err)
		}
	}()

	// 监听中断信号
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	sig := <-quit
	log.Printf("Received signal %v, shutting down gracefully...", sig)

	// 关闭采样器协程
	cancel()

	// 停止 HTTP 服务，给未完成的请求 5 秒缓冲时间
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer shutdownCancel()

	if err := httpServer.Shutdown(shutdownCtx); err != nil {
		log.Printf("Server forced to shutdown: %v", err)
	}

	log.Println("openwrt_status stopped cleanly.")
}

func getEnvString(key, defaultValue string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return defaultValue
}

func getEnvInt(key string, defaultValue int) int {
	if val := os.Getenv(key); val != "" {
		if i, err := strconv.Atoi(val); err == nil {
			return i
		}
	}
	return defaultValue
}

func getEnvDuration(key string, defaultValue time.Duration) time.Duration {
	if val := os.Getenv(key); val != "" {
		if d, err := time.ParseDuration(val); err == nil {
			return d
		}
	}
	return defaultValue
}
